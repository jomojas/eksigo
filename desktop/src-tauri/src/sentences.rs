//! Turning Whisper's timed words into sentences sized for dictation: split at sentence ends, long ones
//! broken at a comma or a pause, tiny ones ("Yes.") joined to the next, and each given a little air at
//! both ends so the first and last sounds aren't clipped.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Word {
    pub start_ms: i64,
    pub end_ms: i64,
    /// As Whisper wrote it, punctuation included, without the leading space.
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Sentence {
    pub start_ms: i64,
    pub end_ms: i64,
    pub text: String,
    #[serde(skip)]
    pub words: Vec<Word>,
}

/// Longer sentences are hard to hold in mind while typing; they are split.
const MAX_WORDS: usize = 28;
const MAX_MS: i64 = 14_000;
/// A sentence this short is joined to the next one when the speaker carries straight on.
const MIN_WORDS: usize = 3;
/// A silence this long ends a sentence even without a full stop.
const PAUSE_MS: i64 = 1_500;
/// Air added before and after, never overlapping the neighbours.
const LEAD_MS: i64 = 150;
const TAIL_MS: i64 = 250;

const ABBREVIATIONS: &[&str] = &[
    "mr.", "mrs.", "ms.", "dr.", "prof.", "st.", "mt.", "vs.", "etc.", "e.g.", "i.e.", "u.s.", "u.k.", "a.m.", "p.m.", "no.", "jr.", "sr.", "approx.",
];

fn ends_sentence(word: &str) -> bool {
    let w = word.trim_end_matches(['"', '\'', '”', '’', ')', ']']);
    if !w.ends_with(['.', '?', '!', '…']) {
        return false;
    }
    let lower = w.to_lowercase();
    // "Mr." and "U.S." don't end a sentence; nor does a single initial like "J.".
    !(ABBREVIATIONS.contains(&lower.as_str()) || (w.len() == 2 && w.starts_with(|c: char| c.is_alphabetic())))
}

fn ends_clause(word: &str) -> bool {
    word.ends_with([',', ';', ':', '—', '–'])
}

fn starts_upper(word: &str) -> bool {
    word.trim_start_matches(['"', '\'', '“', '‘', '(']).starts_with(|c: char| c.is_uppercase() || c.is_numeric())
}

/// Splits timed words into sentences.
pub fn split(words: &[Word]) -> Vec<Sentence> {
    let mut groups: Vec<Vec<Word>> = Vec::new();
    let mut current: Vec<Word> = Vec::new();
    for (i, w) in words.iter().enumerate() {
        current.push(w.clone());
        let next = words.get(i + 1);
        let full_stop = ends_sentence(&w.text) && next.is_none_or(|n| starts_upper(&n.text));
        let long_pause = next.is_some_and(|n| n.start_ms - w.end_ms >= PAUSE_MS);
        if full_stop || long_pause || next.is_none() {
            groups.push(std::mem::take(&mut current));
        }
    }

    let groups: Vec<Vec<Word>> = groups.into_iter().flat_map(break_long).collect();
    let groups = join_short(groups);

    let mut out: Vec<Sentence> = groups
        .into_iter()
        .map(|g| Sentence {
            start_ms: g[0].start_ms,
            end_ms: g[g.len() - 1].end_ms,
            text: g.iter().map(|w| w.text.as_str()).collect::<Vec<_>>().join(" "),
            words: g,
        })
        .collect();

    // Air at both ends, up to halfway to the neighbour.
    for i in 0..out.len() {
        let prev_end = if i > 0 { out[i - 1].words.last().unwrap().end_ms } else { 0 };
        let next_start = out.get(i + 1).map(|s| s.words[0].start_ms);
        let s = &mut out[i];
        s.start_ms = (s.start_ms - LEAD_MS).max((prev_end + s.start_ms) / 2).max(0);
        s.end_ms = match next_start {
            Some(n) => (s.end_ms + TAIL_MS).min((s.end_ms + n) / 2),
            None => s.end_ms + TAIL_MS,
        };
    }
    // Whisper's word times can overlap a little; neighbours meet in the middle instead.
    for i in 1..out.len() {
        if out[i].start_ms < out[i - 1].end_ms {
            let mid = (out[i].start_ms + out[i - 1].end_ms) / 2;
            out[i - 1].end_ms = mid;
            out[i].start_ms = mid;
        }
    }
    out
}

/// Splits a too-long sentence at the clause end nearest its middle, or else its longest pause, repeatedly.
fn break_long(words: Vec<Word>) -> Vec<Vec<Word>> {
    let dur = words.last().map(|l| l.end_ms - words[0].start_ms).unwrap_or(0);
    if words.len() <= MAX_WORDS && dur <= MAX_MS || words.len() < 2 * MIN_WORDS {
        return vec![words];
    }
    let mid = words.len() as f64 / 2.0;
    let candidates = MIN_WORDS..words.len() - MIN_WORDS;
    let at = candidates
        .clone()
        .filter(|&i| ends_clause(&words[i - 1].text))
        .min_by(|&a, &b| (a as f64 - mid).abs().total_cmp(&(b as f64 - mid).abs()))
        .unwrap_or_else(|| {
            candidates
                .max_by_key(|&i| (words[i].start_ms - words[i - 1].end_ms, -((i as f64 - mid).abs() as i64)))
                .unwrap()
        });
    let mut words = words;
    let rest = words.split_off(at);
    let mut out = break_long(words);
    out.extend(break_long(rest));
    out
}

/// Joins sentences of one or two words to the following one, when there is little pause between them.
fn join_short(groups: Vec<Vec<Word>>) -> Vec<Vec<Word>> {
    let mut out: Vec<Vec<Word>> = Vec::new();
    let mut carry: Vec<Word> = Vec::new();
    let n = groups.len();
    for (i, g) in groups.into_iter().enumerate() {
        let mut g = if carry.is_empty() { g } else { std::mem::take(&mut carry).into_iter().chain(g).collect() };
        let is_last = i + 1 == n;
        if g.len() < MIN_WORDS {
            if !is_last {
                carry = std::mem::take(&mut g);
                continue;
            }
            // A one-word last sentence ("Bye!") joins the sentence before it.
            if let Some(prev) = out.last_mut().filter(|_| g.len() == 1) {
                prev.extend(g);
                continue;
            }
        }
        out.push(g);
    }
    if !carry.is_empty() {
        match out.last_mut() {
            Some(last) => last.extend(carry),
            None => out.push(carry),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Words a quarter of a second apart, from a sentence written out; "|" marks a two-second pause.
    fn words(text: &str) -> Vec<Word> {
        let mut t = 1_000;
        let mut out = Vec::new();
        for w in text.split(' ') {
            if w == "|" {
                t += 2_000;
                continue;
            }
            out.push(Word { start_ms: t, end_ms: t + 200, text: w.to_string() });
            t += 250;
        }
        out
    }

    fn texts(s: &[Sentence]) -> Vec<&str> {
        s.iter().map(|s| s.text.as_str()).collect()
    }

    #[test]
    fn splits_at_sentence_ends() {
        let s = split(&words("Hello there, Neil. How are you today? I'm fine, thanks! Let's begin."));
        assert_eq!(texts(&s), ["Hello there, Neil.", "How are you today?", "I'm fine, thanks!", "Let's begin."]);
    }

    #[test]
    fn abbreviations_and_initials_dont_end_a_sentence() {
        let s = split(&words("Mr. Smith lives in the U.S. now. He met J. K. Rowling once."));
        assert_eq!(texts(&s), ["Mr. Smith lives in the U.S. now.", "He met J. K. Rowling once."]);
    }

    #[test]
    fn a_full_stop_before_a_lowercase_word_is_not_an_end() {
        let s = split(&words("It costs 3.5 dollars or so. and then we left early today."));
        assert_eq!(s.len(), 1);
    }

    #[test]
    fn a_long_pause_ends_a_sentence() {
        let s = split(&words("so that was the first part | and now the second part begins"));
        assert_eq!(texts(&s), ["so that was the first part", "and now the second part begins"]);
    }

    #[test]
    fn long_sentences_break_at_a_comma_near_the_middle() {
        let long = "One two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen, sixteen seventeen eighteen nineteen twenty twenty-one twenty-two twenty-three twenty-four twenty-five twenty-six twenty-seven twenty-eight twenty-nine thirty.";
        let s = split(&words(long));
        assert_eq!(s.len(), 2);
        assert!(s[0].text.ends_with("fifteen,"));
        assert!(s.iter().all(|s| s.words.len() <= MAX_WORDS));
    }

    #[test]
    fn tiny_sentences_join_the_next() {
        let s = split(&words("Yes. Right. That is exactly what I meant."));
        assert_eq!(texts(&s), ["Yes. Right. That is exactly what I meant."]);
        let s = split(&words("That is exactly what I meant. Yes."));
        assert_eq!(texts(&s), ["That is exactly what I meant. Yes."], "a short last sentence joins the one before");
    }

    #[test]
    fn times_get_air_without_overlapping() {
        let s = split(&words("This is the first one. This is the second one."));
        assert_eq!(s[0].start_ms, 850, "150 ms before the first word");
        assert!(s[0].end_ms <= s[1].start_ms, "no overlap");
        assert_eq!(s[1].end_ms, s[1].words.last().unwrap().end_ms + TAIL_MS);
        let all = words("Short one here. Next one here.");
        assert!(split(&all).iter().all(|s| s.start_ms >= 0));

        // The next sentence's first word starting before this one's last word ends.
        let mut w = words("This is the first one. This is the second one.");
        w[5].start_ms = w[4].end_ms - 100;
        let s = split(&w);
        assert!(s[0].end_ms <= s[1].start_ms);
    }
}
