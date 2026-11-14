#if DEBUG
import Foundation

/// Made-up records, as if synced from the computer, to try the screens in the simulator (`-sample YES`).
enum Sample {
    static func fill(_ store: RecordStore) {
        guard store.words.isEmpty else { return }
        let now = Int(Date.now.timeIntervalSince1970)
        let lastNight = Int(Calendar.current.startOfDay(for: .now).timeIntervalSince1970) - 3 * 3600
        let ep1 = ["audioUrl": "https://example.com/morning-walk/small-habits.mp3", "feedUrl": "https://example.com/morning-walk.rss",
                   "guid": "mw-112", "episode": "Why small habits beat big plans", "show": "The Morning Walk"]
        let ep2 = ["audioUrl": "https://example.com/city-science/rain.mp3", "feedUrl": "https://example.com/city-science.rss",
                   "guid": "cs-41", "episode": "What rain does to a city", "show": "City Science"]
        var changes: [SyncChange] = []
        func add(_ kind: String, _ key: String, _ data: [String: Any], at: Int = now) {
            changes.append(SyncChange(kind: kind, key: key, changedAt: Int64(at) * 1000, data: AnyJSON(data)))
        }
        let missed: [([String: String], Int, String, String)] = [
            (ep1, 12, "Most of us overestimate what a single day can hold.", "Most of us over estimate what a single day can hold."),
            (ep1, 31, "People who wrote down their plans were about twice as likely to follow through.",
             "People who wrote down their plans were about twice as likely to fall."),
            (ep1, 44, "It’s less about willpower than about friction.", "It’s than about friction."),
            (ep2, 5, "The drains under the old town were built for a smaller city.", "The trains under the old town were built for a smaller city."),
        ]
        for (ep, idx, text, typed) in missed {
            var d: [String: Any] = ep
            d.merge(["idx": idx, "startMs": idx * 9000, "endMs": idx * 9000 + 4200, "text": text, "typed": typed, "at": lastNight, "flagged": false]) { $1 }
            add("missed", "\(ep["audioUrl"]!)|\(idx)", d, at: lastNight)
        }
        var p1: [String: Any] = ep1
        p1.merge(["startedAt": lastNight - 2460, "updatedAt": lastNight, "finishedAt": lastNight, "seconds": 2460, "answered": 100,
                  "sentences": 100, "accuracy": 862]) { $1 }
        add("practice", "\(ep1["audioUrl"]!)|\(lastNight - 2460)", p1, at: lastNight)
        let words: [(String, String, String, String, Int?)] = [
            ("follow through", "贯彻到底；坚持完成\nto finish something you have started", "learning", "usually with “on”: follow through on a plan", now - 3600),
            ("overestimate", "高估", "new", "", nil),
            ("friction", "摩擦；阻力", "learning", "", now - 60),
            ("in the long run", "从长远来看", "familiar", "", now + 9 * 86400),
            ("doomscrolling", "没完没了地刷坏消息", "familiar", "", now + 12 * 86400),
            ("gist", "要点；大意", "known", "", now + 150 * 86400),
            ("put off", "推迟；拖延", "learning", "", now + 86400),
            ("hold up", "支撑；耽搁", "new", "", nil),
        ]
        for (i, (text, meaning, level, note, due)) in words.enumerated() {
            let sentence = i == 0 ? missed[1].2 : "We talked about \(text) on the way home."
            add("word", text, ["text": text, "headword": text, "ipa": i == 0 ? "/ˌfɒləʊ ˈθruː/" : "", "meaning": meaning, "note": note,
                               "explanation": "", "card": NSNull(), "dueAt": due.map { $0 as Any } ?? NSNull(), "level": level,
                               "addedAt": now - (10 - i) * 86400,
                               "contexts": [["audioUrl": ep1["audioUrl"]!, "title": ep1["episode"]!, "source": "podcast", "idx": 31,
                                             "sentence": sentence, "typed": "", "startMs": 280_000, "endMs": 281_000,
                                             "sentenceStartMs": 279_000, "sentenceEndMs": 283_200, "addedAt": now - (10 - i) * 86400]]])
        }
        for back in 0..<6 {
            let day = Stats.key(Date.now.addingTimeInterval(TimeInterval(-back * 86400)))
            add("day", "\(day)|dictation|desktop-sample", ["day": day, "kind": "dictation", "seconds": [2460, 1800, 0, 3000, 1200, 2400][back],
                                                           "device": "desktop-sample"])
        }
        store.apply(changes)
    }
}
#endif
