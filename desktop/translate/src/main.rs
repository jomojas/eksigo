//! Eksigo's translator: a helper program the app starts when a phrase needs translating. It runs a small
//! translation model with llama.cpp, kept out of the app itself because whisper.cpp brings its own copy of
//! the same engine and the two can't be linked into one program.
//!
//! Usage: eksigo-translate <model.gguf>. Reads one JSON request per line on stdin,
//! {"phrase": "...", "sentence": "...", "to": "zh"}, and writes one JSON reply per line on stdout,
//! {"text": "..."} or {"error": "..."}. Prints {"ready": true} once the model is loaded.
use std::io::{BufRead, Write};
use std::num::NonZeroU32;

use anyhow::{Context, Result, anyhow};
use llama_cpp_2::context::params::LlamaContextParams;
use llama_cpp_2::llama_backend::LlamaBackend;
use llama_cpp_2::llama_batch::LlamaBatch;
use llama_cpp_2::model::params::LlamaModelParams;
use llama_cpp_2::model::{LlamaChatMessage, LlamaModel};
use llama_cpp_2::sampling::LlamaSampler;
use serde::Deserialize;
use serde_json::json;

#[derive(Deserialize)]
struct Request {
    phrase: String,
    #[serde(default)]
    sentence: String,
    #[serde(default)]
    to: String,
}

const MAX_OUT: usize = 48;

/// The learner's language as the model is asked for it, and whether it is written without spaces (so a
/// translation is measured in characters rather than words).
fn language(code: &str) -> (&'static str, bool) {
    match code {
        "ja" => ("Japanese", true),
        "ko" => ("Korean", true),
        "es" => ("Spanish", false),
        "fr" => ("French", false),
        "de" => ("German", false),
        "zh-Hant" => ("繁体中文", true),
        _ => ("中文", true),
    }
}

/// Asks with the sentence around the phrase first, so idioms come out right; if the answer is clearly a
/// translation of the whole sentence, asks again with the phrase alone. Chinese gets the model's own Chinese
/// prompts, the other languages its English ones.
fn prompts(r: &Request) -> Vec<String> {
    let (lang, _) = language(&r.to);
    let chinese = lang.ends_with("中文");
    let alone = if chinese {
        format!("将以下文本翻译为{lang}，注意只需要输出翻译后的结果，不要额外解释：\n\n{}", r.phrase)
    } else {
        format!("Translate the following segment into {lang}, without additional explanation.\n\n{}", r.phrase)
    };
    if r.sentence.trim().is_empty() || r.sentence.trim() == r.phrase.trim() {
        return vec![alone];
    }
    let in_context = if chinese {
        format!("原句：{}\n只把短语「{}」翻译成{lang}（按它在原句中的意思），输出几个字的短语，不要翻译整句，不要解释：\n{}", r.sentence, r.phrase, r.phrase)
    } else {
        format!(
            "Sentence: {}\nTranslate only the phrase \"{}\" into {lang}, as it is meant in this sentence. Give a short phrase, not the whole sentence, and no explanation:\n{}",
            r.sentence, r.phrase, r.phrase
        )
    };
    vec![in_context, alone]
}

/// A phrase's translation is a few words: an answer much longer than the phrase, with sentence punctuation
/// inside it, or still in English, means the model translated the sentence or nothing at all.
fn unusable(phrase: &str, text: &str, to: &str) -> bool {
    let (_, unspaced) = language(to);
    let words = phrase.split_whitespace().count();
    if text.is_empty() || text.contains(['，', '？', '！', '；', '?', '!']) || text.trim() == phrase.trim() {
        return true;
    }
    if unspaced {
        let chars = text.chars().count();
        let latin = text.chars().filter(|c| c.is_ascii_alphabetic()).count();
        chars > (words * 3).max(6) || latin * 2 > chars
    } else {
        text.split_whitespace().count() > words * 2 + 2 || text.contains(", ")
    }
}

/// The model often ends a phrase with a full stop; a phrase shouldn't have one.
fn tidy(text: &str) -> String {
    text.trim().trim_end_matches(['。', '.']).trim().to_string()
}

fn generate(backend: &LlamaBackend, model: &LlamaModel, prompt: &str) -> Result<String> {
    let tmpl = model.chat_template(None).context("no chat template")?;
    let chat = [LlamaChatMessage::new("user".into(), prompt.into())?];
    let text = model.apply_chat_template(&tmpl, &chat, true)?;
    let vocab = model.vocab();
    let tokens = vocab.tokenize(text.as_bytes(), false, true);
    let params = LlamaContextParams::default().with_n_ctx(NonZeroU32::new(1024));
    let mut ctx = model.new_context(backend, params)?;
    let mut batch = LlamaBatch::new(1024, 1);
    let last = tokens.len() as i32 - 1;
    for (i, t) in tokens.iter().enumerate() { batch.add(*t, i as i32, &[0], i as i32 == last)?; }
    ctx.decode(&mut batch)?;
    let mut sampler = LlamaSampler::greedy();
    let mut out = Vec::new();
    let mut pos = tokens.len() as i32;
    for _ in 0..MAX_OUT {
        let t = sampler.sample(&ctx, batch.n_tokens() - 1);
        if vocab.is_eog(t) { break; }
        out.extend(vocab.token_to_piece(t, false, None));
        batch.clear();
        batch.add(t, pos, &[0], true)?;
        pos += 1;
        ctx.decode(&mut batch)?;
    }
    let s = String::from_utf8_lossy(&out).trim().to_string();
    Ok(s.lines().next().unwrap_or("").trim().to_string())
}

fn translate(backend: &LlamaBackend, model: &LlamaModel, r: &Request) -> Result<String> {
    let mut answer = String::new();
    for p in prompts(r) {
        answer = tidy(&generate(backend, model, &p)?);
        if !unusable(&r.phrase, &answer, &r.to) { break; }
    }
    if answer.is_empty() { return Err(anyhow!("no translation")); }
    Ok(answer)
}

fn main() -> Result<()> {
    let path = std::env::args().nth(1).context("usage: eksigo-translate <model.gguf>")?;
    let mut backend = LlamaBackend::init()?;
    backend.void_logs();
    let model = LlamaModel::load_from_file(&backend, &path, &LlamaModelParams::default().with_n_gpu_layers(999))?;
    let mut out = std::io::stdout().lock();
    writeln!(out, "{}", json!({"ready": true}))?; out.flush()?;
    for line in std::io::stdin().lock().lines() {
        let line = line?;
        if line.trim().is_empty() { continue; }
        let reply = match serde_json::from_str::<Request>(&line) {
            Ok(r) => match translate(&backend, &model, &r) { Ok(t) => json!({"text": t}), Err(e) => json!({"error": e.to_string()}) },
            Err(e) => json!({"error": format!("bad request: {e}")}),
        };
        writeln!(out, "{reply}")?; out.flush()?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_translated_sentence_is_not_a_phrase() {
        assert!(!unusable("at the end of the day", "归根结底", "zh"));
        assert!(unusable("at the end of the day", "归根结底，你有两种选择来参与竞争", "zh"));
        assert!(unusable("a packet of crisps", "偶尔吃一包薯片可以吗？", "zh"));
        assert!(unusable("deluding yourself", "deluding yourself", "zh"));
        assert!(!unusable("once in a while", "de vez en cuando", "es"));
        assert!(unusable("once in a while", "¿Está bien comer alimentos ultraprocesados de vez en cuando o de tanto en tanto?", "es"));
        assert_eq!(tidy(" 酒吧里的那个人。"), "酒吧里的那个人");
    }

    #[test]
    fn the_sentence_is_asked_about_first() {
        let r = Request { phrase: "squash you".into(), sentence: "They could just squash you.".into(), to: "zh".into() };
        let p = prompts(&r);
        assert_eq!(p.len(), 2);
        assert!(p[0].contains("They could just squash you.") && !p[1].contains("They could"));
        let alone = Request { phrase: "squash you".into(), sentence: String::new(), to: "fr".into() };
        assert!(prompts(&alone)[0].starts_with("Translate the following segment into French"));
    }
}
