//! Comparing what the learner typed with what was said, word by word (DESIGN.md, "Comparison").
//!
//! It is lenient about what doesn't show whether the learner heard the words: case, punctuation,
//! contractions ("don't" = "do not"), numbers ("15" = "fifteen"), British and American spelling, hyphens.
//! A word typed in place of another is one of:
//! - **correct**;
//! - **spelling**: not a real English word, and only a letter or two from the right one ("recieve").
//!   The learner heard the word; it counts half;
//! - **wrong**: a real word that isn't the one said (their/there), or too far off to say the learner knew it.
//!
//! `_` or `...` in the typed text is a gap: the learner knows something was said there. Words under a gap
//! are missing, but the gap keeps the words around it lined up.

use std::{borrow::Cow, collections::HashSet, sync::OnceLock};

use serde::{Deserialize, Serialize};

static WORDS: &str = include_str!("../data/words.txt");

fn dictionary() -> &'static HashSet<&'static str> {
    static SET: OnceLock<HashSet<&'static str>> = OnceLock::new();
    SET.get_or_init(|| WORDS.lines().collect())
}

/// Whether `w` (lowercase) is an English word, in any of its spellings.
pub fn is_word(w: &str) -> bool {
    let d = dictionary();
    let w = w.strip_suffix("'s").unwrap_or(w);
    d.contains(w) || d.contains(w.replace('\'', "").as_str())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Mark {
    Correct,
    /// Heard, but misspelled: half a word.
    Spelling,
    Wrong,
    /// In the original, not typed (or under a gap).
    Missing,
    /// Typed, but not in the original.
    Extra,
    /// The learner's `_`.
    Gap,
    /// Punctuation, or a filler like "um": not scored.
    Ignored,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Marked {
    pub text: String,
    pub mark: Mark,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Comparison {
    /// The original sentence, word by word as written.
    pub original: Vec<Marked>,
    /// What the learner typed, word by word.
    pub typed: Vec<Marked>,
    /// Correct words, plus half of each spelling mistake.
    pub credit: f64,
    /// Words that count: the original's, without fillers.
    pub total: u32,
    pub spelling: u32,
}

impl Comparison {
    pub fn accuracy(&self) -> f64 {
        if self.total == 0 {
            1.0
        } else {
            self.credit / self.total as f64
        }
    }
}

/// Compares the learner's text with the original sentence.
/// What the learner marked in the original once it was shown: a word or a phrase, written words `from..=to`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Flag {
    /// Didn't know the word: counts as wrong.
    Unknown,
    /// Knew it, but didn't catch it in the audio: counts as wrong.
    Missed,
    /// Expected something else: counts as wrong.
    Unexpected,
    /// Spelled differently from what the learner thought: half a word, like a misspelling.
    Spelling,
    /// Worth keeping (a nice expression): no effect on the score.
    Keep,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Flagged {
    pub from: usize,
    pub to: usize,
    pub flag: Flag,
}

pub fn compare(original: &str, typed: &str) -> Comparison {
    compare_flagged(original, typed, &[])
}

/// The comparison, with the learner's marks applied: each word scores the worse of what the comparison
/// found and how the learner marked it.
pub fn compare_flagged(original: &str, typed: &str, flags: &[Flagged]) -> Comparison {
    let (o_words, o) = tokens(original, false);
    let (t_words, t) = tokens(typed, true);
    let (mut o_marks, t_marks) = align(&o, &t, &o_words, &t_words);

    for (tok, m) in o.iter().zip(o_marks.iter_mut()) {
        let on = |f: &Flagged| f.from <= tok.to && tok.from <= f.to;
        if flags.iter().any(|f| on(f) && matches!(f.flag, Flag::Unknown | Flag::Missed | Flag::Unexpected)) {
            if matches!(m, Mark::Correct | Mark::Spelling) {
                *m = Mark::Wrong;
            }
        } else if flags.iter().any(|f| on(f) && f.flag == Flag::Spelling) && *m == Mark::Correct {
            *m = Mark::Spelling;
        }
    }

    let mut credit = 0.0;
    let mut spelling = 0;
    for m in &o_marks {
        match m {
            Mark::Correct => credit += 1.0,
            Mark::Spelling => {
                credit += 0.5;
                spelling += 1;
            }
            _ => {}
        }
    }
    Comparison {
        original: by_word(&o_words, &o, &o_marks, false),
        typed: by_word(&t_words, &t, &t_marks, true),
        credit,
        total: o.len() as u32,
        spelling,
    }
}

// ---------- tokens ----------

/// One comparable unit. A written word can give several ("don't" → do, not), and several written words can
/// give one ("twenty five" → 25); `from..=to` are the written words it came from.
#[derive(Debug, Clone)]
struct Tok {
    /// Accepted forms; two tokens match when they share one. "'d" is "would" or "had".
    alts: Vec<String>,
    /// As written, lowercased, for the dictionary.
    raw: String,
    from: usize,
    to: usize,
    gap: bool,
}

const FILLERS: &[&str] = &["um", "uh", "er", "erm", "hmm", "mm", "mhm", "ah", "eh", "uhm", "umm"];

/// Splits text into written words and the tokens compared.
fn tokens(text: &str, typed: bool) -> (Vec<String>, Vec<Tok>) {
    let text = if typed { mark_gaps(text) } else { text.to_string() };
    let words: Vec<String> = text.split_whitespace().map(str::to_string).collect();
    let mut toks: Vec<Tok> = Vec::new();
    for (w, word) in words.iter().enumerate() {
        if typed && word == "_" {
            toks.push(Tok { alts: vec![], raw: "_".into(), from: w, to: w, gap: true });
            continue;
        }
        for piece in pieces(word) {
            for alts in expand(&piece) {
                toks.push(Tok { raw: piece.clone(), alts, from: w, to: w, gap: false });
            }
        }
    }
    // "per cent" is "percent".
    let mut joined: Vec<Tok> = Vec::with_capacity(toks.len());
    for t in toks {
        if t.alts == ["cent"] && joined.last().is_some_and(|l| l.alts == ["per"]) {
            let l = joined.last_mut().unwrap();
            l.alts = vec!["percent".into()];
            l.raw = "percent".into();
            l.to = t.to;
        } else {
            joined.push(t);
        }
    }
    let toks = numbers(joined);
    let toks = toks
        .into_iter()
        .map(|mut t| {
            t.alts = t.alts.iter().map(|a| american(a).into_owned()).collect();
            t
        })
        .collect();
    (words, toks)
}

/// Puts the learner's gap marks (`_`, `__`, `...`, `…`) on their own as "_".
fn mark_gaps(text: &str) -> String {
    let mut out = String::with_capacity(text.len() + 8);
    let chars: Vec<char> = text.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        let dots = chars[i..].iter().take_while(|&&c| c == '.').count();
        if c == '_' || c == '…' || dots >= 2 {
            let mut j = i;
            while j < chars.len() && (chars[j] == '_' || chars[j] == '…' || chars[j] == '.') {
                j += 1;
            }
            out.push_str(" _ ");
            i = j;
        } else {
            out.push(c);
            i += 1;
        }
    }
    out
}

/// A written word as lowercase pieces: punctuation off, split at hyphens and dashes, currency and percent
/// signs said as words, fillers dropped.
fn pieces(word: &str) -> Vec<String> {
    let w: String = word.to_lowercase().replace(['’', '‘', '`'], "'");
    let mut out = Vec::new();
    for part in w.split(['-', '–', '—', '/']) {
        let mut part = part.trim_matches(|c: char| !(c.is_alphanumeric() || "$£€%'".contains(c))).trim_matches('\'');
        let currency = match part.chars().next() {
            Some('$') => Some("dollars"),
            Some('£') => Some("pounds"),
            Some('€') => Some("euros"),
            _ => None,
        };
        if currency.is_some() {
            part = &part[part.chars().next().unwrap().len_utf8()..];
        }
        let percent = part.ends_with('%');
        let part = part.trim_end_matches('%');
        // Keep "3.5" and "2,000" (as 2000); drop the dots of "u.s." and any other marks inside.
        let chars: Vec<char> = part.chars().collect();
        let mut clean = String::new();
        for (i, &c) in chars.iter().enumerate() {
            let between_digits = i > 0 && i + 1 < chars.len() && chars[i - 1].is_ascii_digit() && chars[i + 1].is_ascii_digit();
            if c.is_alphanumeric() || c == '\'' || (c == '.' && between_digits) {
                clean.push(c);
            }
        }
        if !clean.is_empty() && !FILLERS.contains(&clean.as_str()) {
            out.push(clean);
        }
        if let Some(c) = currency {
            out.push(c.into());
        }
        if percent {
            out.push("percent".into());
        }
    }
    out
}

const S_IS: &[&str] = &["it", "he", "she", "that", "what", "there", "here", "who", "where", "how", "when", "why", "this", "everyone", "everything", "nobody", "somebody", "someone"];

/// Contractions in full, each token with its accepted forms.
fn expand(p: &str) -> Vec<Vec<String>> {
    let one = |s: &str| vec![s.to_string()];
    let both = |a: &str, b: &str| vec![vec![a.to_string()], vec![b.to_string()]];
    // Written without the apostrophe, these aren't other words (or hardly ever mean them).
    let bare: Option<(&str, &str)> = match p {
        "won't" | "wont" => Some(("will", "not")),
        "can't" | "cant" | "cannot" => Some(("can", "not")),
        "shan't" => Some(("shall", "not")),
        "let's" => Some(("let", "us")),
        "dont" => Some(("do", "not")),
        "doesnt" => Some(("does", "not")),
        "didnt" => Some(("did", "not")),
        "isnt" => Some(("is", "not")),
        "wasnt" => Some(("was", "not")),
        "werent" => Some(("were", "not")),
        "arent" => Some(("are", "not")),
        "havent" => Some(("have", "not")),
        "hasnt" => Some(("has", "not")),
        "hadnt" => Some(("had", "not")),
        "wouldnt" => Some(("would", "not")),
        "couldnt" => Some(("could", "not")),
        "shouldnt" => Some(("should", "not")),
        "mustnt" => Some(("must", "not")),
        "im" => Some(("i", "am")),
        "ive" => Some(("i", "have")),
        "youre" => Some(("you", "are")),
        "youve" => Some(("you", "have")),
        "youll" => Some(("you", "will")),
        "theyre" => Some(("they", "are")),
        "theyve" => Some(("they", "have")),
        "theyll" => Some(("they", "will")),
        "weve" => Some(("we", "have")),
        "thats" => Some(("that", "is")),
        "whats" => Some(("what", "is")),
        "theres" => Some(("there", "is")),
        _ => None,
    };
    if let Some((a, b)) = bare {
        return both(a, b);
    }
    if let Some(stem) = p.strip_suffix("n't") {
        return vec![one(stem), one("not")];
    }
    for (suffix, full) in [("'re", "are"), ("'ve", "have"), ("'ll", "will"), ("'m", "am")] {
        if let Some(stem) = p.strip_suffix(suffix) {
            return vec![one(stem), one(full)];
        }
    }
    if let Some(stem) = p.strip_suffix("'d") {
        return vec![one(stem), vec!["would".into(), "had".into()]];
    }
    if let Some(stem) = p.strip_suffix("'s") {
        if S_IS.contains(&stem) {
            return vec![one(stem), vec!["is".into(), "has".into()]];
        }
    }
    vec![one(p)]
}

// ---------- numbers ----------

fn unit(w: &str) -> Option<u64> {
    ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"].iter().position(|&u| u == w).map(|v| v as u64)
}
fn teen(w: &str) -> Option<u64> {
    ["ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"]
        .iter()
        .position(|&u| u == w)
        .map(|v| v as u64 + 10)
}
fn tens(w: &str) -> Option<u64> {
    ["twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"].iter().position(|&u| u == w).map(|v| (v as u64 + 2) * 10)
}
fn multiplier(w: &str) -> Option<u64> {
    match w {
        "hundred" => Some(100),
        "thousand" => Some(1_000),
        "million" => Some(1_000_000),
        "billion" => Some(1_000_000_000),
        _ => None,
    }
}
fn ordinal(w: &str) -> Option<u64> {
    const SMALL: &[&str] = &[
        "", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth", "eleventh", "twelfth", "thirteenth",
        "fourteenth", "fifteenth", "sixteenth", "seventeenth", "eighteenth", "nineteenth",
    ];
    if let Some(i) = SMALL.iter().skip(1).position(|&s| s == w) {
        return Some(i as u64 + 1);
    }
    const TENS: &[&str] = &["twentieth", "thirtieth", "fortieth", "fiftieth", "sixtieth", "seventieth", "eightieth", "ninetieth"];
    if let Some(i) = TENS.iter().position(|&s| s == w) {
        return Some((i as u64 + 2) * 10);
    }
    match w {
        "hundredth" => Some(100),
        "thousandth" => Some(1_000),
        "millionth" => Some(1_000_000),
        _ => None,
    }
}

fn is_number_word(w: &str) -> bool {
    unit(w).is_some() || teen(w).is_some() || tens(w).is_some() || multiplier(w).is_some() || ordinal(w).is_some()
}

fn with_suffix(n: u64) -> String {
    let suffix = match (n % 10, n % 100) {
        (_, 11..=13) => "th",
        (1, _) => "st",
        (2, _) => "nd",
        (3, _) => "rd",
        _ => "th",
    };
    format!("{n}{suffix}")
}

/// Number words as digits, on both sides: "twenty five" → "25", "nineteen ninety" → "1990", "first" → "1st".
fn numbers(toks: Vec<Tok>) -> Vec<Tok> {
    let word = |t: &Tok| if t.alts.len() == 1 && !t.gap { Some(t.alts[0].clone()) } else { None };
    let mut out = Vec::with_capacity(toks.len());
    let mut i = 0;
    while i < toks.len() {
        // The run of number words starting here ("and" only inside, as in "two hundred and five").
        let mut j = i;
        while j < toks.len() {
            let Some(w) = word(&toks[j]) else { break };
            let inside_and = w == "and"
                && j > i
                && word(&toks[j - 1]).is_some_and(|p| multiplier(&p).is_some())
                && toks.get(j + 1).and_then(word).is_some_and(|n| is_number_word(&n) && multiplier(&n).is_none());
            if !(is_number_word(&w) || inside_and) {
                break;
            }
            j += 1;
            if ordinal(&w).is_some() {
                break; // an ordinal ends a number
            }
        }
        if j == i {
            out.push(toks[i].clone());
            i += 1;
            continue;
        }
        let run: Vec<String> = toks[i..j].iter().filter_map(word).filter(|w| w != "and").collect();
        let mut k = i;
        for (value, used) in parse_numbers(&run) {
            // `used` words of the run, skipping "and"s, make this number.
            let start = k;
            let mut n = 0;
            while n < used {
                if word(&toks[k]).as_deref() != Some("and") {
                    n += 1;
                }
                k += 1;
            }
            out.push(Tok { alts: vec![value.clone()], raw: value, from: toks[start].from, to: toks[k - 1].to, gap: false });
        }
        i = j;
    }
    out
}

/// Number words to numbers, with how many words each used.
fn parse_numbers(run: &[String]) -> Vec<(String, usize)> {
    // A year said in pairs: "nineteen ninety", "twenty twenty four".
    let pairs = small_groups(run);
    if let Some(groups) = &pairs {
        if groups.len() == 2 && groups.iter().all(|&(v, _)| (10..=99).contains(&v)) {
            return vec![(format!("{}{:02}", groups[0].0, groups[1].0), run.len())];
        }
    }
    let mut out = Vec::new();
    let mut total = 0u64;
    let mut current = 0u64;
    let mut used = 0usize;
    let mut started = false;
    let flush = |out: &mut Vec<(String, usize)>, total: &mut u64, current: &mut u64, used: &mut usize, started: &mut bool| {
        if *started {
            out.push(((*total + *current).to_string(), *used));
        }
        *total = 0;
        *current = 0;
        *used = 0;
        *started = false;
    };
    for w in run {
        if let Some(n) = ordinal(w) {
            let fits = if n >= 100 {
                true
            } else if n < 10 {
                current % 10 == 0 && !(10..=19).contains(&(current % 100))
            } else {
                current % 100 == 0
            };
            let value = if n >= 100 { (total + current.max(1)) * n } else { total + current + n };
            if !fits {
                flush(&mut out, &mut total, &mut current, &mut used, &mut started);
                out.push((with_suffix(n), 1));
            } else {
                out.push((with_suffix(value), used + 1));
                total = 0;
                current = 0;
                used = 0;
                started = false;
            }
            continue;
        }
        let fits = if let Some(_) = unit(w) {
            current % 10 == 0 && !(10..=19).contains(&(current % 100))
        } else if teen(w).is_some() || tens(w).is_some() {
            current % 100 == 0
        } else {
            true // a multiplier always applies to what came before
        };
        if !fits || (started && current == 0 && total == 0 && multiplier(w).is_none()) {
            flush(&mut out, &mut total, &mut current, &mut used, &mut started);
        }
        if let Some(v) = unit(w).or_else(|| teen(w)).or_else(|| tens(w)) {
            current += v;
        } else if let Some(m) = multiplier(w) {
            if m == 100 {
                current = current.max(1) * 100;
            } else {
                total += current.max(1) * m;
                current = 0;
            }
        }
        used += 1;
        started = true;
    }
    flush(&mut out, &mut total, &mut current, &mut used, &mut started);
    out
}

/// The run as numbers under 100 ("twenty four", "nineteen"), with words used; None if it has others.
fn small_groups(run: &[String]) -> Option<Vec<(u64, usize)>> {
    let mut out = Vec::new();
    let mut i = 0;
    while i < run.len() {
        let w = &run[i];
        if let Some(t) = tens(w) {
            if let Some(u) = run.get(i + 1).and_then(|n| unit(n)).filter(|&u| u > 0) {
                out.push((t + u, 2));
                i += 2;
                continue;
            }
            out.push((t, 1));
        } else if let Some(v) = teen(w).or_else(|| unit(w)) {
            out.push((v, 1));
        } else {
            return None;
        }
        i += 1;
    }
    Some(out)
}

// ---------- British and American spelling ----------

const SAME_WORD: &[(&str, &str)] = &[
    ("grey", "gray"),
    ("greys", "grays"),
    ("programme", "program"),
    ("programmes", "programs"),
    ("cheque", "check"),
    ("cheques", "checks"),
    ("tyre", "tire"),
    ("tyres", "tires"),
    ("aluminium", "aluminum"),
    ("plough", "plow"),
    ("mould", "mold"),
    ("mouldy", "moldy"),
    ("sceptical", "skeptical"),
    ("sceptic", "skeptic"),
    ("kerb", "curb"),
    ("pyjamas", "pajamas"),
    ("judgement", "judgment"),
    ("ageing", "aging"),
    ("enrol", "enroll"),
    ("enrolment", "enrollment"),
    ("fulfil", "fulfill"),
    ("fulfilment", "fulfillment"),
    ("skilful", "skillful"),
    ("wilful", "willful"),
    ("instalment", "installment"),
    ("practise", "practice"),
    ("practised", "practiced"),
    ("practising", "practicing"),
    ("practises", "practices"),
    ("defence", "defense"),
    ("offence", "offense"),
    ("licence", "license"),
    ("pretence", "pretense"),
    ("manoeuvre", "maneuver"),
    ("axe", "ax"),
    ("doughnut", "donut"),
    ("draught", "draft"),
    ("gaol", "jail"),
    ("ok", "okay"),
    ("mum", "mom"),
    ("cosy", "cozy"),
    ("moustache", "mustache"),
    ("storey", "story"),
    ("jewellery", "jewelry"),
    ("paediatric", "pediatric"),
    ("encyclopaedia", "encyclopedia"),
    ("anaemia", "anemia"),
    ("anaesthetic", "anesthetic"),
    ("oestrogen", "estrogen"),
    ("foetus", "fetus"),
    ("diarrhoea", "diarrhea"),
    ("towards", "toward"),
    ("learnt", "learned"),
    ("spelt", "spelled"),
    ("dreamt", "dreamed"),
    ("burnt", "burned"),
    ("leapt", "leaped"),
    ("spoilt", "spoiled"),
    ("smelt", "smelled"),
];

/// One spelling for words spelled differently in British and American English. Applied to both sides,
/// so it only has to send the two spellings to the same place, never to tell which is which.
fn american(w: &str) -> Cow<'_, str> {
    if let Some(&(_, us)) = SAME_WORD.iter().find(|(uk, _)| *uk == w) {
        return Cow::Borrowed(us);
    }
    // colour, favourite, behaviour (but not four, hour, your, tour: the part before needs 3 letters).
    for suffix in ["our", "ours", "oured", "ouring", "ourite", "ourites", "ourable", "ourful", "ourer", "ourers", "ourism", "ourless"] {
        if let Some(stem) = w.strip_suffix(suffix) {
            if stem.len() >= 3 && !["dev", "det", "cont", "vel", "am", "param"].contains(&stem) {
                return Cow::Owned(format!("{stem}or{}", &suffix[3..]));
            }
        }
    }
    // realise, organisation; analyse
    for (uk, us) in [
        ("isation", "ization"),
        ("isations", "izations"),
        ("ise", "ize"),
        ("ised", "ized"),
        ("ises", "izes"),
        ("ising", "izing"),
        ("iser", "izer"),
        ("isers", "izers"),
        ("yse", "yze"),
        ("ysed", "yzed"),
        ("ysing", "yzing"),
        ("logue", "log"),
        ("logues", "logs"),
    ] {
        if let Some(stem) = w.strip_suffix(uk) {
            if stem.len() >= 2 {
                return Cow::Owned(format!("{stem}{us}"));
            }
        }
    }
    // centre, theatre, fibre (but not timbre, which isn't timber)
    for (uk, us) in [("tre", "ter"), ("tres", "ters"), ("bre", "ber"), ("bres", "bers")] {
        if let Some(stem) = w.strip_suffix(uk) {
            if stem.len() >= 2 && w != "timbre" {
                return Cow::Owned(format!("{stem}{us}"));
            }
        }
    }
    // travelled, cancelling
    for (uk, us) in [("elled", "eled"), ("elling", "eling"), ("eller", "eler"), ("ellers", "elers")] {
        if let Some(stem) = w.strip_suffix(uk) {
            if stem.len() >= 3 {
                return Cow::Owned(format!("{stem}{us}"));
            }
        }
    }
    Cow::Borrowed(w)
}

// ---------- lining up ----------

/// Edits between two words, a swap of neighbours counting as one.
fn distance(a: &str, b: &str) -> usize {
    let a: Vec<char> = a.chars().collect();
    let b: Vec<char> = b.chars().collect();
    let mut d = vec![vec![0usize; b.len() + 1]; a.len() + 1];
    for (i, row) in d.iter_mut().enumerate() {
        row[0] = i;
    }
    for j in 0..=b.len() {
        d[0][j] = j;
    }
    for i in 1..=a.len() {
        for j in 1..=b.len() {
            let cost = usize::from(a[i - 1] != b[j - 1]);
            d[i][j] = (d[i - 1][j] + 1).min(d[i][j - 1] + 1).min(d[i - 1][j - 1] + cost);
            if i > 1 && j > 1 && a[i - 1] == b[j - 2] && a[i - 2] == b[j - 1] {
                d[i][j] = d[i][j].min(d[i - 2][j - 2] + 1);
            }
        }
    }
    d[a.len()][b.len()]
}

/// How many letters a misspelling may be off by: none for short words, where one letter makes another word.
fn allowed(original: &str) -> usize {
    match original.chars().count() {
        0..=3 => 0,
        4..=8 => 1,
        _ => 2,
    }
}

fn same(o: &Tok, t: &Tok) -> bool {
    o.alts.iter().any(|a| t.alts.contains(a))
}

/// A typed word that may be a misspelling of the original one: close enough, and not a number.
fn close(o: &Tok, t: &Tok) -> bool {
    let (Some(a), Some(b)) = (o.alts.first(), t.alts.first()) else { return false };
    if o.alts.len() > 1 || a.chars().any(|c| c.is_ascii_digit()) || b.chars().any(|c| c.is_ascii_digit()) {
        return false;
    }
    let max = allowed(a);
    max > 0 && distance(a, b) <= max
}

/// Letters and digits only, for matching a written word as a whole ("its" = "it's", "oclock" = "o'clock").
fn bare(w: &str) -> String {
    w.to_lowercase().chars().filter(|c| c.is_alphanumeric()).collect()
}

/// Where each written word's tokens are, when it has its own (a number spanning words has none).
fn spans(words: &[String], toks: &[Tok]) -> Vec<Option<(usize, usize)>> {
    let mut out = vec![None; words.len()];
    let mut shared = vec![false; words.len()];
    for (k, t) in toks.iter().enumerate() {
        if t.from != t.to {
            for w in t.from..=t.to {
                shared[w] = true;
            }
            continue;
        }
        let e = out[t.from].get_or_insert((k, k + 1));
        e.1 = k + 1;
    }
    for (w, s) in shared.iter().enumerate() {
        if *s {
            out[w] = None;
        }
    }
    out
}

#[derive(Clone, Copy)]
enum Step {
    Start,
    Pair,
    Miss,
    Extra,
    /// The gap at j-1 covers original token i-1.
    UnderGap,
    /// Whole written words that match letter for letter: back to (i, j).
    Words(usize, usize),
}

/// Lines the typed tokens up against the original's with the fewest mistakes; returns a mark per token.
fn align(o: &[Tok], t: &[Tok], o_words: &[String], t_words: &[String]) -> (Vec<Mark>, Vec<Mark>) {
    let (n, m) = (o.len(), t.len());
    const SPELL: f64 = 0.5;
    const GAP: f64 = 0.01;
    let mut cost = vec![vec![f64::INFINITY; m + 1]; n + 1];
    let mut step = vec![vec![Step::Start; m + 1]; n + 1];
    cost[0][0] = 0.0;

    // Written words that match as a whole, by where their tokens end.
    let o_spans = spans(o_words, o);
    let t_spans = spans(t_words, t);
    let mut whole: Vec<(usize, usize, usize, usize)> = Vec::new();
    for (ow, os) in o_spans.iter().enumerate() {
        let Some((oa, ob)) = os else { continue };
        let ob_word = bare(&o_words[ow]);
        if ob_word.is_empty() {
            continue;
        }
        for (tw, ts) in t_spans.iter().enumerate() {
            let Some((ta, tb)) = ts else { continue };
            if bare(&t_words[tw]) == ob_word {
                whole.push((*oa, *ob, *ta, *tb));
            }
        }
    }

    for i in 0..=n {
        for j in 0..=m {
            if i == 0 && j == 0 {
                continue;
            }
            let mut best = (f64::INFINITY, Step::Start);
            let mut consider = |c: f64, s: Step| {
                if c < best.0 - 1e-9 {
                    best = (c, s);
                }
            };
            if i > 0 && j > 0 && !t[j - 1].gap {
                let c = if same(&o[i - 1], &t[j - 1]) { 0.0 } else if close(&o[i - 1], &t[j - 1]) { SPELL } else { 1.0 };
                consider(cost[i - 1][j - 1] + c, Step::Pair);
            }
            if i > 0 && j > 0 && t[j - 1].gap {
                consider(cost[i - 1][j] + GAP, Step::UnderGap);
            }
            if i > 0 {
                consider(cost[i - 1][j] + 1.0, Step::Miss);
            }
            if j > 0 {
                consider(cost[i][j - 1] + if t[j - 1].gap { GAP } else { 1.0 }, Step::Extra);
            }
            for &(oa, ob, ta, tb) in &whole {
                if ob == i && tb == j {
                    consider(cost[oa][ta], Step::Words(oa, ta));
                }
            }
            cost[i][j] = best.0;
            step[i][j] = best.1;
        }
    }

    let mut om = vec![Mark::Missing; n];
    let mut tm = vec![Mark::Extra; m];
    let (mut i, mut j) = (n, m);
    while i > 0 || j > 0 {
        match step[i][j] {
            Step::Pair => {
                let (a, b) = (&o[i - 1], &t[j - 1]);
                let mark = if same(a, b) {
                    Mark::Correct
                } else if close(a, b) && !is_word(&b.raw) && !is_word(&b.alts[0]) {
                    Mark::Spelling
                } else {
                    Mark::Wrong
                };
                om[i - 1] = mark;
                tm[j - 1] = mark;
                i -= 1;
                j -= 1;
            }
            Step::UnderGap => {
                om[i - 1] = Mark::Missing;
                tm[j - 1] = Mark::Gap;
                i -= 1;
            }
            Step::Miss => {
                om[i - 1] = Mark::Missing;
                i -= 1;
            }
            Step::Extra => {
                tm[j - 1] = if t[j - 1].gap { Mark::Gap } else { Mark::Extra };
                j -= 1;
            }
            Step::Words(a, b) => {
                om[a..i].fill(Mark::Correct);
                tm[b..j].fill(Mark::Correct);
                i = a;
                j = b;
            }
            Step::Start => break,
        }
    }
    (om, tm)
}

/// Marks per written word: the worst of its tokens'.
fn by_word(words: &[String], toks: &[Tok], marks: &[Mark], typed: bool) -> Vec<Marked> {
    let rank = |m: Mark| match m {
        Mark::Wrong => 6,
        Mark::Missing | Mark::Extra => 5,
        Mark::Gap => 4,
        Mark::Spelling => 3,
        Mark::Correct => 2,
        Mark::Ignored => 0,
    };
    let mut out: Vec<Marked> = words.iter().map(|w| Marked { text: w.clone(), mark: Mark::Ignored }).collect();
    for (t, &m) in toks.iter().zip(marks) {
        for w in t.from..=t.to {
            if rank(m) > rank(out[w].mark) {
                out[w].mark = m;
            }
        }
    }
    // The typed side shows gaps as the learner wrote them.
    if typed {
        for w in out.iter_mut() {
            if w.text == "_" {
                w.mark = Mark::Gap;
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn marks(c: &[Marked]) -> String {
        c.iter()
            .map(|w| {
                let m = match w.mark {
                    Mark::Correct => "",
                    Mark::Spelling => "~",
                    Mark::Wrong => "!",
                    Mark::Missing => "-",
                    Mark::Extra => "+",
                    Mark::Gap => "",
                    Mark::Ignored => "·",
                };
                format!("{m}{}", w.text)
            })
            .collect::<Vec<_>>()
            .join(" ")
    }

    fn score(o: &str, t: &str) -> (f64, u32) {
        let c = compare(o, t);
        (c.credit, c.total)
    }

    #[test]
    fn identical_text_is_all_correct() {
        let c = compare("Hello there, Neil. How are you?", "Hello there, Neil. How are you?");
        assert_eq!(c.credit, c.total as f64);
        assert_eq!(c.total, 6);
        assert_eq!(c.accuracy(), 1.0);
    }

    #[test]
    fn case_and_punctuation_dont_matter() {
        assert_eq!(score("Well, I think so!", "well i think so"), (4.0, 4));
        assert_eq!(score("The U.S. economy", "the US economy"), (3.0, 3));
    }

    #[test]
    fn a_missing_word_and_a_wrong_word() {
        let c = compare("I went to the store yesterday", "I went the shop yesterday");
        assert_eq!(marks(&c.original), "I went -to the !store yesterday");
        assert_eq!(marks(&c.typed), "I went the !shop yesterday");
        assert_eq!((c.credit, c.total), (4.0, 6));
    }

    #[test]
    fn extra_words_are_marked_but_cost_nothing_in_the_score() {
        let c = compare("I like tea", "I really like tea");
        assert_eq!(marks(&c.typed), "I +really like tea");
        assert_eq!(c.credit, 3.0);
    }

    #[test]
    fn contractions_match_their_full_forms() {
        assert_eq!(score("I don't know", "I do not know"), (4.0, 4));
        assert_eq!(score("I do not know", "I don't know"), (4.0, 4));
        assert_eq!(score("We can't go, it's late", "we cannot go its late"), (7.0, 7));
        assert_eq!(score("You're right and I'm sure", "you are right and i am sure"), (7.0, 7));
        assert_eq!(score("I'd have gone", "I had have gone"), (4.0, 4), "'d is would or had");
        assert_eq!(score("I'd have gone", "I would have gone"), (4.0, 4));
        assert_eq!(score("It won't work", "it will not work"), (4.0, 4));
        assert_eq!(score("I don't know", "I dont know"), (4.0, 4), "a missing apostrophe is fine");
        assert_eq!(score("John's car", "johns car"), (2.0, 2));
        assert_eq!(score("Let's go", "let us go"), (3.0, 3));
    }

    #[test]
    fn numbers_match_their_words() {
        assert_eq!(score("I was 15 then", "I was fifteen then"), (4.0, 4));
        assert_eq!(score("She was fifteen", "she was 15"), (3.0, 3));
        assert_eq!(score("It cost 2,500 dollars", "it cost two thousand five hundred dollars"), (4.0, 4));
        assert_eq!(score("about 25 people", "about twenty-five people"), (3.0, 3));
        assert_eq!(score("about 25 people", "about twenty five people"), (3.0, 3));
        assert_eq!(score("in 1990", "in nineteen ninety"), (2.0, 2));
        assert_eq!(score("the 21st century", "the twenty-first century"), (3.0, 3));
        assert_eq!(score("the first time", "the 1st time"), (3.0, 3));
        assert_eq!(score("50% of them", "fifty percent of them"), (4.0, 4));
        assert_eq!(score("50 per cent of them", "50% of them"), (4.0, 4));
        assert_eq!(score("It's $5", "it's five dollars"), (4.0, 4));
        assert_eq!(score("two hundred and five", "205"), (1.0, 1));
        assert_eq!(score("one two three", "1 2 3"), (3.0, 3));
        assert_eq!(score("I was 15", "I was 50"), (2.0, 3), "a wrong number is wrong, never a spelling mistake");
    }

    #[test]
    fn british_and_american_spellings_are_the_same() {
        assert_eq!(score("my favourite colour", "my favorite color"), (3.0, 3));
        assert_eq!(score("They realized it at the theater", "they realised it at the theatre"), (6.0, 6));
        assert_eq!(score("She travelled to the centre", "she traveled to the center"), (5.0, 5));
        assert_eq!(score("a grey programme", "a gray program"), (3.0, 3));
        assert_eq!(score("we analysed the catalogue", "we analyzed the catalog"), (4.0, 4));
        // ...but four and for are different words.
        assert_eq!(score("four people", "for people"), (1.0, 2));
    }

    #[test]
    fn hyphens_dont_matter() {
        assert_eq!(score("a well-known fact", "a well known fact"), (4.0, 4));
        assert_eq!(score("a well known fact", "a well-known fact"), (4.0, 4));
    }

    #[test]
    fn a_misspelling_is_half_a_word() {
        let c = compare("I will receive it", "I will recieve it");
        assert_eq!(marks(&c.original), "I will ~receive it");
        assert_eq!((c.credit, c.spelling), (3.5, 1));
        // Long words may be two letters off.
        assert_eq!(compare("an extraordinary day", "an extrordinery day").spelling, 1);
        // A name not in the dictionary, misspelled.
        assert_eq!(compare("Hello Neil", "hello Niel").spelling, 1);
    }

    #[test]
    fn a_real_word_is_wrong_however_close() {
        let c = compare("their house", "there house");
        assert_eq!(marks(&c.original), "!their house");
        assert_eq!(c.spelling, 0);
        assert_eq!(compare("I live here", "I leave here").spelling, 0);
        assert_eq!(compare("a big bear", "a big beer").spelling, 0);
    }

    #[test]
    fn far_off_or_short_words_are_wrong() {
        assert_eq!(marks(&compare("it is ubiquitous", "it is ubikwitus").original), "it is !ubiquitous");
        assert_eq!(marks(&compare("in the house", "in teh house").original), "in !the house");
    }

    #[test]
    fn a_gap_covers_the_words_the_learner_missed() {
        let c = compare("I went to the store", "I _ the store");
        assert_eq!(marks(&c.original), "I -went -to the store");
        assert_eq!(marks(&c.typed), "I _ the store");
        assert_eq!(c.credit, 3.0);
        let c = compare("I went to the store", "I went to... store");
        assert_eq!(marks(&c.original), "I went to -the store");
        assert_eq!(marks(&c.typed), "I went to _ store");
        assert_eq!(marks(&compare("We met at noon", "__ met at noon").original), "-We met at noon");
    }

    #[test]
    fn a_gap_keeps_the_words_after_it_lined_up() {
        let c = compare("I think the main problem is the price", "I think _ is the price");
        assert_eq!(marks(&c.original), "I think -the -main -problem is the price");
        assert_eq!(c.credit, 5.0);
    }

    #[test]
    fn fillers_dont_count() {
        let c = compare("So, um, I think so", "so I think so");
        assert_eq!(marks(&c.original), "So, ·um, I think so");
        assert_eq!((c.credit, c.total), (4.0, 4));
        assert_eq!(score("I think so", "I uh think so"), (3.0, 3));
    }

    #[test]
    fn nothing_typed_is_all_missing() {
        let c = compare("Hello there", "");
        assert_eq!(marks(&c.original), "-Hello -there");
        assert_eq!(c.credit, 0.0);
        assert!(c.typed.is_empty());
    }

    #[test]
    fn a_sentence_copied_from_the_original_is_all_correct() {
        let o = "It's 5 o'clock, isn't it?";
        let c = compare(o, o);
        assert_eq!(c.credit, c.total as f64);
        assert!(c.original.iter().all(|w| w.mark == Mark::Correct));
    }

    #[test]
    fn the_learners_marks_count_as_mistakes() {
        let o = "I'm gonna grab a coffee, honestly.";
        let f = |from, to, flag| Flagged { from, to, flag };
        // Shown and copied, nothing marked: all right.
        assert_eq!(compare_flagged(o, o, &[]).credit, 7.0);
        // Didn't catch "gonna"; "honestly" was spelled differently from what the learner thought.
        let c = compare_flagged(o, o, &[f(1, 1, Flag::Missed), f(5, 5, Flag::Spelling), f(3, 4, Flag::Keep)]);
        assert_eq!((c.credit, c.total, c.spelling), (5.5, 7, 1));
        assert_eq!(marks(&c.original), "I'm !gonna grab a coffee, ~honestly.");
        // The worse of the two: a word already missed stays missed, not "spelling".
        let c = compare_flagged(o, "I'm gonna grab a coffee", &[f(5, 5, Flag::Spelling)]);
        assert_eq!(marks(&c.original), "I'm gonna grab a coffee, -honestly.");
    }

    #[test]
    fn several_lines_are_one_text() {
        assert_eq!(score("one more thing", "one more\nthing"), (3.0, 3));
    }

    #[test]
    fn the_dictionary_knows_common_words_but_not_misspellings() {
        for w in ["the", "receive", "colour", "color", "their", "practise", "people's"] {
            assert!(is_word(w), "{w}");
        }
        for w in ["recieve", "teh", "ubikwitus", "niel"] {
            assert!(!is_word(w), "{w}");
        }
    }
}
