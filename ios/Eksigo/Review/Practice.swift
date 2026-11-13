import Foundation

/// Word review, with the desktop's rules (`practice.rs`, design D10): due words first, the longest overdue first, then
/// new words in the order they were saved, at most `newPerDay` a day and `perSession` a session. Each word is shown
/// in one of the sentences it was saved from, the one practised longest ago.
nonisolated enum PracticeRules {
    static let newPerDay = 10
    static let perSession = 20
    /// Longer than this on one word, the learner was away; the time isn't counted.
    static let maxSecondsPerWord = 120

    struct Counts: Equatable {
        var due: Int
        var new: Int
        var total: Int { due + new }
    }

    /// New words practised for the first time since `since` (not counting "I know this").
    static func startedSince(_ reviews: [Review], since: Int) -> Int {
        var first: [String: Int] = [:]
        for r in reviews where r.mode != "known" {
            let k = Word.key(r.word)
            first[k] = min(first[k] ?? .max, r.at)
        }
        return first.values.filter { $0 >= since }.count
    }

    static func counts(words: [Word], reviews: [Review], now: Int, today: Int) -> Counts {
        let due = words.filter { $0.level != "new" && ($0.dueAt ?? 0) <= now }.count
        let fresh = words.filter { $0.level == "new" }.count
        return Counts(due: due, new: min(fresh, max(0, newPerDay - startedSince(reviews, since: today))))
    }

    struct Item: Identifiable, Equatable {
        let id = UUID()
        var word: Word
        var context: WordContext
        /// The sentence around the word: before, the word as written there, after. Nil when it can't be found.
        var gap: [String]?
        var answer: String
        /// Four meanings in a random order, one of them `answer`; empty when there aren't enough other words.
        var choices: [String]
        /// Seconds until the word comes back for Again, Hard, Good and Easy.
        var next: [Int]
        /// How it's asked: "pick" for a new word when there are choices, otherwise "recall".
        var mode: String { word.level == "new" && choices.count == 4 ? "pick" : "recall" }
    }

    /// Today's session.
    static func queue(words: [Word], reviews: [Review], now: Int, today: Int,
                      random: inout some RandomNumberGenerator) -> [Item] {
        let c = counts(words: words, reviews: reviews, now: now, today: today)
        let due = words.filter { $0.level != "new" && ($0.dueAt ?? 0) <= now }
            .sorted { (($0.dueAt ?? 0), $0.addedAt) < (($1.dueAt ?? 0), $1.addedAt) }
            .prefix(perSession)
        let fresh = words.filter { $0.level == "new" }.sorted { ($0.addedAt, $0.text) < ($1.addedAt, $1.text) }
            .prefix(min(c.new, perSession - due.count))
        return (Array(due) + Array(fresh)).compactMap { item($0, all: words, now: now, random: &random) }
    }

    static func item(_ word: Word, all: [Word], now: Int, random: inout some RandomNumberGenerator) -> Item? {
        // The sentence practised longest ago (or never), the newest first among those.
        guard let context = word.contexts.min(by: { a, b in
            ((a.practisedAt ?? 0), -a.addedAt) < ((b.practisedAt ?? 0), -b.addedAt)
        }) else { return nil }
        let answer = word.answer
        var others = Array(Set(all.filter { $0.key != word.key }.map(\.answer).filter { !$0.isEmpty && $0 != answer })).sorted()
        var choices: [String] = []
        if !answer.isEmpty, others.count >= 3 {
            others.shuffle(using: &random)
            choices = Array(others.prefix(3)) + [answer]
            choices.shuffle(using: &random)
        }
        let date = Date(timeIntervalSince1970: TimeInterval(now))
        let preview = FSRS.preview(FSRS.decode(word.card, now: date), at: date)
        let next = FSRS.Rating.allCases.map { Int(preview[$0]!.due.timeIntervalSince1970) - now }
        return Item(word: word, context: context, gap: split(context.sentence, word.text), answer: answer, choices: choices, next: next)
    }

    // MARK: Matching words in a sentence (the desktop's `split`)

    /// Lower case, curly quotes straight, other punctuation nil.
    static func normalise(_ c: Character) -> Character? {
        if "’‘`".contains(c) { return "'" }
        if c.isLetter || c.isNumber || c == "'" || c == "-" { return Character(c.lowercased()) }
        return nil
    }

    /// The words of a text, compared loosely: "Follow-through!" and "follow-through" are the same.
    static func wordsOf(_ text: String) -> [String] {
        text.split(whereSeparator: { normalise($0) == nil }).map { part in
            String(part.compactMap(normalise)).trimmingCharacters(in: CharacterSet(charactersIn: "'-"))
        }
        .filter { !$0.isEmpty }
    }

    /// Splits the sentence around the first whole-word match of the text: [before, the words, after].
    static func split(_ sentence: String, _ text: String) -> [String]? {
        let chars = Array(sentence)
        let norm = chars.map(normalise)
        let target = Array(wordsOf(text).joined(separator: " "))
        guard !target.isEmpty else { return nil }
        func isWord(_ i: Int) -> Bool {
            guard i >= 0, i < norm.count, let c = norm[i] else { return false }
            return c.isLetter || c.isNumber || c == "-"
        }
        outer: for start in 0..<chars.count {
            if start > 0 && isWord(start - 1) { continue }
            var i = start
            for t in target {
                if t != " ", i < norm.count, let c = norm[i], c == t {
                    i += 1
                } else if t == " ", i < norm.count, norm[i] == nil {
                    while i < norm.count, norm[i] == nil { i += 1 }
                } else {
                    continue outer
                }
            }
            if isWord(i) { continue }
            return [String(chars[..<start]), String(chars[start..<i]), String(chars[i...])]
        }
        return nil
    }
}

/// Answering on the phone: the word's card and level change, a review is added, and the time counts for today.
extension RecordStore {
    @discardableResult
    func grade(_ item: PracticeRules.Item, grade: Int, mode: String, correct: Bool?, typed: String, seconds: Int,
               now: Date = .now) -> Word.Level {
        let rating = FSRS.Rating(rawValue: grade) ?? .good
        let card = FSRS.next(FSRS.decode(word(item.word.key)?.card ?? item.word.card, now: now), at: now, rating)
        let level = FSRS.level(card)
        let at = Int(now.timeIntervalSince1970)
        saveCard(item.word, card: card, level: level, practised: item.context, at: at)
        put("review", "\(item.word.key)|\(at)|\(mode)", [
            "word": item.word.text, "at": at, "mode": mode, "grade": grade, "correct": correct.map { $0 as Any } ?? NSNull(),
            "typed": typed.trimmingCharacters(in: .whitespaces), "seconds": min(max(seconds, 0), PracticeRules.maxSecondsPerWord),
        ])
        addSeconds(Double(min(max(seconds, 0), PracticeRules.maxSecondsPerWord)), kind: "words", on: now)
        return level
    }

    /// "I know this word": Known at once, back in a year.
    func know(_ item: PracticeRules.Item, now: Date = .now) {
        let card = FSRS.known(FSRS.decode(word(item.word.key)?.card ?? item.word.card, now: now), at: now)
        let at = Int(now.timeIntervalSince1970)
        saveCard(item.word, card: card, level: .known, practised: nil, at: at)
        put("review", "\(item.word.key)|\(at)|known", ["word": item.word.text, "at": at, "mode": "known", "grade": 4,
                                                       "correct": NSNull(), "typed": "", "seconds": 0])
    }

    private func saveCard(_ word: Word, card: FSRS.Card, level: Word.Level, practised: WordContext?, at: Int) {
        update("word", word.key) { json in
            if json.isEmpty { json = (try? JSONSerialization.jsonObject(with: JSONEncoder().encode(word))) as? [String: Any] ?? [:] }
            json["card"] = FSRS.encode(card)
            json["dueAt"] = Int(card.due.timeIntervalSince1970)
            json["level"] = level.rawValue
            if let practised, var contexts = json["contexts"] as? [[String: Any]] {
                for i in contexts.indices where (contexts[i]["idx"] as? NSNumber)?.intValue == practised.idx
                    && contexts[i]["sentence"] as? String == practised.sentence {
                    contexts[i]["practisedAt"] = at
                }
                json["contexts"] = contexts
            }
        }
    }
}
