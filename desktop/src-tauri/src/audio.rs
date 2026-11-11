//! Reading audio files: MP3, M4A/AAC (also the sound of MP4 videos), WAV, FLAC and Ogg Vorbis.
//! `Reader` decodes to mono from any point in the file, for playback; `load_for_whisper` turns a
//! whole file into the 16 kHz mono samples Whisper needs.

use std::{fs::File, path::Path};

use anyhow::{anyhow, Context, Result};
use rubato::{audioadapter_buffers::direct::SequentialSliceOfVecs, Fft, FixedSync, Resampler};
use symphonia::core::{
    codecs::audio::{AudioDecoder, AudioDecoderOptions},
    errors::Error as SymphoniaError,
    formats::{probe::Hint, FormatOptions, FormatReader, SeekMode, SeekTo, TrackType},
    io::MediaSourceStream,
    meta::MetadataOptions,
    units::{Time, TimeBase},
};

/// Whisper's input sample rate.
pub const WHISPER_RATE: u32 = 16_000;

/// The file extensions the app accepts as audio or video.
pub const EXTENSIONS: &[&str] = &["mp3", "m4a", "mp4", "m4v", "mov", "aac", "wav", "flac", "ogg", "oga"];

/// An open audio file, decoded to mono one packet at a time.
pub struct Reader {
    format: Box<dyn FormatReader>,
    decoder: Box<dyn AudioDecoder>,
    track_id: u32,
    time_base: Option<TimeBase>,
    /// The file's sample rate; 0 until known.
    pub rate: u32,
    /// Duration in seconds, when the container says.
    pub duration: Option<f64>,
    /// Samples still to drop after an accurate seek, which lands on the packet before the target.
    skip: usize,
    interleaved: Vec<f32>,
}

impl Reader {
    pub fn open(path: &Path) -> Result<Self> {
        let file = File::open(path).with_context(|| format!("opening {}", path.display()))?;
        let mss = MediaSourceStream::new(Box::new(file), Default::default());

        let mut hint = Hint::new();
        if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
            hint.with_extension(ext);
        }

        let format = symphonia::default::get_probe()
            .probe(&hint, mss, FormatOptions::default(), MetadataOptions::default())
            .context("this file's format isn't supported")?;

        let track = format
            .default_track(TrackType::Audio)
            .ok_or_else(|| anyhow!("the file has no audio track"))?;
        let track_id = track.id;
        let time_base = track.time_base;
        let params = track
            .codec_params
            .as_ref()
            .and_then(|p| p.audio())
            .ok_or_else(|| anyhow!("the audio track has no codec parameters"))?
            .clone();
        let rate = params.sample_rate.unwrap_or(0);
        let duration = match (track.duration, time_base) {
            (Some(d), Some(tb)) => tb.calc_duration(d).map(|t| t.as_secs_f64()),
            _ => None,
        }
        .or_else(|| match (track.num_frames, rate) {
            (Some(n), r) if r > 0 => Some(n as f64 / r as f64),
            _ => None,
        });

        let decoder = symphonia::default::get_codecs()
            .make_audio_decoder(&params, &AudioDecoderOptions::default())
            .context("this audio codec isn't supported")?;

        Ok(Reader { format, decoder, track_id, time_base, rate, duration, skip: 0, interleaved: Vec::new() })
    }

    /// Moves to `ms` from the start. Later reads begin exactly there.
    pub fn seek_ms(&mut self, ms: u64) -> Result<()> {
        if ms == 0 {
            return Ok(());
        }
        let seeked = self
            .format
            .seek(SeekMode::Accurate, SeekTo::Time { time: Time::from_millis_u64(ms), track_id: Some(self.track_id) })
            .context("seeking in the file")?;
        self.decoder.reset();
        let early = seeked.required_ts.get() - seeked.actual_ts.get();
        self.skip = match self.time_base {
            Some(tb) if early > 0 => {
                let secs = early as f64 * tb.numer.get() as f64 / tb.denom.get() as f64;
                (secs * self.rate as f64).round() as usize
            }
            _ => 0,
        };
        Ok(())
    }

    /// Appends the next packet's samples, mixed to mono, to `out`. False at the end of the file.
    pub fn read_into(&mut self, out: &mut Vec<f32>) -> Result<bool> {
        loop {
            let packet = match self.format.next_packet() {
                Ok(Some(p)) => p,
                Ok(None) => return Ok(false),
                Err(SymphoniaError::IoError(e)) if e.kind() == std::io::ErrorKind::UnexpectedEof => return Ok(false),
                Err(e) => return Err(e.into()),
            };
            if packet.track_id != self.track_id {
                continue;
            }
            let buf = match self.decoder.decode(&packet) {
                Ok(b) => b,
                // A corrupt frame is skipped rather than failing the whole episode.
                Err(SymphoniaError::DecodeError(_)) => continue,
                Err(e) => return Err(e.into()),
            };
            let spec = buf.spec();
            self.rate = spec.rate();
            let channels = spec.channels().count().max(1);
            buf.copy_to_vec_interleaved(&mut self.interleaved);
            let frames = self.interleaved.chunks_exact(channels);
            let drop = self.skip.min(frames.len());
            self.skip -= drop;
            out.extend(frames.skip(drop).map(|f| f.iter().sum::<f32>() / channels as f32));
            return Ok(true);
        }
    }
}

/// Decodes a whole file to mono f32 samples at its own rate.
pub fn decode_mono(path: &Path) -> Result<(Vec<f32>, u32)> {
    let mut reader = Reader::open(path)?;
    let mut mono = Vec::new();
    while reader.read_into(&mut mono)? {}
    if reader.rate == 0 || mono.is_empty() {
        return Err(anyhow!("no audio could be decoded from the file"));
    }
    Ok((mono, reader.rate))
}

/// Decodes `start_ms..end_ms` to mono samples at the file's rate, exact to the sample.
pub fn decode_range(path: &Path, start_ms: u64, end_ms: u64) -> Result<(Vec<f32>, u32)> {
    let mut reader = Reader::open(path)?;
    reader.seek_ms(start_ms)?;
    let mut out = Vec::new();
    while reader.read_into(&mut out)? {
        if reader.rate > 0 && out.len() as u64 >= (end_ms - start_ms) * reader.rate as u64 / 1000 {
            break;
        }
    }
    if reader.rate == 0 {
        return Err(anyhow!("no audio could be decoded from the file"));
    }
    out.truncate(((end_ms - start_ms) * reader.rate as u64 / 1000) as usize);
    Ok((out, reader.rate))
}

/// Length in seconds: from the file's header when it has one, otherwise by decoding it.
pub fn duration(path: &Path) -> Result<f64> {
    let mut reader = Reader::open(path)?;
    if let Some(d) = reader.duration.filter(|d| *d > 0.0) {
        return Ok(d);
    }
    let mut frames = 0usize;
    let mut buf = Vec::new();
    while reader.read_into(&mut buf)? {
        frames += buf.len();
        buf.clear();
    }
    if reader.rate == 0 {
        return Err(anyhow!("no audio could be decoded from the file"));
    }
    Ok(frames as f64 / reader.rate as f64)
}

/// Resamples mono audio to `to` Hz.
pub fn resample(samples: Vec<f32>, from: u32, to: u32) -> Result<Vec<f32>> {
    if from == to {
        return Ok(samples);
    }
    let len = samples.len();
    let mut resampler = Fft::<f32>::new(from as usize, to as usize, 1024, 1, FixedSync::Both)
        .map_err(|e| anyhow!("resampler: {e}"))?;
    let input = [samples];
    let adapter = SequentialSliceOfVecs::new(&input, 1, len).map_err(|e| anyhow!("resampler: {e}"))?;
    let out = resampler
        .process_all(&adapter, len, None)
        .map_err(|e| anyhow!("resampler: {e}"))?;
    Ok(out.take_data())
}

/// Decodes a file straight to Whisper's format: mono, 16 kHz.
pub fn load_for_whisper(path: &Path) -> Result<Vec<f32>> {
    let (mono, rate) = decode_mono(path)?;
    resample(mono, rate, WHISPER_RATE)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// Writes a 16-bit mono WAV whose sample `i` encodes its own position, so tests can check where a read began.
    pub(crate) fn ramp_wav(dir: &Path, rate: u32, seconds: u32) -> std::path::PathBuf {
        let n = rate * seconds;
        let mut bytes = Vec::with_capacity(44 + n as usize * 2);
        bytes.extend_from_slice(b"RIFF");
        bytes.extend_from_slice(&(36 + n * 2).to_le_bytes());
        bytes.extend_from_slice(b"WAVEfmt ");
        bytes.extend_from_slice(&16u32.to_le_bytes());
        bytes.extend_from_slice(&1u16.to_le_bytes()); // PCM
        bytes.extend_from_slice(&1u16.to_le_bytes()); // mono
        bytes.extend_from_slice(&rate.to_le_bytes());
        bytes.extend_from_slice(&(rate * 2).to_le_bytes());
        bytes.extend_from_slice(&2u16.to_le_bytes());
        bytes.extend_from_slice(&16u16.to_le_bytes());
        bytes.extend_from_slice(b"data");
        bytes.extend_from_slice(&(n * 2).to_le_bytes());
        for i in 0..n {
            // One step per 10 ms, so the value says which 10 ms block a sample came from.
            let v = ((i * 100 / rate) % 30_000) as i16;
            bytes.extend_from_slice(&v.to_le_bytes());
        }
        let path = dir.join(format!("ramp-{rate}-{seconds}.wav"));
        std::fs::write(&path, bytes).unwrap();
        path
    }

    pub(crate) fn temp_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("eksigo-test-{name}-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn resampling_keeps_the_duration() {
        let one_second: Vec<f32> = (0..44_100).map(|i| (i as f32 * 0.05).sin() * 0.5).collect();
        let out = resample(one_second, 44_100, WHISPER_RATE).unwrap();
        assert!((out.len() as i64 - 16_000).abs() < 32, "got {} samples", out.len());
    }

    #[test]
    fn same_rate_is_untouched() {
        let s = vec![0.1, 0.2, 0.3];
        assert_eq!(resample(s.clone(), 16_000, 16_000).unwrap(), s);
    }

    #[test]
    fn a_range_starts_and_ends_exactly() {
        let dir = temp_dir("range");
        let wav = ramp_wav(&dir, 8_000, 10);
        let (samples, rate) = decode_range(&wav, 3_250, 5_000).unwrap();
        assert_eq!(rate, 8_000);
        assert_eq!(samples.len(), 14_000, "1.75 s at 8 kHz");
        // The first sample belongs to the 10 ms block starting at 3.25 s, the last to the one before 5 s.
        let block = |s: f32| (s * 32_768.0).round() as i32;
        assert_eq!(block(samples[0]), 325);
        assert_eq!(block(*samples.last().unwrap()), 499);
        assert_eq!(duration(&wav).unwrap(), 10.0);
        std::fs::remove_dir_all(dir).ok();
    }

    /// Seeking in a real MP3 lands on the same samples as decoding from the start:
    /// `EKSIGO_TEST_AUDIO=episode.mp3 cargo test -- --ignored`.
    #[test]
    #[ignore = "needs EKSIGO_TEST_AUDIO"]
    fn seeking_in_a_real_file_is_exact() {
        let path = std::path::PathBuf::from(std::env::var("EKSIGO_TEST_AUDIO").unwrap());
        let (all, rate) = decode_mono(&path).unwrap();
        let t = std::time::Instant::now();
        let (part, _) = decode_range(&path, 61_230, 64_980).unwrap();
        println!("decoded 3.75 s from 61.23 s in {:?}; file {} s at {rate} Hz", t.elapsed(), all.len() / rate as usize);
        let start = 61_230 * rate as usize / 1000;
        assert_eq!(part.len(), 3_750 * rate as usize / 1000);
        let diff = part.iter().zip(&all[start..]).map(|(a, b)| (a - b).abs()).fold(0.0f32, f32::max);
        assert!(diff < 1e-3, "samples differ by up to {diff}");
    }
}
