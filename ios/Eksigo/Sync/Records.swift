import Foundation

// The kinds of sync records (API.md, "Sync"), read as Swift values. Times are unix seconds unless the name ends in Ms.

nonisolated struct WordContext: Codable, Hashable, Sendable {
    var audioUrl: String?
    var title: String?
    var source: String?
    var idx: Int = 0
    var sentence: String = ""
    var typed: String = ""
    var startMs: Int = 0
    var endMs: Int = 0
    var sentenceStartMs: Int = 0
    var sentenceEndMs: Int = 0
    var addedAt: Int = 0
    var practisedAt: Int?

    /// The sentence can be played: it comes from a podcast episode, with times.
    var playable: Bool { audioUrl.flatMap(URL.init(string:)) != nil && sentenceEndMs > sentenceStartMs }
}

/// A saved word or phrase. Made on the computer; the phone changes only its review state.
nonisolated struct Word: Codable, Hashable, Identifiable, Sendable {
    var text: String = ""
    var headword: String = ""
    var ipa: String = ""
    var meaning: String = ""
    var note: String = ""
    var explanation: String = ""
    /// The FSRS card as JSON (rs-fsrs' format), nil before the first review.
    var card: String?
    var dueAt: Int?
    var level: String = "new"
    var addedAt: Int = 0
    var contexts: [WordContext] = []

    var id: String { key }
    var key: String { Word.key(text) }
    static func key(_ text: String) -> String { text.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }

    var level_: Level { Level(rawValue: level) ?? .new }

    /// What the review shows as the answer: the learner's note, else the first line of the meaning.
    var answer: String {
        let n = note.trimmingCharacters(in: .whitespacesAndNewlines)
        if !n.isEmpty { return n }
        return meaning.split(separator: "\n").first.map { $0.trimmingCharacters(in: .whitespaces) } ?? ""
    }

    var firstMeaning: String { meaning.split(separator: "\n").first.map(String.init) ?? "" }
    var otherMeanings: String { meaning.split(separator: "\n").dropFirst().joined(separator: "\n") }

    enum Level: String, CaseIterable, Sendable {
        case new, learning, familiar, known
        var label: String { rawValue.capitalized }
    }
}

nonisolated struct Review: Codable, Hashable, Sendable {
    var word: String = ""
    var at: Int = 0
    var mode: String = ""
    var grade: Int = 3
    var correct: Bool?
    var typed: String = ""
    var seconds: Int = 0
}

/// The episode fields `missed`, `practice` and `listen` share: what the phone needs to find and play it.
nonisolated struct EpisodeRef: Codable, Hashable, Sendable {
    var audioUrl: String = ""
    var feedUrl: String?
    var guid: String?
    var episode: String = ""
    var show: String = ""
    var artworkUrl: String?
    var bytes: Int64?

    var episodeValue: PodcastEpisode? {
        guard let url = URL(string: audioUrl) else { return nil }
        return PodcastEpisode(audioUrl: url, guid: guid, title: episode, summary: "", published: nil, duration: nil,
                              artworkUrl: artworkUrl.flatMap(URL.init(string:)), showTitle: show, showArtworkUrl: nil,
                              feedUrl: feedUrl.flatMap(URL.init(string:)), audioBytes: bytes)
    }

    var key: String { episodeValue?.key ?? audioUrl }
}

/// A sentence missed in the latest dictation of an episode on the computer.
nonisolated struct Missed: Codable, Hashable, Identifiable, Sendable {
    var audioUrl: String = ""
    var feedUrl: String?
    var guid: String?
    var episode: String = ""
    var show: String = ""
    var artworkUrl: String?
    var bytes: Int64?
    var idx: Int = 0
    var startMs: Int = 0
    var endMs: Int = 0
    var text: String = ""
    var typed: String = ""
    var at: Int = 0
    var flagged: Bool = false

    var id: String { "\(audioUrl)|\(idx)" }
    var ref: EpisodeRef { EpisodeRef(audioUrl: audioUrl, feedUrl: feedUrl, guid: guid, episode: episode, show: show, artworkUrl: artworkUrl, bytes: bytes) }
    var seconds: Double { Double(max(0, endMs - startMs)) / 1000 }
}

/// One dictation attempt on the computer.
nonisolated struct Practice: Codable, Hashable, Sendable {
    var audioUrl: String = ""
    var feedUrl: String?
    var guid: String?
    var episode: String = ""
    var show: String = ""
    var artworkUrl: String?
    var bytes: Int64?
    var startedAt: Int = 0
    var updatedAt: Int = 0
    var finishedAt: Int?
    var seconds: Int = 0
    var answered: Int = 0
    var sentences: Int = 0
    /// Correct words in thousandths.
    var accuracy: Int = 0

    var ref: EpisodeRef { EpisodeRef(audioUrl: audioUrl, feedUrl: feedUrl, guid: guid, episode: episode, show: show, artworkUrl: artworkUrl, bytes: bytes) }
}

/// Time practised on a day by one device.
nonisolated struct Day: Codable, Hashable, Sendable {
    var day: String = ""
    var kind: String = ""
    var seconds: Int = 0
    var device: String = ""
}

/// The latest listen to an episode on the phone.
nonisolated struct Listen: Codable, Hashable, Sendable {
    var audioUrl: String = ""
    var feedUrl: String?
    var guid: String?
    var episode: String = ""
    var show: String = ""
    var artworkUrl: String?
    var durationS: Double = 0
    var positionS: Double = 0
    var finished: Bool = false
    var listenedAt: Int64 = 0

    var ref: EpisodeRef { EpisodeRef(audioUrl: audioUrl, feedUrl: feedUrl, guid: guid, episode: episode, show: show, artworkUrl: artworkUrl) }
}

/// Built field by field from a JSON object, so a missing or odd field takes its default instead of losing the record.
nonisolated protocol LenientDecodable {
    static func from(json: [String: Any]) -> Self
}

extension LenientDecodable {
    nonisolated static func from(data: Data) -> Self {
        from(json: (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:])
    }
}

nonisolated enum J {
    static func s(_ j: [String: Any], _ k: String) -> String { j[k] as? String ?? "" }
    static func os(_ j: [String: Any], _ k: String) -> String? { j[k] as? String }
    static func i(_ j: [String: Any], _ k: String) -> Int { (j[k] as? NSNumber)?.intValue ?? 0 }
    static func oi(_ j: [String: Any], _ k: String) -> Int? { (j[k] as? NSNumber)?.intValue }
    static func i64(_ j: [String: Any], _ k: String) -> Int64? { (j[k] as? NSNumber)?.int64Value }
    static func d(_ j: [String: Any], _ k: String) -> Double { (j[k] as? NSNumber)?.doubleValue ?? 0 }
    static func b(_ j: [String: Any], _ k: String) -> Bool { (j[k] as? NSNumber)?.boolValue ?? false }
    static func ob(_ j: [String: Any], _ k: String) -> Bool? { (j[k] as? NSNumber)?.boolValue }
}

extension WordContext: LenientDecodable {
    static func from(json j: [String: Any]) -> WordContext {
        WordContext(audioUrl: J.os(j, "audioUrl"), title: J.os(j, "title"), source: J.os(j, "source"), idx: J.i(j, "idx"),
                    sentence: J.s(j, "sentence"), typed: J.s(j, "typed"), startMs: J.i(j, "startMs"), endMs: J.i(j, "endMs"),
                    sentenceStartMs: J.i(j, "sentenceStartMs"), sentenceEndMs: J.i(j, "sentenceEndMs"),
                    addedAt: J.i(j, "addedAt"), practisedAt: J.oi(j, "practisedAt"))
    }
}

extension Word: LenientDecodable {
    static func from(json j: [String: Any]) -> Word {
        Word(text: J.s(j, "text"), headword: J.s(j, "headword"), ipa: J.s(j, "ipa"), meaning: J.s(j, "meaning"),
             note: J.s(j, "note"), explanation: J.s(j, "explanation"), card: J.os(j, "card"), dueAt: J.oi(j, "dueAt"),
             level: J.os(j, "level") ?? "new", addedAt: J.i(j, "addedAt"),
             contexts: (j["contexts"] as? [[String: Any]] ?? []).map(WordContext.from(json:)))
    }
}

extension Review: LenientDecodable {
    static func from(json j: [String: Any]) -> Review {
        Review(word: J.s(j, "word"), at: J.i(j, "at"), mode: J.s(j, "mode"), grade: J.oi(j, "grade") ?? 3,
               correct: J.ob(j, "correct"), typed: J.s(j, "typed"), seconds: J.i(j, "seconds"))
    }
}

extension Missed: LenientDecodable {
    static func from(json j: [String: Any]) -> Missed {
        Missed(audioUrl: J.s(j, "audioUrl"), feedUrl: J.os(j, "feedUrl"), guid: J.os(j, "guid"), episode: J.s(j, "episode"),
               show: J.s(j, "show"), artworkUrl: J.os(j, "artworkUrl"), bytes: J.i64(j, "bytes"), idx: J.i(j, "idx"),
               startMs: J.i(j, "startMs"), endMs: J.i(j, "endMs"), text: J.s(j, "text"), typed: J.s(j, "typed"),
               at: J.i(j, "at"), flagged: J.b(j, "flagged"))
    }
}

extension Practice: LenientDecodable {
    static func from(json j: [String: Any]) -> Practice {
        Practice(audioUrl: J.s(j, "audioUrl"), feedUrl: J.os(j, "feedUrl"), guid: J.os(j, "guid"), episode: J.s(j, "episode"),
                 show: J.s(j, "show"), artworkUrl: J.os(j, "artworkUrl"), bytes: J.i64(j, "bytes"),
                 startedAt: J.i(j, "startedAt"), updatedAt: J.i(j, "updatedAt"), finishedAt: J.oi(j, "finishedAt"),
                 seconds: J.i(j, "seconds"), answered: J.i(j, "answered"), sentences: J.i(j, "sentences"),
                 accuracy: J.i(j, "accuracy"))
    }
}

extension Day: LenientDecodable {
    static func from(json j: [String: Any]) -> Day {
        Day(day: J.s(j, "day"), kind: J.s(j, "kind"), seconds: J.i(j, "seconds"), device: J.s(j, "device"))
    }
}

extension Listen: LenientDecodable {
    static func from(json j: [String: Any]) -> Listen {
        Listen(audioUrl: J.s(j, "audioUrl"), feedUrl: J.os(j, "feedUrl"), guid: J.os(j, "guid"), episode: J.s(j, "episode"),
               show: J.s(j, "show"), artworkUrl: J.os(j, "artworkUrl"), durationS: J.d(j, "durationS"),
               positionS: J.d(j, "positionS"), finished: J.b(j, "finished"), listenedAt: J.i64(j, "listenedAt") ?? 0)
    }
}
