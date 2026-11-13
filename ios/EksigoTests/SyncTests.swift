import Foundation
import SwiftData
import Testing
@testable import Eksigo

@MainActor
struct SyncTests {
    /// Kept for the whole test: the store's context lives in it.
    let container = try! ModelContainer(for: Schema(Store.schema), configurations: ModelConfiguration(isStoredInMemoryOnly: true))

    func store() throws -> RecordStore {
        RecordStore(context: container.mainContext, defaults: UserDefaults(suiteName: "sync-test-\(UUID())")!)
    }

    @Test func incomingChangesReplaceUnlessChangedHereLater() throws {
        let s = try store()
        s.put("listen", "a", ["audioUrl": "a", "positionS": 10])
        let mine = s.records(dirtyOnly: true)[0].changedAt
        // An older change from elsewhere doesn't overwrite what this phone changed since.
        s.apply([SyncChange(kind: "listen", key: "a", changedAt: mine - 1, data: AnyJSON(["audioUrl": "a", "positionS": 99]))])
        #expect(s.listens[0].positionS == 10)
        // A newer one does.
        s.apply([SyncChange(kind: "listen", key: "a", changedAt: mine + 1, data: AnyJSON(["audioUrl": "a", "positionS": 50]))])
        #expect(s.listens[0].positionS == 50)
        #expect(s.records(dirtyOnly: true).isEmpty)
        // A deletion removes it.
        s.apply([SyncChange(kind: "listen", key: "a", changedAt: mine + 2, deleted: true)])
        #expect(s.listens.isEmpty)
    }

    @Test func whatTheServerTookIsNoLongerDirty() throws {
        let s = try store()
        s.put("listen", "a", ["audioUrl": "a"])
        let sent = s.records(dirtyOnly: true).map { SyncChange(kind: $0.kind, key: $0.key, changedAt: $0.changedAt) }
        // Changed again before the answer came: still to send.
        s.put("listen", "a", ["audioUrl": "a", "positionS": 3])
        s.sent(sent)
        #expect(s.records(dirtyOnly: true).count == 1)
        let again = s.records(dirtyOnly: true).map { SyncChange(kind: $0.kind, key: $0.key, changedAt: $0.changedAt) }
        s.sent(again)
        #expect(s.records(dirtyOnly: true).isEmpty)
    }

    @Test func anotherAccountKeepsOnlyThisPhonesListeningAndDays() throws {
        let s = try store()
        s.apply([SyncChange(kind: "word", key: "gist", changedAt: 1, data: AnyJSON(["text": "gist"])),
                 SyncChange(kind: "day", key: "2026-11-13|dictation|desktop-1", changedAt: 1,
                            data: AnyJSON(["day": "2026-11-13", "kind": "dictation", "seconds": 60, "device": "desktop-1"]))])
        s.put("listen", "a", ["audioUrl": "a"])
        s.addSeconds(30, kind: "listening")
        s.flush()
        s.startOver()
        #expect(s.words.isEmpty)
        #expect(Set(s.records(dirtyOnly: true).map(\.kind)) == ["listen", "day"])
        #expect(s.days.allSatisfy { $0.device == s.device })
    }

    @Test func daysAddUpWholeSeconds() throws {
        let s = try store()
        s.addSeconds(0.6, kind: "listening")
        s.flush()
        #expect(s.days.isEmpty)
        s.addSeconds(0.6, kind: "listening")
        s.flush()
        #expect(s.days.first?.seconds == 1)
        s.addSeconds(10, kind: "listening")
        s.flush()
        #expect(s.days.first?.seconds == 11)
    }

    @Test func changesTravelAsTheApiWantsThem() throws {
        let change = SyncChange(kind: "review", key: "gist|1|recall", changedAt: 5,
                                data: AnyJSON(["grade": 1, "correct": NSNull(), "ok": true, "x": 0.5, "n": 0]))
        let json = try #require(try JSONSerialization.jsonObject(with: JSONEncoder().encode(change)) as? [String: Any])
        #expect(json["deleted"] == nil)
        let data = try #require(json["data"] as? [String: Any])
        #expect(data["grade"] as? Int == 1)
        #expect(data["correct"] is NSNull)
        // 0 and 1 stay numbers; true stays a boolean.
        #expect((data["n"] as? NSNumber).map { CFGetTypeID($0) != CFBooleanGetTypeID() } == true)
        #expect((data["ok"] as? NSNumber).map { CFGetTypeID($0) == CFBooleanGetTypeID() } == true)
        #expect(data["x"] as? Double == 0.5)
        let back = try JSONDecoder().decode(SyncChange.self, from: JSONEncoder().encode(change))
        #expect(back == change)
    }
}

struct StatsTests {
    let cal: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "UTC")!
        return c
    }()

    @Test func streaksCountDaysInARow() {
        let today = Date(timeIntervalSince1970: 1_794_528_000)  // 2026-11-13 00:00 UTC
        let byDay = ["2026-11-13": 60, "2026-11-12": 30, "2026-11-11": 10, "2026-11-09": 100]
        #expect(Stats.streak(byDay, today: today, calendar: cal) == 3)
        // Nothing yet today: the streak up to yesterday still counts.
        #expect(Stats.streak(["2026-11-12": 30, "2026-11-11": 10], today: today, calendar: cal) == 2)
        #expect(Stats.bestStreak(byDay, calendar: cal) == 3)
    }

    @Test func missedWordsAreMarked() {
        let r = Compare.align("People were likely to follow through.", "People were likely to fall.")
        #expect(r.sentence.filter(\.marked).map(\.text) == ["follow through."])
        #expect(r.typed.filter(\.marked).map(\.text) == ["fall."])
        let gap = Compare.align("It’s less about willpower than about friction.", "It’s than about friction.")
        #expect(gap.sentence.filter(\.marked).map(\.text) == ["less about willpower"])
        #expect(gap.typed.map(\.text).joined() == "It’s ___ than about friction.")
    }
}
