import Foundation
import SwiftData
import Testing
@testable import Eksigo

/// Up Next: added at the end, once each, never what's playing; it leaves the list when it starts; it's kept.
@MainActor
@Suite(.serialized)
struct UpNextTests {
    let container = try! ModelContainer(for: Schema(Store.schema), configurations: ModelConfiguration(isStoredInMemoryOnly: true))

    static func episode(_ n: Int, minutes: Double = 10) -> PodcastEpisode {
        PodcastEpisode(audioUrl: URL(string: "https://example.com/\(n).mp3?track=1")!, title: "Episode \(n)", summary: "",
                       duration: minutes * 60, showTitle: "Show")
    }

    /// The app keeps Up Next in the standard defaults: put back whatever the simulator had.
    func withSavedQueue(_ body: () throws -> Void) rethrows {
        let saved = UserDefaults.standard.data(forKey: "upNext")
        defer { UserDefaults.standard.set(saved, forKey: "upNext") }
        UserDefaults.standard.removeObject(forKey: "upNext")
        try body()
    }

    func center() -> PlaybackCenter {
        let defaults = UserDefaults(suiteName: "upnext-test-\(UUID())")!
        let store = RecordStore(context: container.mainContext, defaults: defaults)
        return PlaybackCenter(settings: AppSettings(defaults: defaults), store: store, context: container.mainContext)
    }

    @Test func addsAtTheEndOnce() {
        withSavedQueue {
            let c = center()
            #expect(c.addToQueue(Self.episode(1)) == 1)
            #expect(c.addToQueue(Self.episode(2)) == 2)
            #expect(c.addToQueue(Self.episode(1)) == nil)
            #expect(c.queue.map(\.title) == ["Episode 1", "Episode 2"])
            #expect(c.queueSeconds == 1200)
            c.moveQueue(from: [1], to: 0)
            #expect(c.queue.map(\.title) == ["Episode 2", "Episode 1"])
            c.removeFromQueue(Self.episode(2).key)
            #expect(c.queue.map(\.title) == ["Episode 1"])
        }
    }

    @Test func playingTakesItOutAndTheCurrentOneCantBeAdded() {
        withSavedQueue {
            let c = center()
            c.addToQueue(Self.episode(1))
            c.addToQueue(Self.episode(2))
            c.play(Self.episode(1))
            #expect(c.queue.map(\.title) == ["Episode 2"])
            #expect(c.addToQueue(Self.episode(1)) == nil)
            c.pause()
        }
    }

    @Test func itIsKeptForNextTime() {
        withSavedQueue {
            let c = center()
            c.addToQueue(Self.episode(3))
            #expect(center().queue.map(\.title) == ["Episode 3"])
            c.clearQueue()
            #expect(center().queue.isEmpty)
        }
    }
}
