//! Transcribing an episode in the background, a chunk at a time, so dictation can start within about
//! 30 seconds while Whisper keeps ahead (DESIGN.md section 3). The first chunk is short so the first
//! sentences come quickly; later chunks are longer, which is faster overall. A chunk keeps only its
//! complete sentences; the next starts where the last kept one ended, so no sentence is cut in two.
//! Each chunk is saved as it is done, so quitting loses nothing and the work resumes on the next start.

use std::{
    collections::VecDeque,
    path::Path,
    sync::{atomic::AtomicBool, mpsc},
    time::Instant,
};

use anyhow::{anyhow, Context, Result};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters, WhisperState};

use crate::{
    audio::{self, Reader, WHISPER_RATE},
    db::Db,
    models,
    sentences::{self, Sentence, Word},
    whisper,
};

/// The first chunk is short, so the first sentences are ready in seconds even on a slow computer.
const FIRST_CHUNK_MS: i64 = 30_000;
const CHUNK_MS: i64 = 120_000;
/// A sentence ending this close to the end of a chunk may be cut off; it is left for the next chunk.
const SAFE_MARGIN_MS: i64 = 1_500;

// ---------- whisper.cpp ----------

pub struct Engine {
    pub model_id: &'static str,
    ctx: WhisperContext,
}

impl Engine {
    pub fn load(model: &Path, model_id: &'static str) -> Result<Self> {
        whisper_rs::install_logging_hooks();
        let mut p = WhisperContextParameters::default();
        if whisper::force_cpu() {
            p.use_gpu(false);
        }
        let path = model.to_str().ok_or_else(|| anyhow!("the model path isn't valid text"))?;
        let ctx = WhisperContext::new_with_params(path, p).map_err(|e| anyhow!("loading the speech model: {e}"))?;
        Ok(Engine { model_id, ctx })
    }

    pub fn state(&self) -> Result<WhisperState> {
        self.ctx.create_state().map_err(|e| anyhow!("whisper state: {e}"))
    }

    /// Timed words in 16 kHz `samples` that start `offset_ms` into the file. `prompt` is the text just
    /// before, which keeps spelling and punctuation consistent across chunks.
    pub fn words(&self, state: &mut WhisperState, samples: &[f32], offset_ms: i64, prompt: &str) -> Result<Vec<Word>> {
        let mut p = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        p.set_n_threads(whisper::threads());
        p.set_language(Some("en"));
        p.set_print_special(false);
        p.set_print_progress(false);
        p.set_print_realtime(false);
        p.set_print_timestamps(false);
        p.set_token_timestamps(true);
        // Leave out "[Music]", "(laughs)" and the like.
        p.set_suppress_nst(true);
        if !prompt.is_empty() {
            p.set_initial_prompt(prompt);
        }
        state.full(p, samples).map_err(|e| anyhow!("transcribing: {e}"))?;

        let eot = self.ctx.token_eot();
        // Words as bytes first: a token can hold half of a multi-byte character.
        let mut raw: Vec<(i64, i64, Vec<u8>)> = Vec::new();
        for seg in state.as_iter() {
            for i in 0..seg.n_tokens() {
                let Some(tok) = seg.get_token(i) else { continue };
                if tok.token_id() >= eot {
                    continue; // timestamps and other special tokens
                }
                let Ok(bytes) = tok.to_bytes() else { continue };
                if bytes.is_empty() {
                    continue;
                }
                let data = tok.token_data();
                // whisper.cpp times are in 10 ms units.
                let (t0, t1) = (offset_ms + data.t0 * 10, offset_ms + data.t1 * 10);
                match raw.last_mut() {
                    // A token without a leading space continues the word ("Ok" + "ay", "don" + "'t").
                    Some(w) if bytes[0] != b' ' => {
                        w.2.extend_from_slice(bytes);
                        w.1 = w.1.max(t1);
                    }
                    _ => raw.push((t0, t1.max(t0), bytes.to_vec())),
                }
            }
        }
        let words = raw
            .into_iter()
            .map(|(start_ms, end_ms, b)| Word { start_ms, end_ms, text: String::from_utf8_lossy(&b).trim().to_string() })
            // Only words with letters or digits: no "♪", no stray symbols, no "[Music]" that got through.
            .filter(|w| w.text.chars().any(char::is_alphanumeric) && !(w.text.starts_with(['[', '(']) && w.text.ends_with([']', ')'])))
            .collect();
        Ok(words)
    }
}

// ---------- audio as Whisper wants it, decoded as needed ----------

/// 16 kHz mono samples from a file, decoded a few seconds at a time from a starting point.
pub struct Pcm {
    reader: Reader,
    pending: Vec<f32>,
    out: Vec<f32>,
    /// Where `out[0]` is in the file.
    base_ms: i64,
    pub eof: bool,
}

impl Pcm {
    pub fn open(path: &Path, from_ms: i64) -> Result<Self> {
        let mut reader = Reader::open(path)?;
        reader.seek_ms(from_ms.max(0) as u64)?;
        Ok(Pcm { reader, pending: Vec::new(), out: Vec::new(), base_ms: from_ms.max(0), eof: false })
    }

    fn end_ms(&self) -> i64 {
        self.base_ms + self.out.len() as i64 * 1000 / WHISPER_RATE as i64
    }

    /// Decodes until `ms` is covered or the file ends.
    fn fill(&mut self, ms: i64) -> Result<()> {
        while !self.eof && self.end_ms() < ms {
            let block = 10 * self.reader.rate.max(8_000) as usize;
            while self.pending.len() < block {
                if !self.reader.read_into(&mut self.pending)? {
                    self.eof = true;
                    break;
                }
            }
            if self.reader.rate == 0 {
                return Err(anyhow!("no audio could be decoded from the file"));
            }
            let piece = std::mem::take(&mut self.pending);
            if !piece.is_empty() {
                self.out.extend(audio::resample(piece, self.reader.rate, WHISPER_RATE)?);
            }
        }
        Ok(())
    }

    /// Samples from `from_ms` to `to_ms` (or the end of the file), dropping what comes before.
    pub fn take(&mut self, from_ms: i64, to_ms: i64) -> Result<&[f32]> {
        self.fill(to_ms)?;
        let at = |ms: i64, base: i64| (((ms - base).max(0)) * WHISPER_RATE as i64 / 1000) as usize;
        let drop = at(from_ms, self.base_ms).min(self.out.len());
        self.out.drain(..drop);
        self.base_ms += drop as i64 * 1000 / WHISPER_RATE as i64;
        let end = at(to_ms, self.base_ms).min(self.out.len());
        Ok(&self.out[..end])
    }

    pub fn finished_at(&self, ms: i64) -> bool {
        self.eof && ms >= self.end_ms()
    }
}

// ---------- the chunk loop ----------

pub struct Chunk {
    pub sentences: Vec<Sentence>,
    /// Everything before this point is transcribed.
    pub done_ms: i64,
    pub finished: bool,
}

/// Transcribes `path` from `from_ms`. `on_chunk` saves each chunk and says whether to go on.
pub fn run(engine: &Engine, path: &Path, from_ms: i64, prompt: &str, mut on_chunk: impl FnMut(Chunk) -> Result<bool>) -> Result<()> {
    let mut state = engine.state()?;
    let mut pcm = Pcm::open(path, from_ms)?;
    let mut start = from_ms;
    let mut prompt = prompt.to_string();
    let mut first = from_ms == 0;
    // Where the previous chunk's last sentence ends, so this chunk's first never starts before it.
    let mut prev_end = from_ms;

    loop {
        let len = if first { FIRST_CHUNK_MS } else { CHUNK_MS };
        first = false;
        let end = start + len;
        let samples = pcm.take(start, end)?.to_vec();
        let last = pcm.finished_at(end);
        if samples.len() < (WHISPER_RATE / 10) as usize {
            on_chunk(Chunk { sentences: Vec::new(), done_ms: start.max(pcm.end_ms()), finished: true })?;
            return Ok(());
        }
        let real_end = start + samples.len() as i64 * 1000 / WHISPER_RATE as i64;
        let words = engine.words(&mut state, &samples, start, &prompt)?;

        let mut sentences = sentences::split(&words);
        let next_start = if last {
            real_end
        } else {
            // Keep the complete sentences; the last one may run past the end of the chunk.
            let safe = |s: &Sentence| s.words.last().is_some_and(|w| w.end_ms <= real_end - SAFE_MARGIN_MS);
            if sentences.len() > 1 {
                sentences.pop();
            }
            while sentences.last().is_some_and(|s| !safe(s)) {
                sentences.pop();
            }
            match sentences.last() {
                Some(s) => s.words.last().unwrap().end_ms,
                // Nothing complete (music, silence, one very long sentence): move on by most of the chunk.
                None => real_end - 5_000,
            }
        };
        if let Some(s) = sentences.first_mut() {
            s.start_ms = s.start_ms.max(prev_end);
        }
        if let Some(s) = sentences.last_mut() {
            s.end_ms = s.end_ms.min(next_start.max(s.words.last().unwrap().end_ms));
            prompt = s.text.clone();
            prev_end = s.end_ms;
        }
        let go_on = on_chunk(Chunk { sentences, done_ms: next_start, finished: last })?;
        if last || !go_on {
            return Ok(());
        }
        start = next_start;
    }
}

// ---------- the database ----------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub item_id: i64,
    pub title: String,
    /// "none", "queued", "model" (downloading the model), "running", "done" or "failed".
    pub state: String,
    pub done_ms: i64,
    pub duration_ms: Option<i64>,
    pub sentences: i64,
    pub error: Option<String>,
}

pub fn status(conn: &Connection, item_id: i64) -> Result<Status> {
    let row = conn
        .query_row(
            "SELECT COALESCE(t.state, 'none'), COALESCE(t.done_ms, 0), COALESCE(t.duration_ms, CAST(i.duration_s * 1000 AS INTEGER)), t.error,
                    (SELECT count(*) FROM sentences s WHERE s.item_id = i.id), i.title
             FROM items i LEFT JOIN transcripts t ON t.item_id = i.id WHERE i.id = ?1",
            [item_id],
            |r| Ok((r.get::<_, String>(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)),
        )
        .optional()?;
    Ok(match row {
        Some((state, done_ms, duration_ms, error, sentences, title)) => Status { item_id, title, state, done_ms, duration_ms, sentences, error },
        None => Status { item_id, title: String::new(), state: "none".into(), done_ms: 0, duration_ms: None, sentences: 0, error: None },
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredSentence {
    pub idx: i64,
    pub start_ms: i64,
    pub end_ms: i64,
    pub text: String,
}

pub fn sentences(conn: &Connection, item_id: i64) -> Result<Vec<StoredSentence>> {
    let mut st = conn.prepare("SELECT idx, start_ms, end_ms, text FROM sentences WHERE item_id = ?1 ORDER BY idx")?;
    let rows = st
        .query_map([item_id], |r| Ok(StoredSentence { idx: r.get(0)?, start_ms: r.get(1)?, end_ms: r.get(2)?, text: r.get(3)? }))?
        .collect::<rusqlite::Result<_>>()?;
    Ok(rows)
}

/// Prepares to transcribe an item: a new transcript, or the unfinished one to resume.
/// Returns where to start and the text just before it.
fn begin(conn: &Connection, item_id: i64, model: &str, duration_ms: Option<i64>) -> Result<(i64, String)> {
    let existing: Option<(String, i64)> = conn
        .query_row("SELECT model, done_ms FROM transcripts WHERE item_id = ?1", [item_id], |r| Ok((r.get(0)?, r.get(1)?)))
        .optional()?;
    match existing {
        Some((m, done_ms)) if m == model => {
            conn.execute("UPDATE transcripts SET state = 'running', error = NULL WHERE item_id = ?1", [item_id])?;
            let prompt = conn
                .query_row("SELECT text FROM sentences WHERE item_id = ?1 ORDER BY idx DESC LIMIT 1", [item_id], |r| r.get(0))
                .optional()?
                .unwrap_or_default();
            Ok((done_ms, prompt))
        }
        _ => {
            conn.execute("DELETE FROM sentences WHERE item_id = ?1", [item_id])?;
            conn.execute(
                "INSERT OR REPLACE INTO transcripts (item_id, model, state, done_ms, duration_ms, started_at) VALUES (?1, ?2, 'running', 0, ?3, ?4)",
                params![item_id, model, duration_ms, chrono::Utc::now().timestamp()],
            )?;
            Ok((0, String::new()))
        }
    }
}

fn save_chunk(conn: &mut Connection, item_id: i64, chunk: &Chunk) -> Result<()> {
    let tx = conn.transaction()?;
    let next: i64 = tx.query_row("SELECT COALESCE(MAX(idx) + 1, 0) FROM sentences WHERE item_id = ?1", [item_id], |r| r.get(0))?;
    {
        let mut ins = tx.prepare("INSERT INTO sentences (item_id, idx, start_ms, end_ms, text, words) VALUES (?1, ?2, ?3, ?4, ?5, ?6)")?;
        for (i, s) in chunk.sentences.iter().enumerate() {
            let words: Vec<(i64, i64, &str)> = s.words.iter().map(|w| (w.start_ms, w.end_ms, w.text.as_str())).collect();
            ins.execute(params![item_id, next + i as i64, s.start_ms, s.end_ms, s.text, serde_json::to_string(&words)?])?;
        }
    }
    tx.execute(
        "UPDATE transcripts SET done_ms = ?2, state = CASE WHEN ?3 THEN 'done' ELSE state END,
                                finished_at = CASE WHEN ?3 THEN ?4 ELSE finished_at END,
                                duration_ms = CASE WHEN ?3 THEN MAX(COALESCE(duration_ms, 0), ?2) ELSE duration_ms END
         WHERE item_id = ?1",
        params![item_id, chunk.done_ms, chunk.finished, chrono::Utc::now().timestamp()],
    )?;
    tx.commit()?;
    Ok(())
}

/// Items whose transcription was interrupted by quitting, to resume on start.
pub fn unfinished(conn: &Connection) -> Result<Vec<i64>> {
    let mut st = conn.prepare("SELECT item_id FROM transcripts WHERE state IN ('running', 'queued') ORDER BY started_at")?;
    let rows = st.query_map([], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?;
    Ok(rows)
}

// ---------- the background worker ----------

enum Msg {
    /// Transcribe this item; `first` puts it ahead of the others (the one the learner is waiting for).
    Request { item_id: i64, first: bool },
    Cancel(i64),
}

pub struct Transcriber {
    tx: mpsc::Sender<Msg>,
}

impl Transcriber {
    pub fn start(app: AppHandle) -> Self {
        let (tx, rx) = mpsc::channel();
        std::thread::Builder::new()
            .name("eksigo-transcribe".into())
            .spawn(move || Worker { app, rx, queue: VecDeque::new(), engine: None }.run())
            .expect("starting the transcription thread");
        Transcriber { tx }
    }

    pub fn request(&self, item_id: i64, first: bool) {
        let _ = self.tx.send(Msg::Request { item_id, first });
    }

    pub fn cancel(&self, item_id: i64) {
        let _ = self.tx.send(Msg::Cancel(item_id));
    }
}

struct Worker {
    app: AppHandle,
    rx: mpsc::Receiver<Msg>,
    queue: VecDeque<i64>,
    engine: Option<Engine>,
}

enum Next {
    Done,
    /// Another item jumped the queue; this one goes back in line.
    Yield,
    Cancelled,
}

impl Worker {
    fn run(mut self) {
        loop {
            let Some(item_id) = self.queue.pop_front() else {
                match self.rx.recv() {
                    Ok(m) => {
                        self.handle(m, None);
                    }
                    Err(_) => return,
                }
                continue;
            };
            match self.transcribe(item_id) {
                Ok(Next::Done) => {}
                Ok(Next::Yield) => self.queue.insert(1.min(self.queue.len()), item_id),
                Ok(Next::Cancelled) => {}
                Err(e) => {
                    let msg = format!("{e:#}");
                    eprintln!("transcribing item {item_id}: {msg}");
                    let db = self.app.state::<Db>();
                    let _ = db.conn().execute("UPDATE transcripts SET state = 'failed', error = ?2 WHERE item_id = ?1", params![item_id, msg]);
                }
            }
            self.emit(item_id, None);
        }
    }

    /// Applies a message. Returns true when it should interrupt `current`.
    fn handle(&mut self, m: Msg, current: Option<i64>) -> bool {
        match m {
            Msg::Request { item_id, first } => {
                if Some(item_id) == current {
                    return false;
                }
                self.queue.retain(|&i| i != item_id);
                let db = self.app.state::<Db>();
                let _ = db.conn().execute(
                    "INSERT INTO transcripts (item_id, model, state, started_at) VALUES (?1, ?2, 'queued', ?3)
                     ON CONFLICT(item_id) DO UPDATE SET state = CASE WHEN state = 'done' THEN 'done' ELSE 'queued' END, error = NULL",
                    params![item_id, models::DEFAULT, chrono::Utc::now().timestamp()],
                );
                if first {
                    self.queue.push_front(item_id);
                } else {
                    self.queue.push_back(item_id);
                }
                self.emit(item_id, None);
                first && current.is_some()
            }
            Msg::Cancel(item_id) => {
                self.queue.retain(|&i| i != item_id);
                Some(item_id) == current
            }
        }
    }

    fn emit(&self, item_id: i64, state: Option<&str>) {
        let db = self.app.state::<Db>();
        let st = status(&db.conn(), item_id);
        if let Ok(mut s) = st {
            if let Some(state) = state {
                s.state = state.into();
            }
            let _ = self.app.emit("transcript", s);
        }
    }

    fn transcribe(&mut self, item_id: i64) -> Result<Next> {
        let db = self.app.state::<Db>();
        let (path, duration_s, state): (Option<String>, Option<f64>, String) = {
            let conn = db.conn();
            let Some(row) = conn
                .query_row("SELECT path, duration_s, state FROM items WHERE id = ?1", [item_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
                .optional()?
            else {
                return Ok(Next::Cancelled); // removed from the Library
            };
            if status(&conn, item_id)?.state == "done" {
                return Ok(Next::Done);
            }
            row
        };
        if state != "ready" {
            return Err(anyhow!("The audio isn't downloaded yet"));
        }
        let path = path.ok_or_else(|| anyhow!("The audio isn't downloaded yet"))?;

        let model = models::find(models::DEFAULT)?;
        self.load_engine(model, item_id)?;
        let engine = self.engine.take().expect("loaded above");
        let result = self.transcribe_with(&engine, item_id, &path, model, duration_s);
        self.engine = Some(engine);
        result
    }

    fn transcribe_with(&mut self, engine: &Engine, item_id: i64, path: &str, model: &models::Model, duration_s: Option<f64>) -> Result<Next> {
        let app = self.app.clone();
        let db = app.state::<Db>();
        let (from_ms, prompt) = begin(&db.conn(), item_id, model.id, duration_s.map(|d| (d * 1000.0) as i64))?;
        self.emit(item_id, None);

        let started = Instant::now();
        let mut next = Next::Done;
        let mut first_chunk = true;
        let rx = &self.rx;
        let mut pending: Vec<Msg> = Vec::new();
        run(engine, Path::new(path), from_ms, &prompt, |chunk| {
            save_chunk(&mut app.state::<Db>().conn(), item_id, &chunk)?;
            if first_chunk {
                first_chunk = false;
                eprintln!("item {item_id}: first sentences after {:?}", started.elapsed());
            }
            if let Ok(s) = status(&app.state::<Db>().conn(), item_id) {
                let _ = app.emit("transcript", s);
            }
            // Between chunks, see whether the learner asked for something else.
            while let Ok(m) = rx.try_recv() {
                pending.push(m);
            }
            Ok(pending.is_empty() || !pending.iter().any(|m| matches!(m, Msg::Cancel(i) if *i == item_id) || matches!(m, Msg::Request { item_id: i, first: true } if *i != item_id)))
        })
        .with_context(|| format!("transcribing {}", Path::new(path).file_name().map(|n| n.to_string_lossy()).unwrap_or_default()))?;

        for m in pending {
            if let Msg::Cancel(i) = m
                && i == item_id
            {
                let _ = db.conn().execute("DELETE FROM transcripts WHERE item_id = ?1", [item_id]);
                let _ = db.conn().execute("DELETE FROM sentences WHERE item_id = ?1", [item_id]);
                next = Next::Cancelled;
                continue;
            }
            if self.handle(m, Some(item_id)) && !matches!(next, Next::Cancelled) {
                next = Next::Yield;
            }
        }
        if matches!(next, Next::Yield) {
            let _ = db.conn().execute("UPDATE transcripts SET state = 'queued' WHERE item_id = ?1 AND state = 'running'", [item_id]);
        }
        eprintln!("item {item_id}: chunk work took {:?}", started.elapsed());
        Ok(next)
    }

    /// The loaded model, downloading it first if this computer doesn't have it yet.
    fn load_engine(&mut self, model: &'static models::Model, item_id: i64) -> Result<()> {
        if self.engine.as_ref().is_some_and(|e| e.model_id == model.id) {
            return Ok(());
        }
        let dir = model_dir(&self.app)?;
        let file = match models::installed(&dir, model) {
            Some(p) => p,
            None => {
                self.emit(item_id, Some("model"));
                let app = self.app.clone();
                let cancel = AtomicBool::new(false);
                tauri::async_runtime::block_on(models::download(&dir, model, &cancel, &move |p| {
                    let _ = app.emit("model-download", p);
                }))
                .context("Downloading the speech model")?
            }
        };
        self.engine = Some(Engine::load(&file, model.id)?);
        Ok(())
    }
}

pub fn model_dir(app: &AppHandle) -> Result<std::path::PathBuf> {
    Ok(app.path().app_data_dir()?.join("models"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transcripts_resume_where_they_stopped() {
        let db = Db::open_in_memory().unwrap();
        let mut conn = db.conn();
        conn.execute("INSERT INTO items (id, title, source, state, added_at) VALUES (1, 't', 's', 'ready', 0)", []).unwrap();
        assert_eq!(status(&conn, 1).unwrap().state, "none");

        assert_eq!(begin(&conn, 1, "base.en", Some(60_000)).unwrap(), (0, String::new()));
        let s = |text: &str, start| Sentence {
            start_ms: start,
            end_ms: start + 2_000,
            text: text.into(),
            words: vec![Word { start_ms: start, end_ms: start + 2_000, text: text.into() }],
        };
        save_chunk(&mut conn, 1, &Chunk { sentences: vec![s("One.", 0), s("Two.", 3_000)], done_ms: 5_000, finished: false }).unwrap();
        let st = status(&conn, 1).unwrap();
        assert_eq!((st.state.as_str(), st.done_ms, st.sentences), ("running", 5_000, 2));

        // Quit and start again: resume at 5 s with the last sentence as context.
        assert_eq!(begin(&conn, 1, "base.en", Some(60_000)).unwrap(), (5_000, "Two.".to_string()));
        save_chunk(&mut conn, 1, &Chunk { sentences: vec![s("Three.", 5_000)], done_ms: 60_000, finished: true }).unwrap();
        let st = status(&conn, 1).unwrap();
        assert_eq!((st.state.as_str(), st.sentences), ("done", 3));
        let all = sentences(&conn, 1).unwrap();
        assert_eq!(all.iter().map(|s| (s.idx, s.text.as_str())).collect::<Vec<_>>(), [(0, "One."), (1, "Two."), (2, "Three.")]);

        // Another model starts over.
        assert_eq!(begin(&conn, 1, "small.en", None).unwrap().0, 0);
        assert_eq!(sentences(&conn, 1).unwrap().len(), 0);

        // Removing the item removes its transcript.
        conn.execute("DELETE FROM items WHERE id = 1", []).unwrap();
        assert_eq!(status(&conn, 1).unwrap().state, "none");
    }

    #[test]
    fn audio_is_read_in_pieces_from_any_point() {
        let dir = audio::tests::temp_dir("pcm");
        let wav = audio::tests::ramp_wav(&dir, 8_000, 10);
        let mut pcm = Pcm::open(&wav, 2_000).unwrap();
        assert_eq!(pcm.take(2_000, 5_000).unwrap().len(), 48_000, "3 s at 16 kHz");
        assert_eq!(pcm.take(4_000, 20_000).unwrap().len(), 96_000, "to the end: 6 s");
        assert!(pcm.finished_at(20_000));
        std::fs::remove_dir_all(dir).ok();
    }
}
