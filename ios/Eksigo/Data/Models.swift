import Foundation
import SwiftData

/// A show the learner follows. The show is kept as JSON: it comes from feeds we don't control and is only read whole.
@Model final class Subscription {
    @Attribute(.unique) var feedUrl: String
    var showData: Data
    var subscribedAt: Date

    init(show: PodcastShow) {
        feedUrl = show.feedUrl.absoluteString
        showData = (try? JSONEncoder().encode(show)) ?? Data()
        subscribedAt = .now
    }

    var show: PodcastShow? { try? JSONDecoder().decode(PodcastShow.self, from: showData) }
}

/// An episode played or downloaded on this phone: where it was left, and its file.
@Model final class EpisodeRecord {
    @Attribute(.unique) var key: String
    var episodeData: Data
    var position: Double = 0
    var duration: Double = 0
    var played = false
    var lastPlayedAt: Date?
    /// File name in Application Support/downloads.
    var localFile: String?
    var downloadedAt: Date?
    /// The file's size, to check it's the one the computer dictated (`missed.bytes`).
    var fileBytes: Int64?

    init(episode: PodcastEpisode) {
        key = episode.key
        episodeData = (try? JSONEncoder().encode(episode)) ?? Data()
        duration = episode.duration ?? 0
    }

    var episode: PodcastEpisode? { try? JSONDecoder().decode(PodcastEpisode.self, from: episodeData) }
    var progress: Double { duration > 0 ? min(1, position / duration) : 0 }
}

/// One sync record (API.md "Sync"), as the server has it or as this phone changed it. `data` is the record's JSON,
/// kept whole, so fields this version doesn't know survive a change made here.
@Model final class SyncRecord {
    @Attribute(.unique) var id: String
    var kind: String
    var key: String
    var data: Data
    /// When it last changed, on whichever device changed it (unix ms).
    var changedAt: Int64
    /// Changed here and not yet taken by the server.
    var dirty: Bool
    /// Deleted here, to be sent as a deletion; removed once the server has it.
    var deleted = false

    init(kind: String, key: String, data: Data, changedAt: Int64, dirty: Bool) {
        id = SyncRecord.id(kind, key)
        self.kind = kind
        self.key = key
        self.data = data
        self.changedAt = changedAt
        self.dirty = dirty
    }

    static func id(_ kind: String, _ key: String) -> String { "\(kind)\u{1F}\(key)" }

    var json: [String: Any] { (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:] }
}

enum Store {
    static let schema: [any PersistentModel.Type] = [Subscription.self, EpisodeRecord.self, SyncRecord.self]

    static func record(for episode: PodcastEpisode, in context: ModelContext) -> EpisodeRecord {
        let key = episode.key
        if let r = try? context.fetch(FetchDescriptor<EpisodeRecord>(predicate: #Predicate { $0.key == key })).first { return r }
        let r = EpisodeRecord(episode: episode)
        context.insert(r)
        return r
    }

    static func existingRecord(key: String, in context: ModelContext) -> EpisodeRecord? {
        try? context.fetch(FetchDescriptor<EpisodeRecord>(predicate: #Predicate { $0.key == key })).first
    }

    /// Subscribes or unsubscribes, wherever it is done (Discover, the show page).
    static func setSubscribed(_ show: PodcastShow, _ on: Bool, in context: ModelContext) {
        let url = show.feedUrl.absoluteString
        let existing = (try? context.fetch(FetchDescriptor<Subscription>(predicate: #Predicate { $0.feedUrl == url }))) ?? []
        if on {
            if existing.isEmpty { context.insert(Subscription(show: show)) }
        } else {
            existing.forEach(context.delete)
        }
        try? context.save()
    }
}
