//! Playing audio: an exact stretch (a sentence) or from a point onwards (Preview), at 0.7 to 1.5 times
//! the speed with the pitch unchanged (Signalsmith Stretch). One thread owns the sound device and does
//! the decoding, a little ahead of what is heard, so a new request replaces the old one at once.

use std::{
    num::NonZero,
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc, Arc,
    },
    time::Duration,
};

use anyhow::Result;
use serde::Serialize;
use signalsmith_stretch::Stretch;

use crate::audio::{self, Reader};

/// Stretches up to this long are decoded whole and stretched in one go, which is exact to the sample.
const WHOLE_UP_TO_MS: u64 = 120_000;
/// Longer playback is decoded in blocks of this many seconds, kept at most `AHEAD` seconds ahead.
const BLOCK_SECS: f64 = 0.5;
const AHEAD_SECS: f64 = 2.0;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackEvent {
    /// The id the interface gave with `play`, so it can tell its own playback from an older one.
    pub id: u64,
    pub playing: bool,
    /// Where in the file playback is, in milliseconds.
    pub position_ms: u64,
    pub error: Option<String>,
}

pub struct Request {
    pub id: u64,
    pub path: PathBuf,
    pub start_ms: u64,
    pub end_ms: Option<u64>,
    pub speed: f32,
}

enum Cmd {
    Play(Request),
    Stop,
}

pub struct Player {
    tx: mpsc::Sender<Cmd>,
}

impl Player {
    /// Starts the audio thread. `notify` receives the playback state about ten times a second while playing.
    pub fn new(notify: impl Fn(PlaybackEvent) + Send + 'static) -> Self {
        let (tx, rx) = mpsc::channel();
        std::thread::Builder::new()
            .name("eksigo-audio".into())
            .spawn(move || audio_thread(rx, notify))
            .expect("starting the audio thread");
        Player { tx }
    }

    pub fn play(&self, req: Request) {
        let _ = self.tx.send(Cmd::Play(req));
    }

    pub fn stop(&self) {
        let _ = self.tx.send(Cmd::Stop);
    }
}

/// One block of samples on its way to the speakers; counts what has been heard.
struct Block {
    data: Vec<f32>,
    pos: usize,
    rate: NonZero<u32>,
    heard: Arc<AtomicU64>,
}

impl Iterator for Block {
    type Item = f32;
    fn next(&mut self) -> Option<f32> {
        let s = *self.data.get(self.pos)?;
        self.pos += 1;
        self.heard.fetch_add(1, Ordering::Relaxed);
        Some(s)
    }
}

impl rodio::Source for Block {
    fn current_span_len(&self) -> Option<usize> {
        Some(self.data.len() - self.pos)
    }
    fn channels(&self) -> NonZero<u16> {
        NonZero::new(1).unwrap()
    }
    fn sample_rate(&self) -> NonZero<u32> {
        self.rate
    }
    fn total_duration(&self) -> Option<Duration> {
        Some(Duration::from_secs_f64(self.data.len() as f64 / self.rate.get() as f64))
    }
}

/// What is playing now.
struct Job {
    id: u64,
    start_ms: u64,
    speed: f32,
    rate: u32,
    /// Samples (after stretching) sent to the device, and how many of them have been heard.
    sent: u64,
    heard: Arc<AtomicU64>,
    /// `None` once everything has been sent.
    source: Option<Source>,
}

enum Source {
    Stream { reader: Reader, stretch: Option<Stretch>, remaining: Option<u64>, pending: Vec<f32> },
}

impl Job {
    fn position_ms(&self) -> u64 {
        let heard = self.heard.load(Ordering::Relaxed) as f64;
        self.start_ms + (heard / self.rate as f64 * 1000.0 * self.speed as f64) as u64
    }

    fn finished(&self) -> bool {
        self.source.is_none() && self.heard.load(Ordering::Relaxed) >= self.sent
    }

    fn ahead_secs(&self) -> f64 {
        (self.sent - self.heard.load(Ordering::Relaxed).min(self.sent)) as f64 / self.rate as f64
    }
}

/// Prepares a request: short stretches are decoded and stretched completely, long ones stream.
fn start(req: &Request, out: &mut Vec<Vec<f32>>) -> Result<Job> {
    let speed = req.speed.clamp(0.5, 2.0);
    let heard = Arc::new(AtomicU64::new(0));
    match req.end_ms {
        Some(end) if end > req.start_ms && end - req.start_ms <= WHOLE_UP_TO_MS => {
            let (samples, rate) = audio::decode_range(&req.path, req.start_ms, end)?;
            out.push(stretch_whole(samples, rate, speed));
            Ok(Job { id: req.id, start_ms: req.start_ms, speed, rate, sent: 0, heard, source: None })
        }
        end => {
            let mut reader = Reader::open(&req.path)?;
            reader.seek_ms(req.start_ms)?;
            let remaining = end.map(|e| e.saturating_sub(req.start_ms));
            let mut job = Job { id: req.id, start_ms: req.start_ms, speed, rate: 0, sent: 0, heard, source: None };
            // The first packet tells the sample rate.
            let mut pending = Vec::new();
            if !reader.read_into(&mut pending)? {
                return Ok(job);
            }
            job.rate = reader.rate;
            let remaining = remaining.map(|ms| ms * reader.rate as u64 / 1000);
            let stretch = (speed != 1.0).then(|| Stretch::preset_default(1, reader.rate));
            job.source = Some(Source::Stream { reader, stretch, remaining, pending });
            Ok(job)
        }
    }
}

/// The whole stretch at another speed with the same pitch; at normal speed it is left alone.
pub fn stretch_whole(samples: Vec<f32>, rate: u32, speed: f32) -> Vec<f32> {
    if speed == 1.0 || samples.is_empty() {
        return samples;
    }
    let mut out = vec![0.0; (samples.len() as f64 / speed as f64).round() as usize];
    Stretch::preset_default(1, rate).exact(&samples, &mut out);
    out
}

/// Decodes and stretches the next block of a streaming job. Returns the samples, or `None` at the end.
fn next_block(job: &mut Job) -> Result<Option<Vec<f32>>> {
    let Some(Source::Stream { reader, stretch, remaining, pending }) = job.source.as_mut() else {
        return Ok(None);
    };
    let block = (BLOCK_SECS * job.rate as f64) as usize;
    let mut ended = false;
    while pending.len() < block {
        if !reader.read_into(pending)? {
            ended = true;
            break;
        }
    }
    let mut take = pending.len().min(block);
    if let Some(left) = remaining {
        take = take.min(*left as usize);
        *left -= take as u64;
        ended |= *left == 0;
    }
    let input: Vec<f32> = pending.drain(..take).collect();
    let mut out = match stretch {
        None => input,
        Some(s) => {
            let mut out = vec![0.0; (input.len() as f64 / job.speed as f64).round() as usize];
            s.process(&input, &mut out);
            if ended {
                let mut tail = vec![0.0; s.output_latency()];
                s.flush(&mut tail);
                out.extend(tail);
            }
            out
        }
    };
    if ended {
        job.source = None;
        if out.is_empty() {
            return Ok(None);
        }
    }
    Ok(Some(std::mem::take(&mut out)))
}

fn audio_thread(rx: mpsc::Receiver<Cmd>, notify: impl Fn(PlaybackEvent)) {
    // The device is opened on first use, and again if opening failed (headphones plugged in later).
    let mut device: Option<(rodio::MixerDeviceSink, rodio::Player)> = None;
    let mut job: Option<Job> = None;
    let mut ticks = 0u32;

    loop {
        let wait = if job.is_some() { Duration::from_millis(20) } else { Duration::from_secs(3600) };
        match rx.recv_timeout(wait) {
            Ok(Cmd::Stop) => {
                if let Some((_, p)) = &device {
                    p.clear();
                }
                if let Some(j) = job.take() {
                    notify(PlaybackEvent { id: j.id, playing: false, position_ms: j.position_ms(), error: None });
                }
                continue;
            }
            Ok(Cmd::Play(req)) => {
                if let Some((_, p)) = &device {
                    p.clear();
                }
                job = None;
                if device.is_none() {
                    device = open_device().map_err(|e| eprintln!("sound device: {e:#}")).ok();
                }
                let Some((_, player)) = &device else {
                    notify(error_event(req.id, req.start_ms, "No sound output device is available."));
                    continue;
                };
                let mut first = Vec::new();
                match start(&req, &mut first) {
                    Ok(mut j) => {
                        for samples in first {
                            append(player, &mut j, samples);
                        }
                        player.play();
                        notify(PlaybackEvent { id: j.id, playing: true, position_ms: j.start_ms, error: None });
                        job = Some(j);
                    }
                    Err(e) => notify(error_event(req.id, req.start_ms, &format!("{e:#}"))),
                }
                continue;
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => return,
        }

        let (Some(j), Some((_, player))) = (job.as_mut(), device.as_ref()) else { continue };
        while j.source.is_some() && j.ahead_secs() < AHEAD_SECS {
            match next_block(j) {
                Ok(Some(samples)) => append(player, j, samples),
                Ok(None) => break,
                Err(e) => {
                    j.source = None;
                    notify(error_event(j.id, j.position_ms(), &format!("{e:#}")));
                }
            }
        }
        if j.finished() {
            notify(PlaybackEvent { id: j.id, playing: false, position_ms: j.position_ms(), error: None });
            job = None;
            continue;
        }
        ticks += 1;
        if ticks % 5 == 0 {
            notify(PlaybackEvent { id: j.id, playing: true, position_ms: j.position_ms(), error: None });
        }
    }
}

fn append(player: &rodio::Player, job: &mut Job, samples: Vec<f32>) {
    let Some(rate) = NonZero::new(job.rate) else { return };
    job.sent += samples.len() as u64;
    player.append(Block { data: samples, pos: 0, rate, heard: job.heard.clone() });
}

fn error_event(id: u64, position_ms: u64, message: &str) -> PlaybackEvent {
    PlaybackEvent { id, playing: false, position_ms, error: Some(message.to_string()) }
}

fn open_device() -> Result<(rodio::MixerDeviceSink, rodio::Player)> {
    let mut sink = rodio::DeviceSinkBuilder::open_default_sink()?;
    sink.log_on_drop(false);
    let player = rodio::Player::connect_new(sink.mixer());
    Ok((sink, player))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slower_keeps_the_pitch_and_lengthens_the_audio() {
        let rate = 16_000;
        // One second of a 440 Hz tone.
        let tone: Vec<f32> = (0..rate).map(|i| (i as f32 * 440.0 * std::f32::consts::TAU / rate as f32).sin() * 0.5).collect();
        let slow = stretch_whole(tone, rate, 0.7);
        assert_eq!(slow.len(), (rate as f64 / 0.7).round() as usize);
        // Count zero crossings in the middle half: the frequency, so the pitch, should still be about 440 Hz.
        let mid = &slow[slow.len() / 4..slow.len() * 3 / 4];
        let crossings = mid.windows(2).filter(|w| (w[0] < 0.0) != (w[1] < 0.0)).count();
        let hz = crossings as f64 / 2.0 / (mid.len() as f64 / rate as f64);
        assert!((hz - 440.0).abs() < 15.0, "pitch moved to {hz:.0} Hz");
    }

    #[test]
    fn normal_speed_is_untouched() {
        let s = vec![0.1, -0.2, 0.3];
        assert_eq!(stretch_whole(s.clone(), 16_000, 1.0), s);
    }

    /// Plays a real stretch on the sound device and checks the events:
    /// `EKSIGO_TEST_AUDIO=episode.mp3 cargo test plays_on_the_device -- --ignored`.
    #[test]
    #[ignore = "needs EKSIGO_TEST_AUDIO and a sound device"]
    fn plays_on_the_device() {
        let path = PathBuf::from(std::env::var("EKSIGO_TEST_AUDIO").unwrap());
        let (tx, rx) = mpsc::channel();
        let player = Player::new(move |e| tx.send(e).unwrap());
        let t = std::time::Instant::now();
        // 2 s of audio at 0.7: about 2.9 s of sound.
        player.play(Request { id: 7, path: path.clone(), start_ms: 30_000, end_ms: Some(32_000), speed: 0.7 });
        let mut last = None;
        while let Ok(e) = rx.recv_timeout(Duration::from_secs(10)) {
            assert_eq!(e.error, None);
            assert_eq!(e.id, 7);
            let done = !e.playing;
            last = Some(e);
            if done {
                break;
            }
        }
        let last = last.unwrap();
        println!("ended at {} ms after {:?}", last.position_ms, t.elapsed());
        assert!(t.elapsed() > Duration::from_millis(2_600) && t.elapsed() < Duration::from_millis(4_000));
        assert!((31_900..=32_100).contains(&last.position_ms));

        // Streaming from a point, replaced by a stop.
        player.play(Request { id: 8, path, start_ms: 60_000, end_ms: None, speed: 0.85 });
        std::thread::sleep(Duration::from_millis(1_500));
        player.stop();
        let mut stopped = None;
        while let Ok(e) = rx.recv_timeout(Duration::from_secs(2)) {
            if e.id == 8 && !e.playing {
                stopped = Some(e);
                break;
            }
        }
        let stopped = stopped.expect("a stop event");
        println!("stopped at {} ms", stopped.position_ms);
        assert!((61_000..=61_600).contains(&stopped.position_ms));
    }
}
