import Foundation

/// A show from Apple's directory, our Discover zones, or a subscription.
nonisolated struct PodcastShow: Codable, Hashable, Identifiable, Sendable {
    var id: String { feedUrl.absoluteString }
    let feedUrl: URL
    var title: String
    var author: String?
    var artworkUrl: URL?
    var genre: String?
    var summary: String?
    /// Date of the newest episode, from Apple's directory (search results only).
    var lastEpisode: Date? = nil

    /// No new episode for a year: the show has probably stopped (CNN 10's old video feed ended in 2020).
    var stopped: Bool { lastEpisode.map { $0 < Date.now.addingTimeInterval(-365 * 86400) } ?? false }
}

/// An episode from an RSS feed or Apple's episode search. `key` identifies it everywhere on the phone
/// (progress, queue, history): the audio URL without its query string, which tracking prefixes change.
nonisolated struct PodcastEpisode: Codable, Hashable, Identifiable, Sendable {
    var id: String { key }
    let audioUrl: URL
    var guid: String?
    var title: String
    var summary: String
    var published: Date?
    var duration: Double?
    var artworkUrl: URL?
    var showTitle: String
    var showArtworkUrl: URL?
    var feedUrl: URL?
    var audioBytes: Int64?
    /// The publisher's own transcript (podcast:transcript), and its type ("application/json", "text/vtt", …).
    var transcriptUrl: URL?
    var transcriptType: String?

    var key: String {
        var c = URLComponents(url: audioUrl, resolvingAgainstBaseURL: false)
        c?.query = nil
        return c?.string ?? audioUrl.absoluteString
    }

    var artwork: URL? { artworkUrl ?? showArtworkUrl }
}

/// Apple's iTunes Search API, called from the phone: free, no key (DESIGN.md section 11, Search).
enum ApplePodcasts {
    /// Shows that still publish come first; ones that stopped keep Apple's order after them.
    static func searchShows(_ term: String) async throws -> [PodcastShow] {
        let shows: [PodcastShow] = try await search(term, entity: "podcast").compactMap { r in
            guard let feed = (r["feedUrl"] as? String).flatMap(URL.init(string:)) else { return nil }
            return PodcastShow(feedUrl: feed, title: r["collectionName"] as? String ?? "", author: r["artistName"] as? String,
                               artworkUrl: (r["artworkUrl600"] as? String).flatMap(URL.init(string:)),
                               genre: r["primaryGenreName"] as? String,
                               lastEpisode: (r["releaseDate"] as? String).flatMap { ISO8601DateFormatter().date(from: $0) })
        }
        return shows.filter { !$0.stopped } + shows.filter(\.stopped)
    }

    static func searchEpisodes(_ term: String) async throws -> [PodcastEpisode] {
        try await search(term, entity: "podcastEpisode").compactMap { r in
            guard let audio = (r["episodeUrl"] as? String).flatMap(URL.init(string:)) else { return nil }
            return PodcastEpisode(
                audioUrl: audio, guid: r["episodeGuid"] as? String, title: r["trackName"] as? String ?? "",
                summary: (r["description"] as? String ?? "").strippingHTML,
                published: (r["releaseDate"] as? String).flatMap { ISO8601DateFormatter().date(from: $0) },
                duration: (r["trackTimeMillis"] as? Double).map { $0 / 1000 },
                artworkUrl: (r["artworkUrl600"] as? String).flatMap(URL.init(string:)),
                showTitle: r["collectionName"] as? String ?? "",
                showArtworkUrl: (r["artworkUrl600"] as? String).flatMap(URL.init(string:)),
                feedUrl: (r["feedUrl"] as? String).flatMap(URL.init(string:)))
        }
    }

    /// Searches the US store, where nearly every English podcast is listed, and the phone's own store, US results
    /// first. Searching only the phone's store missed shows: the China store has no current CNN 10, only its old
    /// video feed, and answers "CNN10" with BBC shows (2026-10-25).
    private static func search(_ term: String, entity: String) async throws -> [[String: Any]] {
        let local = Locale.current.region?.identifier.lowercased() ?? "us"
        async let us = fetch(term, entity: entity, country: "us")
        async let here = local == "us" ? nil : try? await fetch(term, entity: entity, country: local)
        let pages = [try await us, await here].compactMap { $0 }
        var seen = Set<String>()
        return pages.flatMap(results).filter { r in
            let id = (r["feedUrl"] as? String ?? "") + (r["episodeUrl"] as? String ?? "")
            return !id.isEmpty && seen.insert(id).inserted
        }
    }

    nonisolated private static func fetch(_ term: String, entity: String, country: String) async throws -> Data {
        var c = URLComponents(string: "https://itunes.apple.com/search")!
        c.queryItems = [.init(name: "media", value: "podcast"), .init(name: "entity", value: entity),
                        .init(name: "term", value: term), .init(name: "limit", value: "25"),
                        .init(name: "country", value: country)]
        return try await URLSession.shared.data(from: c.url!).0
    }

    private static func results(_ data: Data) -> [[String: Any]] {
        let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        return json?["results"] as? [[String: Any]] ?? []
    }
}

extension String {
    /// Show notes come as HTML: plain text for lists and cards.
    nonisolated var strippingHTML: String {
        var s = replacingOccurrences(of: "<br\\s*/?>|</p>", with: "\n", options: .regularExpression)
        s = s.replacingOccurrences(of: "<[^>]+>", with: "", options: .regularExpression)
        for (entity, char) in ["&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": "\"", "&#39;": "'", "&nbsp;": " ", "&#8217;": "’", "&#8220;": "“", "&#8221;": "”"] {
            s = s.replacingOccurrences(of: entity, with: char)
        }
        return s.replacingOccurrences(of: "[ \\t]+", with: " ", options: .regularExpression)
            .replacingOccurrences(of: "\\n{3,}", with: "\n\n", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
