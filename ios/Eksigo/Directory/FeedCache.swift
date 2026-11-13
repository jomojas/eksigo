import Foundation

/// Feeds read on this phone, kept for half an hour, so tabs and pages don't read the same feed twice.
@MainActor @Observable
final class FeedCache {
    static let shared = FeedCache()

    private(set) var feeds: [URL: FeedParser.Feed] = [:]
    private var loadedAt: [URL: Date] = [:]
    private(set) var failed: Set<URL> = []

    func feed(_ url: URL) -> FeedParser.Feed? { feeds[url] }

    func load(_ url: URL, force: Bool = false) async throws -> FeedParser.Feed {
        if !force, let f = feeds[url], let at = loadedAt[url], Date.now.timeIntervalSince(at) < 1800 { return f }
        do {
            let f = try await FeedParser.load(url)
            feeds[url] = f
            loadedAt[url] = .now
            failed.remove(url)
            return f
        } catch {
            failed.insert(url)
            throw error
        }
    }

    /// Several feeds at once; the ones that fail are left out.
    func load(_ urls: [URL]) async {
        await withTaskGroup(of: Void.self) { group in
            for url in urls { group.addTask { _ = try? await self.load(url) } }
        }
    }

    /// The newest episodes of these shows, newest first.
    func newest(_ urls: [URL], limit: Int) -> [PodcastEpisode] {
        urls.compactMap { feeds[$0] }.flatMap { $0.episodes.prefix(5) }
            .sorted { ($0.published ?? .distantPast) > ($1.published ?? .distantPast) }
            .prefix(limit).map { $0 }
    }
}
