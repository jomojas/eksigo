//! Subtitles next to a video (`Talk.srt`, `Talk.en.srt` beside `Talk.mp4`): when they are in English, they are
//! the transcript instead of Whisper's. They are quicker, and for films usually more accurate. Each cue's words
//! are spread over its time by their length, then split into sentences as Whisper's words are.

use std::path::{Path, PathBuf};

use crate::sentences::{self, Sentence, Word};

/// The subtitles files beside `media` that may be English, best first: `name.srt`, then `name.en.srt` and the
/// like (`.eng`, `.en-US`, `.English`). Another language's file (`name.zh.srt`) is not one of them.
fn candidates(media: &Path) -> Vec<PathBuf> {
    let (Some(dir), Some(stem)) = (media.parent(), media.file_stem().and_then(|s| s.to_str())) else { return Vec::new() };
    let stem = stem.to_lowercase();
    let Ok(entries) = std::fs::read_dir(dir) else { return Vec::new() };
    let mut found: Vec<(u8, PathBuf)> = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_lowercase();
        let Some(base) = name.strip_suffix(".srt") else { continue };
        let rank = if base == stem {
            0
        } else if let Some(tag) = base.strip_prefix(&stem).and_then(|r| r.strip_prefix('.')) {
            match tag {
                "en" | "eng" | "english" => 1,
                t if t.starts_with("en-") || t.starts_with("en_") => 2,
                _ => continue,
            }
        } else {
            continue;
        };
        found.push((rank, entry.path()));
    }
    found.sort();
    found.into_iter().map(|(_, p)| p).collect()
}

/// The sentences of the first English subtitles beside `media` that have something in them.
pub fn load(media: &Path) -> Option<Vec<Sentence>> {
    candidates(media).into_iter().find_map(|file| {
        let words = parse(&decode(&std::fs::read(file).ok()?));
        (!words.is_empty() && english(&words)).then(|| sentences::split(&words))
    })
}

/// Subtitles come as UTF-8 (with or without a byte order mark) or UTF-16; anything else is read as UTF-8.
fn decode(bytes: &[u8]) -> String {
    let utf16 = |le: bool| {
        let units: Vec<u16> = bytes[2..].chunks_exact(2).map(|c| if le { u16::from_le_bytes([c[0], c[1]]) } else { u16::from_be_bytes([c[0], c[1]]) }).collect();
        String::from_utf16_lossy(&units)
    };
    match bytes {
        [0xFF, 0xFE, ..] => utf16(true),
        [0xFE, 0xFF, ..] => utf16(false),
        [0xEF, 0xBB, 0xBF, rest @ ..] => String::from_utf8_lossy(rest).into_owned(),
        _ => String::from_utf8_lossy(bytes).into_owned(),
    }
}

/// Mostly Latin letters: English, as far as can be told without a language model.
fn english(words: &[Word]) -> bool {
    let (mut latin, mut all) = (0usize, 0usize);
    for c in words.iter().flat_map(|w| w.text.chars()).filter(|c| c.is_alphabetic()) {
        all += 1;
        if c.is_ascii_alphabetic() {
            latin += 1;
        }
    }
    all > 0 && latin * 10 >= all * 9
}

/// `00:01:02,500` (or with a dot) in milliseconds.
fn time(s: &str) -> Option<i64> {
    let s = s.trim().replace('.', ",");
    let (hms, ms) = s.split_once(',').unwrap_or((s.as_str(), "0"));
    let parts: Vec<i64> = hms.split(':').map(|p| p.trim().parse().ok()).collect::<Option<_>>()?;
    let secs = match parts.as_slice() {
        [h, m, s] => h * 3600 + m * 60 + s,
        [m, s] => m * 60 + s,
        _ => return None,
    };
    let ms: i64 = format!("{:0<3}", &ms.trim()[..ms.trim().len().min(3)]).parse().ok()?;
    Some(secs * 1000 + ms)
}

/// One line of a cue as it is said: no styling tags, no sound descriptions, no speaker dashes or names.
fn clean(line: &str) -> String {
    let mut out = String::new();
    let mut depth = 0;
    for c in line.chars() {
        match c {
            '<' | '{' => depth += 1,
            '>' | '}' if depth > 0 => depth -= 1,
            _ if depth == 0 => out.push(c),
            _ => {}
        }
    }
    let mut t = out.trim();
    // A whole line that describes a sound: [music], (laughs), ♪ …
    if (t.starts_with('[') && t.ends_with(']')) || (t.starts_with('(') && t.ends_with(')')) || t.starts_with('♪') || t.starts_with('#') {
        return String::new();
    }
    t = t.trim_start_matches(['-', '–', '—']).trim();
    // "JOHN: Hello" → "Hello".
    if let Some((who, rest)) = t.split_once(':') {
        if !who.is_empty() && who.len() <= 20 && who.chars().all(|c| c.is_uppercase() || c == ' ' || c == '.') {
            t = rest.trim();
        }
    }
    t.to_string()
}

/// The cues' words, each cue's time shared out by the words' lengths.
fn parse(text: &str) -> Vec<Word> {
    let text = text.replace("\r\n", "\n").replace('\r', "\n");
    let mut words = Vec::new();
    for block in text.split("\n\n") {
        let mut lines = block.lines().map(str::trim).filter(|l| !l.is_empty());
        let Some(mut first) = lines.next() else { continue };
        if !first.contains("-->") {
            match lines.next() {
                Some(l) => first = l,
                None => continue,
            }
        }
        let Some((a, b)) = first.split_once("-->") else { continue };
        // Anything after the end time (positions) is ignored.
        let (Some(start), Some(end)) = (time(a), time(b.split_whitespace().next().unwrap_or(""))) else { continue };
        if end <= start {
            continue;
        }
        let said: Vec<String> = lines.map(clean).filter(|l| !l.is_empty()).collect();
        let cue: Vec<&str> = said.iter().flat_map(|l| l.split_whitespace()).collect();
        let total: usize = cue.iter().map(|w| w.chars().count() + 1).sum();
        let mut at = start;
        let mut done = 0usize;
        for w in cue {
            done += w.chars().count() + 1;
            let until = start + ((end - start) as f64 * done as f64 / total as f64).round() as i64;
            words.push(Word { start_ms: at, end_ms: until, text: w.to_string() });
            at = until;
        }
    }
    words
}

#[cfg(test)]
mod tests {
    use super::*;

    const SRT: &str = "1\r\n00:00:01,000 --> 00:00:03,000\r\n<i>I was going to call you,</i>\r\n\r\n2\r\n00:00:03,200 --> 00:00:05,000 X1:10\r\n- but the meeting got pushed back.\r\n\r\n3\r\n00:00:05,500 --> 00:00:06,000\r\n[phone rings]\r\n\r\n4\r\n00:00:06,000 --> 00:00:08,000\r\nANNA: Thursday? Great.\r\n";

    #[test]
    fn cues_become_timed_words_and_sentences() {
        let words = parse(SRT);
        let text: Vec<&str> = words.iter().map(|w| w.text.as_str()).collect();
        assert_eq!(text.join(" "), "I was going to call you, but the meeting got pushed back. Thursday? Great.");
        assert_eq!((words[0].start_ms, words.last().unwrap().end_ms), (1000, 8000));
        assert!(words.windows(2).all(|p| p[0].end_ms <= p[1].start_ms), "in order, not overlapping");

        let s = sentences::split(&words);
        assert_eq!(s[0].text, "I was going to call you, but the meeting got pushed back.");
        // The splitter starts a sentence a little early, as for Whisper's, so its first sound isn't cut.
        assert!((700..=1000).contains(&s[0].start_ms));
    }

    #[test]
    fn times_and_encodings() {
        assert_eq!(time("01:02:03,045"), Some(3_723_045));
        assert_eq!(time("00:00:01.5"), Some(1_500));
        let mut utf16 = vec![0xFF, 0xFE];
        utf16.extend("Hi".encode_utf16().flat_map(|u| u.to_le_bytes()));
        assert_eq!(decode(&utf16), "Hi");
        assert_eq!(decode(b"\xEF\xBB\xBFHi"), "Hi");
    }

    #[test]
    fn the_english_file_beside_the_video_is_found() {
        let dir = std::env::temp_dir().join(format!("eksigo-srt-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let video = dir.join("Talk.mp4");
        std::fs::write(&video, b"").unwrap();
        assert!(load(&video).is_none());
        std::fs::write(dir.join("Talk.zh.srt"), SRT).unwrap();
        assert!(candidates(&video).is_empty(), "another language's file isn't used");
        std::fs::write(dir.join("Talk.en.srt"), SRT).unwrap();
        std::fs::write(dir.join("Talk.srt"), SRT).unwrap();
        assert_eq!(candidates(&video), vec![dir.join("Talk.srt"), dir.join("Talk.en.srt")], "the plain name first");
        assert!(load(&video).is_some_and(|s| s.len() >= 2));

        // A Chinese file under the plain name: the English one is used instead, and with none, Whisper.
        std::fs::write(dir.join("Talk.srt"), "1\n00:00:01,000 --> 00:00:02,000\n你好，世界\n").unwrap();
        assert!(load(&video).is_some());
        std::fs::remove_file(dir.join("Talk.en.srt")).unwrap();
        assert!(load(&video).is_none(), "not English");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
