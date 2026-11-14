import Foundation

/// FSRS, the scheduler the desktop uses (`rs-fsrs` 1.2.1 with `enable_short_term: false`, desktop `practice.rs`),
/// ported line by line so a card reviewed on either device comes out the same. Cards are stored as rs-fsrs' JSON.
nonisolated enum FSRS {
    enum State: String, Codable, Sendable { case New, Learning, Review, Relearning }

    enum Rating: Int, CaseIterable, Sendable {
        case again = 1, hard, good, easy
    }

    struct Card: Codable, Equatable, Sendable {
        var due: Date
        var stability: Double = 0
        var difficulty: Double = 0
        var elapsed_days: Int = 0
        var scheduled_days: Int = 0
        var reps: Int = 0
        var lapses: Int = 0
        var state: State = .New
        var last_review: Date

        /// A word never reviewed (the desktop's `card_of` for a missing card).
        static func new(at now: Date) -> Card { Card(due: now, last_review: now) }

        func retrievability(at now: Date) -> Double {
            state == .New ? 0 : forgettingCurve(Double(days(from: last_review, to: now)), stability)
        }
    }

    // Parameters: rs-fsrs' defaults.
    static let w: [Double] = [0.4072, 1.1829, 3.1262, 15.4722, 7.2102, 0.5316, 1.0651, 0.0234, 1.616, 0.1544, 1.0824,
                              1.9813, 0.0953, 0.2975, 2.2042, 0.2407, 2.9466, 0.5034, 0.6567]
    static let requestRetention = 0.9
    static let maximumInterval = 36500.0
    static let decay = -0.5
    static let factor = 19.0 / 81.0

    static func forgettingCurve(_ elapsedDays: Double, _ stability: Double) -> Double {
        pow(1 + factor * elapsedDays / stability, decay)
    }

    static func initDifficulty(_ r: Rating) -> Double {
        min(max(w[4] - exp(w[5] * (Double(r.rawValue) - 1)) + 1, 1), 10)
    }

    static func initStability(_ r: Rating) -> Double { max(w[r.rawValue - 1], 0.1) }

    static func nextInterval(_ stability: Double) -> Double {
        let i = (stability / factor * (pow(requestRetention, 1 / decay) - 1)).rounded()
        return min(max(i, 1), maximumInterval)
    }

    static func nextDifficulty(_ d: Double, _ r: Rating) -> Double {
        let next = w[6] * -(Double(r.rawValue) - 3) + d
        let reverted = w[7] * initDifficulty(.easy) + (1 - w[7]) * next
        return min(max(reverted, 1), 10)
    }

    static func nextRecallStability(_ d: Double, _ s: Double, _ r: Double, _ rating: Rating) -> Double {
        let modifier = rating == .hard ? w[15] : rating == .easy ? w[16] : 1
        return s * (exp(w[8]) * (11 - d) * pow(s, -w[9]) * expm1((1 - r) * w[10]) * modifier + 1)
    }

    static func nextForgetStability(_ d: Double, _ s: Double, _ r: Double) -> Double {
        w[11] * pow(d, -w[12]) * (pow(s + 1, w[13]) - 1) * exp((1 - r) * w[14])
    }

    /// Whole days between two moments, rounded toward zero (chrono's `num_days`).
    static func days(from a: Date, to b: Date) -> Int {
        Int((b.timeIntervalSince1970.rounded(.down) - a.timeIntervalSince1970.rounded(.down)) / 86400)
    }

    /// The card after each of the four answers, now.
    static func preview(_ card: Card, at now: Date) -> [Rating: Card] {
        var current = card
        current.elapsed_days = card.state == .New ? 0 : days(from: card.last_review, to: now)
        current.last_review = now
        current.reps += 1
        var next = Dictionary(uniqueKeysWithValues: Rating.allCases.map { ($0, current) })

        if card.state == .New {
            for r in Rating.allCases {
                next[r]!.difficulty = initDifficulty(r)
                next[r]!.stability = initStability(r)
            }
        } else {
            let d = card.difficulty, s = card.stability, r = card.retrievability(at: now)
            next[.again]!.difficulty = nextDifficulty(d, .again)
            next[.again]!.stability = nextForgetStability(d, s, r)
            for rating in [Rating.hard, .good, .easy] {
                next[rating]!.difficulty = nextDifficulty(d, rating)
                next[rating]!.stability = nextRecallStability(d, s, r, rating)
            }
        }

        var again = nextInterval(next[.again]!.stability)
        var hard = nextInterval(next[.hard]!.stability)
        var good = nextInterval(next[.good]!.stability)
        var easy = nextInterval(next[.easy]!.stability)
        again = min(again, hard)
        hard = max(hard, again + 1)
        good = max(good, hard + 1)
        easy = max(easy, good + 1)
        for (rating, days) in [(Rating.again, again), (.hard, hard), (.good, good), (.easy, easy)] {
            next[rating]!.scheduled_days = Int(days)
            next[rating]!.due = now.addingTimeInterval(days * 86400)
            next[rating]!.state = .Review
        }
        if card.state != .New { next[.again]!.lapses += 1 }
        return next
    }

    static func next(_ card: Card, at now: Date, _ rating: Rating) -> Card { preview(card, at: now)[rating]! }

    /// New · Learning (back within 3 days) · Familiar (3 to 21) · Known (longer), as on the desktop.
    static func level(_ card: Card) -> Word.Level {
        switch card.state {
        case .New: .new
        case .Learning, .Relearning: .learning
        case .Review: card.scheduled_days < 3 ? .learning : card.scheduled_days < 21 ? .familiar : .known
        }
    }

    /// "I know this": Known at once, back in a year to check (the desktop's `know`).
    static func known(_ card: Card, at now: Date) -> Card {
        var c = card
        c.state = .Review
        c.stability = max(c.stability, 365)
        c.difficulty = c.difficulty > 0 ? c.difficulty : 5
        c.scheduled_days = 365
        c.last_review = now
        c.due = now.addingTimeInterval(365 * 86400)
        c.reps += 1
        return c
    }

    // MARK: JSON, as rs-fsrs (serde, chrono) writes it

    static func decode(_ json: String?, now: Date) -> Card {
        guard let data = json?.data(using: .utf8) else { return .new(at: now) }
        let d = JSONDecoder()
        d.dateDecodingStrategy = .custom { decoder in
            let s = try decoder.singleValueContainer().decode(String.self)
            if let date = parseDate(s) { return date }
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Not a date: \(s)"))
        }
        return (try? d.decode(Card.self, from: data)) ?? .new(at: now)
    }

    static func encode(_ card: Card) -> String {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .custom { date, encoder in
            var c = encoder.singleValueContainer()
            try c.encode(formatDate(date))
        }
        e.outputFormatting = [.sortedKeys]
        return String(decoding: (try? e.encode(card)) ?? Data(), as: UTF8.self)
    }

    static func parseDate(_ s: String) -> Date? {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = f.date(from: s) { return d }
        f.formatOptions = [.withInternetDateTime]
        return f.date(from: s)
    }

    /// "2026-11-13T10:00:00Z": whole seconds, as chrono writes a time without fractions.
    static func formatDate(_ date: Date) -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f.string(from: Date(timeIntervalSince1970: date.timeIntervalSince1970.rounded(.down)))
    }
}
