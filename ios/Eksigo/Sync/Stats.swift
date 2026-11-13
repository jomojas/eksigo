import Foundation

/// Figures from the records: practice days from every device add up (DESIGN.md section 7).
nonisolated enum Stats {
    static func secondsByDay(_ days: [Day], kind: String? = nil) -> [String: Int] {
        var out: [String: Int] = [:]
        for d in days where kind == nil || d.kind == kind { out[d.day, default: 0] += d.seconds }
        return out
    }

    static func key(_ date: Date, calendar: Calendar = .current) -> String {
        let c = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }

    /// Days in a row with practice, up to today (or yesterday, when today has none yet).
    static func streak(_ byDay: [String: Int], today: Date = .now, calendar: Calendar = .current) -> Int {
        var day = calendar.startOfDay(for: today)
        if (byDay[key(day, calendar: calendar)] ?? 0) == 0 { day = calendar.date(byAdding: .day, value: -1, to: day)! }
        var n = 0
        while (byDay[key(day, calendar: calendar)] ?? 0) > 0 {
            n += 1
            day = calendar.date(byAdding: .day, value: -1, to: day)!
        }
        return n
    }

    /// The longest run of days with practice.
    static func bestStreak(_ byDay: [String: Int], calendar: Calendar = .current) -> Int {
        let f = DateFormatter()
        f.calendar = calendar
        f.timeZone = calendar.timeZone
        f.dateFormat = "yyyy-MM-dd"
        let dates = byDay.filter { $0.value > 0 }.keys.compactMap(f.date(from:)).map(calendar.startOfDay(for:)).sorted()
        var best = 0, run = 0
        var previous: Date?
        for d in dates {
            if let p = previous, calendar.dateComponents([.day], from: p, to: d).day == 1 { run += 1 } else { run = 1 }
            best = max(best, run)
            previous = d
        }
        return best
    }

    /// The last seven days, oldest first, with their seconds.
    static func lastDays(_ byDay: [String: Int], count: Int = 7, today: Date = .now, calendar: Calendar = .current) -> [(Date, Int)] {
        let start = calendar.startOfDay(for: today)
        return (0..<count).reversed().map { back in
            let d = calendar.date(byAdding: .day, value: -back, to: start)!
            return (d, byDay[key(d, calendar: calendar)] ?? 0)
        }
    }

    /// Seconds in each of the last `count` weeks (Monday first), oldest first.
    static func weeks(_ byDay: [String: Int], count: Int = 8, today: Date = .now, calendar: Calendar = .current) -> [Int] {
        var cal = calendar
        cal.firstWeekday = 2
        let thisWeek = cal.dateInterval(of: .weekOfYear, for: today)?.start ?? cal.startOfDay(for: today)
        return (0..<count).reversed().map { back in
            let start = cal.date(byAdding: .weekOfYear, value: -back, to: thisWeek)!
            return (0..<7).reduce(0) { sum, i in sum + (byDay[key(cal.date(byAdding: .day, value: i, to: start)!, calendar: cal)] ?? 0) }
        }
    }

    static func thisWeek(_ byDay: [String: Int], today: Date = .now, calendar: Calendar = .current) -> Int {
        weeks(byDay, count: 1, today: today, calendar: calendar).last ?? 0
    }

    /// "3 h 20", "41 min", "0 min".
    static func duration(_ seconds: Int) -> String {
        let m = seconds / 60
        if m < 60 { return "\(m) min" }
        return m % 60 == 0 ? "\(m / 60) h" : "\(m / 60) h \(String(format: "%02d", m % 60))"
    }

    /// "3 h 20" without "min" when it fits a figure box.
    static func short(_ seconds: Int) -> String {
        let m = seconds / 60
        if m < 60 { return "\(m) m" }
        return m % 60 == 0 ? "\(m / 60) h" : "\(m / 60) h \(String(format: "%02d", m % 60))"
    }

    /// "18 min", "1 h 4 min" for an episode's length.
    static func length(_ seconds: Double) -> String {
        let m = Int((seconds / 60).rounded())
        return m < 60 ? "\(max(m, 1)) min" : "\(m / 60) h \(m % 60) min"
    }

    static func clock(_ seconds: Double) -> String {
        let s = Int(max(0, seconds.isFinite ? seconds : 0))
        return s >= 3600 ? String(format: "%d:%02d:%02d", s / 3600, s / 60 % 60, s % 60) : String(format: "%d:%02d", s / 60, s % 60)
    }
}

/// "1 word", "3 words".
func plural(_ n: Int, _ one: String) -> String { "\(n) \(one)\(n == 1 ? "" : "s")" }

/// What the Listen tab offers from the computer: the missed sentences, grouped by episode, newest dictation first.
nonisolated struct MissedGroup: Identifiable, Hashable {
    let ref: EpisodeRef
    let items: [Missed]
    var id: String { ref.audioUrl }
    var latest: Int { items.map(\.at).max() ?? 0 }

    static func groups(_ missed: [Missed]) -> [MissedGroup] {
        Dictionary(grouping: missed, by: \.audioUrl).values
            .map { MissedGroup(ref: $0[0].ref, items: $0.sorted { $0.idx < $1.idx }) }
            .sorted { ($0.latest, $1.ref.episode) > ($1.latest, $0.ref.episode) }
    }

    /// "From last night's dictation", "From today's dictation", "From your dictation on Tuesday".
    static func when(_ at: Int, now: Date = .now, calendar: Calendar = .current) -> String {
        let date = Date(timeIntervalSince1970: TimeInterval(at))
        if calendar.isDate(date, inSameDayAs: now) { return "From today's dictation" }
        if let y = calendar.date(byAdding: .day, value: -1, to: now), calendar.isDate(date, inSameDayAs: y) {
            return calendar.component(.hour, from: date) >= 17 ? "From last night's dictation" : "From yesterday's dictation"
        }
        if now.timeIntervalSince(date) < 6 * 86400 { return "From your dictation on \(date.formatted(.dateTime.weekday(.wide)))" }
        return "From your dictation on \(date.formatted(.dateTime.day().month(.abbreviated)))"
    }
}

/// Lines up a missed sentence with what was typed, word by word: the words missed in the sentence, and the wrong
/// words and gaps in what was typed (design P03).
nonisolated enum Compare {
    struct Piece: Hashable { let text: String; let marked: Bool }

    static func align(_ original: String, _ typed: String) -> (sentence: [Piece], typed: [Piece]) {
        let a = original.split(separator: " ", omittingEmptySubsequences: true).map(String.init)
        let b = typed.split(separator: " ", omittingEmptySubsequences: true).map(String.init)
        let na = a.map { PracticeRules.wordsOf($0).joined(separator: " ") }
        let nb = b.map { PracticeRules.wordsOf($0).joined(separator: " ") }
        // Longest common subsequence of the words.
        var t = Array(repeating: Array(repeating: 0, count: b.count + 1), count: a.count + 1)
        for i in stride(from: a.count - 1, through: 0, by: -1) {
            for j in stride(from: b.count - 1, through: 0, by: -1) {
                t[i][j] = na[i] == nb[j] && !na[i].isEmpty ? t[i + 1][j + 1] + 1 : max(t[i + 1][j], t[i][j + 1])
            }
        }
        var s: [Piece] = [], y: [Piece] = []
        var i = 0, j = 0
        var gap = false
        func closeGap() { if gap { y.append(Piece(text: "___", marked: false)); gap = false } }
        while i < a.count || j < b.count {
            if i < a.count, j < b.count, na[i] == nb[j], !na[i].isEmpty {
                closeGap()
                s.append(Piece(text: a[i], marked: false))
                y.append(Piece(text: b[j], marked: false))
                i += 1; j += 1
            } else if j < b.count, i >= a.count || t[i][j + 1] >= t[i + 1][j] {
                y.append(Piece(text: b[j], marked: true))
                gap = false
                j += 1
            } else {
                // Punctuation-only tokens aren't "missed".
                s.append(Piece(text: a[i], marked: !na[i].isEmpty))
                if !na[i].isEmpty, y.last?.marked != true { gap = true }
                i += 1
            }
        }
        closeGap()
        return (merge(s), merge(y))
    }

    /// Neighbouring pieces with the same marking become one, with spaces between the words.
    static func merge(_ pieces: [Piece]) -> [Piece] {
        var out: [Piece] = []
        for p in pieces {
            if let last = out.last, last.marked == p.marked {
                out[out.count - 1] = Piece(text: last.text + " " + p.text, marked: p.marked)
            } else {
                // The space between goes with the plain text, so a marked box holds only its words.
                if let last = out.last, !last.marked {
                    out[out.count - 1] = Piece(text: last.text + " ", marked: false)
                    out.append(p)
                } else {
                    out.append(Piece(text: (out.isEmpty ? "" : " ") + p.text, marked: p.marked))
                }
            }
        }
        return out
    }
}
