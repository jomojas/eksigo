//! Phrase translation (DESIGN.md, "Results"): when a selection isn't in the dictionary as a phrase, a small
//! translation model on this computer translates it, reading the sentence around it.
//!
//! The model runs in a helper program, `eksigo-translate` (desktop/translate), bundled beside the app:
//! llama.cpp and whisper.cpp can't share one program. The helper is started on the first translation, kept
//! while the learner goes on looking things up, and closed after a few idle minutes so its memory (about
//! 1.3 GB) goes back to the computer.

use std::{
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, ChildStdout, Command, Stdio},
    sync::Mutex,
    time::{Duration, Instant},
};

use anyhow::{anyhow, bail, Context, Result};
use serde::Deserialize;
use serde_json::json;

use crate::models::{self, Model};

/// How long the helper stays open after the last translation.
pub const IDLE: Duration = Duration::from_secs(5 * 60);

/// Where HY-MT's licence doesn't reach: the European Union, the United Kingdom and South Korea.
const HY_MT_EXCLUDED: &[&str] = &[
    "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO",
    "SK", "SI", "ES", "SE", "GB", "UK", "KR",
];

/// The region of a locale such as "en-GB", "zh-Hans-CN" or "fr_FR".
fn region(locale: &str) -> Option<String> {
    locale.split(['-', '_']).skip(1).find(|p| p.len() == 2 && p.chars().all(|c| c.is_ascii_alphabetic())).map(|p| p.to_ascii_uppercase())
}

/// The translation model for a computer set to `locale`: HY-MT, or Qwen where HY-MT's licence doesn't reach.
pub fn model_for(locale: Option<&str>) -> &'static Model {
    let excluded = locale.and_then(region).is_some_and(|r| HY_MT_EXCLUDED.contains(&r.as_str()));
    &models::TRANSLATION[if excluded { 1 } else { 0 }]
}

/// The model for this computer.
pub fn model() -> &'static Model {
    model_for(sys_locale::get_locale().as_deref())
}

/// The helper program, next to the app's own (Tauri puts `bundle.externalBin` there, and in development
/// beside the debug build).
pub fn helper_path() -> Result<PathBuf> {
    let exe = std::env::current_exe()?;
    let name = if cfg!(windows) { "eksigo-translate.exe" } else { "eksigo-translate" };
    Ok(exe.parent().context("the app has no folder")?.join(name))
}

struct Helper {
    child: Child,
    stdin: ChildStdin,
    out: BufReader<ChildStdout>,
    model: PathBuf,
}

impl Helper {
    fn start(exe: &Path, model: &Path) -> Result<Self> {
        let mut cmd = Command::new(exe);
        cmd.arg(model).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            // No console window flashing up beside the app.
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }
        let mut child = cmd.spawn().with_context(|| format!("The translator can't start ({})", exe.display()))?;
        let stdin = child.stdin.take().context("no stdin")?;
        let mut out = BufReader::new(child.stdout.take().context("no stdout")?);
        let mut line = String::new();
        out.read_line(&mut line)?;
        if !line.contains("\"ready\"") {
            let _ = child.kill();
            bail!("The translation model couldn't be loaded");
        }
        Ok(Helper { child, stdin, out, model: model.to_path_buf() })
    }

    fn ask(&mut self, phrase: &str, sentence: &str, to: &str) -> Result<String> {
        writeln!(self.stdin, "{}", json!({ "phrase": phrase, "sentence": sentence, "to": to }))?;
        self.stdin.flush()?;
        let mut line = String::new();
        if self.out.read_line(&mut line)? == 0 {
            bail!("The translator stopped");
        }
        #[derive(Deserialize)]
        struct Reply {
            text: Option<String>,
            error: Option<String>,
        }
        let r: Reply = serde_json::from_str(&line)?;
        match (r.text, r.error) {
            (Some(t), _) => Ok(t),
            (None, e) => Err(anyhow!(e.unwrap_or_else(|| "no translation".into()))),
        }
    }
}

impl Drop for Helper {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[derive(Default)]
pub struct Translator {
    helper: Mutex<Option<Helper>>,
    last: Mutex<Option<Instant>>,
}

impl Translator {
    /// Translates `phrase`, read in `sentence`, into `to`. Blocks: the first call loads the model (a few
    /// seconds), later ones take a fraction of a second.
    pub fn translate(&self, exe: &Path, model: &Path, phrase: &str, sentence: &str, to: &str) -> Result<String> {
        let mut slot = self.helper.lock().unwrap();
        *self.last.lock().unwrap() = Some(Instant::now());
        if slot.as_ref().is_some_and(|h| h.model != model) {
            *slot = None;
        }
        if slot.is_none() {
            *slot = Some(Helper::start(exe, model)?);
        }
        let result = slot.as_mut().unwrap().ask(phrase, sentence, to);
        if result.is_err() {
            // Start afresh next time rather than talk to a helper in an unknown state.
            *slot = None;
        }
        *self.last.lock().unwrap() = Some(Instant::now());
        result
    }

    /// Closes the helper once it has been idle for `IDLE`. Called every so often.
    pub fn close_if_idle(&self) {
        let idle = self.last.lock().unwrap().is_some_and(|t| t.elapsed() >= IDLE);
        if idle {
            if let Ok(mut slot) = self.helper.try_lock() {
                *slot = None;
                *self.last.lock().unwrap() = None;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_model_follows_the_computers_region() {
        assert_eq!(model_for(Some("zh-Hans-CN")).id, "hy-mt-1.5");
        assert_eq!(model_for(Some("en-US")).id, "hy-mt-1.5");
        assert_eq!(model_for(Some("ja_JP")).id, "hy-mt-1.5");
        assert_eq!(model_for(None).id, "hy-mt-1.5");
        assert_eq!(model_for(Some("en-GB")).id, "qwen-2.5");
        assert_eq!(model_for(Some("zh-Hans-DE")).id, "qwen-2.5");
        assert_eq!(model_for(Some("ko-KR")).id, "qwen-2.5");
        assert_eq!(model_for(Some("fr")).id, "hy-mt-1.5");
    }

    /// Runs the real helper on a real model:
    /// `EKSIGO_TRANSLATE_MODEL=/path/model.gguf cargo test -- --ignored translates_a_phrase`
    /// (build the helper first: `node scripts/translator.mjs`).
    #[test]
    #[ignore = "needs the 1.1 GB model"]
    fn translates_a_phrase() {
        let model = PathBuf::from(std::env::var("EKSIGO_TRANSLATE_MODEL").unwrap());
        let triple = if cfg!(target_os = "macos") { "aarch64-apple-darwin" } else { "x86_64-pc-windows-msvc" };
        let exe = Path::new(env!("CARGO_MANIFEST_DIR")).join("binaries").join(format!("eksigo-translate-{triple}{}", std::env::consts::EXE_SUFFIX));
        let t = Translator::default();
        let a = t.translate(&exe, &model, "squash you", "They're kind of like the mafia, they could just squash you.", "zh").unwrap();
        let b = t.translate(&exe, &model, "at the end of the day", "Because at the end of the day, you have two ways to compete.", "zh").unwrap();
        println!("{a} / {b}");
        assert!(!a.is_empty() && !b.is_empty() && !a.contains("squash"));
    }
}
