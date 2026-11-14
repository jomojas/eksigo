import Foundation
import SwiftData
import Testing
@testable import Eksigo

@MainActor
struct PracticeTests {
    static let now = 1_800_000_000
    static let today = now - 3600

    static func word(_ text: String, level: String = "new", due: Int? = nil, added: Int = 0, meaning: String = "") -> Word {
        Word(text: text, meaning: meaning.isEmpty ? "meaning of \(text)" : meaning, dueAt: due, level: level, addedAt: added,
             contexts: [WordContext(audioUrl: "https://example.com/a.mp3", title: "Ep", idx: 1, sentence: "I want to \(text) now.",
                                    sentenceStartMs: 1000, sentenceEndMs: 4000)])
    }

    @Test func wordsAreFoundInTheirSentence() {
        #expect(PracticeRules.split("People were likely to follow through.", "follow through") == ["People were likely to ", "follow through", "."])
        #expect(PracticeRules.split("Well, honestly", "well honestly") == ["", "Well, honestly", ""])
        #expect(PracticeRules.split("Put it in the in-tray.", "in") == ["Put it ", "in", " the in-tray."])
        #expect(PracticeRules.split("It’s fine", "it's") == ["", "It’s", " fine"])
        #expect(PracticeRules.split("Nothing here", "gist") == nil)
        #expect(PracticeRules.wordsOf("Follow-through!") == ["follow-through"])
    }

    @Test func dueWordsComeFirstAndNewOnesAreLimited() {
        var words = (0..<15).map { Self.word("new\($0)", added: $0) }
        words.append(Self.word("due-later", level: "learning", due: Self.now - 10, added: 100))
        words.append(Self.word("due-first", level: "familiar", due: Self.now - 1000, added: 101))
        words.append(Self.word("not-due", level: "known", due: Self.now + 1000, added: 102))
        // Three new words started today already.
        let reviews = ["new0", "new1", "new2"].map { Review(word: $0, at: Self.today + 10, mode: "recall", grade: 3) }
        let counts = PracticeRules.counts(words: words, reviews: reviews, now: Self.now, today: Self.today)
        #expect(counts == .init(due: 2, new: PracticeRules.newPerDay - 3))
        var rng = SystemRandomNumberGenerator()
        let queue = PracticeRules.queue(words: words, reviews: reviews, now: Self.now, today: Self.today, random: &rng)
        #expect(queue.map(\.word.text).prefix(2) == ["due-first", "due-later"])
        #expect(queue.count == 2 + 7)
        #expect(queue[2].word.text == "new0")
    }

    @Test func newWordsPickFromFourMeanings() {
        let words = ["a", "b", "c", "d"].map { Self.word($0) }
        var rng = SystemRandomNumberGenerator()
        let item = PracticeRules.item(words[0], all: words, now: Self.now, random: &rng)!
        #expect(item.mode == "pick")
        #expect(item.choices.count == 4)
        #expect(item.choices.contains(item.answer))
        // Too few other words: recall instead.
        let alone = PracticeRules.item(words[0], all: Array(words.prefix(2)), now: Self.now, random: &rng)!
        #expect(alone.mode == "recall")
    }

    @Test func gradingChangesTheWordAndAddsAReview() throws {
        let container = try ModelContainer(for: Schema(Store.schema), configurations: ModelConfiguration(isStoredInMemoryOnly: true))
        let defaults = UserDefaults(suiteName: "practice-test-\(UUID())")!
        let store = RecordStore(context: container.mainContext, defaults: defaults)
        let w = Self.word("follow through")
        // As the computer sent it, with a field this version doesn't know.
        var json = try #require(try JSONSerialization.jsonObject(with: JSONEncoder().encode(w)) as? [String: Any])
        json["somethingNew"] = 7
        store.apply([SyncChange(kind: "word", key: w.key, changedAt: 1, data: AnyJSON(json))])
        #expect(store.records(dirtyOnly: true).isEmpty)

        var rng = SystemRandomNumberGenerator()
        let item = PracticeRules.item(store.word(w.key)!, all: store.words, now: Self.now, random: &rng)!
        let level = store.grade(item, grade: 3, mode: "recall", correct: nil, typed: "", seconds: 12,
                                now: Date(timeIntervalSince1970: TimeInterval(Self.now)))
        #expect(level == .familiar)
        let saved = store.word(w.key)!
        #expect(saved.level == "familiar")
        #expect(saved.dueAt == Self.now + 3 * 86400)
        #expect(saved.contexts[0].practisedAt == Self.now)
        #expect(store.json("word", w.key)?["somethingNew"] as? Int == 7)
        let review = try #require(store.json("review", "follow through|\(Self.now)|recall"))
        #expect(review["grade"] as? Int == 3)
        #expect(review["correct"] is NSNull)
        let dirty = Set(store.records(dirtyOnly: true).map(\.kind))
        #expect(dirty == ["word", "review"])
        store.flush()
        #expect(store.days.first { $0.kind == "words" }?.seconds == 12)
    }
}
