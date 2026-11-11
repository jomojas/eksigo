//! Decoding audio files into the 16 kHz mono samples Whisper needs.

use std::{fs::File, path::Path};

use anyhow::{anyhow, Context, Result};
use rubato::{audioadapter_buffers::direct::SequentialSliceOfVecs, Fft, FixedSync, Resampler};
use symphonia::core::{
    codecs::audio::AudioDecoderOptions,
    errors::Error as SymphoniaError,
    formats::{probe::Hint, FormatOptions, TrackType},
    io::MediaSourceStream,
    meta::MetadataOptions,
};

/// Whisper's input sample rate.
pub const WHISPER_RATE: u32 = 16_000;

/// Decodes any supported file (MP3, M4A/AAC, WAV, FLAC, Ogg Vorbis) to mono f32 samples at its own rate.
pub fn decode_mono(path: &Path) -> Result<(Vec<f32>, u32)> {
    let file = File::open(path).with_context(|| format!("opening {}", path.display()))?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());

    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }

    let mut format = symphonia::default::get_probe()
        .probe(&hint, mss, FormatOptions::default(), MetadataOptions::default())
        .context("this file's format isn't supported")?;

    let track = format
        .default_track(TrackType::Audio)
        .ok_or_else(|| anyhow!("the file has no audio track"))?;
    let track_id = track.id;
    let params = track
        .codec_params
        .as_ref()
        .and_then(|p| p.audio())
        .ok_or_else(|| anyhow!("the audio track has no codec parameters"))?
        .clone();

    let mut decoder = symphonia::default::get_codecs()
        .make_audio_decoder(&params, &AudioDecoderOptions::default())
        .context("this audio codec isn't supported")?;

    let mut mono = Vec::new();
    let mut interleaved: Vec<f32> = Vec::new();
    let mut rate = params.sample_rate.unwrap_or(0);

    loop {
        let packet = match format.next_packet() {
            Ok(Some(p)) => p,
            Ok(None) => break,
            Err(SymphoniaError::IoError(e)) if e.kind() == std::io::ErrorKind::UnexpectedEof => break,
            Err(e) => return Err(e.into()),
        };
        if packet.track_id != track_id {
            continue;
        }
        let buf = match decoder.decode(&packet) {
            Ok(b) => b,
            // A corrupt frame is skipped rather than failing the whole episode.
            Err(SymphoniaError::DecodeError(_)) => continue,
            Err(e) => return Err(e.into()),
        };
        let spec = buf.spec();
        rate = spec.rate();
        let channels = spec.channels().count().max(1);
        buf.copy_to_vec_interleaved(&mut interleaved);
        mono.extend(
            interleaved
                .chunks_exact(channels)
                .map(|frame| frame.iter().sum::<f32>() / channels as f32),
        );
    }

    if rate == 0 || mono.is_empty() {
        return Err(anyhow!("no audio could be decoded from the file"));
    }
    Ok((mono, rate))
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
mod tests {
    use super::*;

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
}
