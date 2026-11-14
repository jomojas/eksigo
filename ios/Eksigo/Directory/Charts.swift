import Foundation

/// A show in a list: our learners list or Apple's charts. Apple's charts give no feed: it's looked up on opening.
nonisolated struct Listing: Hashable, Identifiable, Sendable {
    var appleId: String?
    var title: String
    var author: String
    var feedUrl: URL?
    var artworkUrl: URL?
    var note: String?

    var id: String { appleId ?? feedUrl?.absoluteString ?? title }

    var show: PodcastShow? {
        feedUrl.map { PodcastShow(feedUrl: $0, title: title, author: author, artworkUrl: artworkUrl, summary: nil) }
    }
}

nonisolated enum Directory {
    /// Shows with clear speech at a steady pace, chosen by us (the desktop's `data/learners.json`).
    static func forLearners() -> [Listing] {
        struct L: Decodable { let appleId: String; let title: String; let author: String; let feedUrl: String; let artworkUrl: String; let blurb: String }
        guard let url = Bundle.main.url(forResource: "learners", withExtension: "json"),
              let data = try? Data(contentsOf: url), let list = try? JSONDecoder().decode([L].self, from: data) else { return [] }
        return list.map { Listing(appleId: $0.appleId, title: $0.title, author: $0.author, feedUrl: URL(string: $0.feedUrl),
                                  artworkUrl: URL(string: $0.artworkUrl), note: $0.blurb) }
    }

    /// Apple's top podcasts in the US store, where nearly every English show is listed.
    static func top(country: String = "us") async throws -> [Listing] {
        let url = URL(string: "https://itunes.apple.com/\(country)/rss/toppodcasts/limit=30/json")!
        let (data, _) = try await URLSession.shared.data(from: url)
        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        let entries = (json?["feed"] as? [String: Any])?["entry"] as? [[String: Any]] ?? []
        func label(_ v: Any?) -> String? { (v as? [String: Any])?["label"] as? String }
        return entries.compactMap { e in
            guard let title = label(e["im:name"]) else { return nil }
            let id = ((e["id"] as? [String: Any])?["attributes"] as? [String: Any])?["im:id"] as? String
            let image = (e["im:image"] as? [[String: Any]])?.last.flatMap { $0["label"] as? String }
            return Listing(appleId: id, title: title, author: label(e["im:artist"]) ?? "", feedUrl: nil,
                           artworkUrl: image.flatMap(URL.init(string:)), note: nil)
        }
    }

    /// A show's feed from its Apple id.
    static func lookup(_ appleId: String) async throws -> PodcastShow {
        var c = URLComponents(string: "https://itunes.apple.com/lookup")!
        c.queryItems = [.init(name: "id", value: appleId), .init(name: "entity", value: "podcast")]
        let (data, _) = try await URLSession.shared.data(from: c.url!)
        let results = ((try JSONSerialization.jsonObject(with: data)) as? [String: Any])?["results"] as? [[String: Any]] ?? []
        for r in results {
            if let feed = (r["feedUrl"] as? String).flatMap(URL.init(string:)) {
                return PodcastShow(feedUrl: feed, title: r["collectionName"] as? String ?? "", author: r["artistName"] as? String,
                                   artworkUrl: (r["artworkUrl600"] as? String).flatMap(URL.init(string:)), genre: r["primaryGenreName"] as? String)
            }
        }
        throw URLError(.resourceUnavailable, userInfo: [NSLocalizedDescriptionKey: "This show has no public RSS feed, so it can't be played in Eksigo."])
    }
}
