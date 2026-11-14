import Foundation
import Testing
@testable import Eksigo

/// The Swift FSRS must schedule exactly as the desktop's rs-fsrs 1.2.1 (enable_short_term: false). The expected values
/// come from running the crate on the same answers.
struct FSRSTests {
    /// (time of the answer, grade, seconds until due for Again/Hard/Good/Easy before answering, the card after it as rs-fsrs writes it)
    static let reference: [(Int, Int, [Int], String)] = [
        (1800000000, 3, [86400, 172800, 259200, 1296000], #"{"due":"2027-01-18T08:00:00Z","stability":3.1262,"difficulty":5.314577829570867,"elapsed_days":0,"scheduled_days":3,"reps":1,"lapses":0,"state":"Review","last_review":"2027-01-15T08:00:00Z"}"#),
        (1800262800, 3, [86400, 432000, 950400, 2332800], #"{"due":"2027-01-29T09:00:00Z","stability":11.388439207533409,"difficulty":5.267035550345074,"elapsed_days":3,"scheduled_days":11,"reps":2,"lapses":0,"state":"Review","last_review":"2027-01-18T09:00:00Z"}"#),
        (1801126800, 1, [172800, 1468800, 2937600, 6825600], #"{"due":"2027-01-30T09:00:00Z","stability":2.294933505074692,"difficulty":7.300959080453166,"elapsed_days":10,"scheduled_days":2,"reps":3,"lapses":1,"state":"Review","last_review":"2027-01-28T09:00:00Z"}"#),
        (1801220400, 2, [86400, 259200, 345600, 691200], #"{"due":"2027-02-01T11:00:00Z","stability":2.7721245919761737,"difficulty":8.247112139956727,"elapsed_days":1,"scheduled_days":3,"reps":4,"lapses":1,"state":"Review","last_review":"2027-01-29T11:00:00Z"}"#),
        (1801566000, 4, [86400, 345600, 691200, 1555200], #"{"due":"2027-02-20T11:00:00Z","stability":18.062131907999817,"difficulty":7.090771897867905,"elapsed_days":4,"scheduled_days":18,"reps":5,"lapses":1,"state":"Review","last_review":"2027-02-02T11:00:00Z"}"#),
        (1804158000, 3, [259200, 2419200, 5097600, 11923200], #"{"due":"2027-05-02T11:00:00Z","stability":58.6240946917951,"difficulty":7.0016666774439615,"elapsed_days":30,"scheduled_days":59,"reps":6,"lapses":1,"state":"Review","last_review":"2027-03-04T11:00:00Z"}"#),
        (1804330800, 1, [345600, 5097600, 5270400, 5788800], #"{"due":"2027-03-10T11:00:00Z","stability":3.942318025994013,"difficulty":8.994999839177938,"elapsed_days":2,"scheduled_days":4,"reps":7,"lapses":2,"state":"Review","last_review":"2027-03-06T11:00:00Z"}"#),
        (1812106800, 4, [345600, 950400, 2937600, 7862400], #"{"due":"2027-09-03T11:00:00Z","stability":91.33015140532169,"difficulty":7.82115902492734,"elapsed_days":90,"scheduled_days":91,"reps":8,"lapses":2,"state":"Review","last_review":"2027-06-04T11:00:00Z"}"#),
    ]

    @Test func schedulesLikeTheDesktop() throws {
        var card: FSRS.Card? = nil
        for (at, grade, next, expectedJSON) in Self.reference {
            let now = Date(timeIntervalSince1970: TimeInterval(at))
            let current = card ?? .new(at: Date(timeIntervalSince1970: 1_800_000_000))
            let preview = FSRS.preview(current, at: now)
            #expect(FSRS.Rating.allCases.map { Int(preview[$0]!.due.timeIntervalSince1970) - at } == next)
            let after = FSRS.next(current, at: now, FSRS.Rating(rawValue: grade)!)
            let expected = FSRS.decode(expectedJSON, now: now)
            #expect(after.due == expected.due)
            #expect(after.last_review == expected.last_review)
            #expect(abs(after.stability - expected.stability) < 1e-9)
            #expect(abs(after.difficulty - expected.difficulty) < 1e-9)
            #expect(after.elapsed_days == expected.elapsed_days)
            #expect(after.scheduled_days == expected.scheduled_days)
            #expect(after.reps == expected.reps)
            #expect(after.lapses == expected.lapses)
            #expect(after.state == expected.state)
            // What the phone writes reads back the same.
            #expect(FSRS.decode(FSRS.encode(after), now: now) == after)
            card = after
        }
    }

    @Test func cardsKeepTheDesktopsFormat() throws {
        let card = FSRS.decode(Self.reference[0].3, now: .now)
        let json = try #require(try JSONSerialization.jsonObject(with: Data(FSRS.encode(card).utf8)) as? [String: Any])
        #expect(Set(json.keys) == ["due", "stability", "difficulty", "elapsed_days", "scheduled_days", "reps", "lapses", "state", "last_review"])
        #expect(json["due"] as? String == "2027-01-18T08:00:00Z")
        #expect(json["state"] as? String == "Review")
    }

    @Test func levelsFollowTheInterval() {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        var c = FSRS.Card.new(at: now)
        #expect(FSRS.level(c) == .new)
        c.state = .Review
        c.scheduled_days = 2
        #expect(FSRS.level(c) == .learning)
        c.scheduled_days = 3
        #expect(FSRS.level(c) == .familiar)
        c.scheduled_days = 21
        #expect(FSRS.level(c) == .known)
        let known = FSRS.known(.new(at: now), at: now)
        #expect(FSRS.level(known) == .known)
        #expect(known.due == now.addingTimeInterval(365 * 86400))
    }

    @Test func aMissingCardIsNew() {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        #expect(FSRS.decode(nil, now: now) == .new(at: now))
        #expect(FSRS.decode("not json", now: now) == .new(at: now))
    }
}
