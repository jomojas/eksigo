import SwiftUI
import UIKit

/// Podcast cover art, through our server's copy (`/v1/art`), which reaches image hosts blocked in some countries.
///
/// Covers are loaded by `CoverCache`, not by the view: a list that redraws (the Listen page does, twice a second, for
/// the mini player) or a row that scrolls away no longer cancels a cover half way, so it is there the next time.
/// An episode's own cover that can't be had falls back to its show's.
struct Artwork: View {
    let urls: [URL]
    var size: CGFloat = 44
    var radius: CGFloat = 8
    @State private var image: UIImage?

    init(url: URL?, fallback: URL? = nil, size: CGFloat = 44, radius: CGFloat = 8) {
        var list: [URL] = []
        if let url { list.append(url) }
        if let fallback, fallback != url { list.append(fallback) }
        urls = list
        self.size = size
        self.radius = radius
        _image = State(initialValue: CoverCache.shared.cached(list))
    }

    init(episode: PodcastEpisode, size: CGFloat = 44, radius: CGFloat = 8) {
        self.init(url: episode.artworkUrl, fallback: episode.showArtworkUrl, size: size, radius: radius)
    }

    var body: some View {
        ZStack {
            Theme.surface3
            if let image {
                Image(uiImage: image).resizable().scaledToFill()
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: radius))
        .overlay(RoundedRectangle(cornerRadius: radius).strokeBorder(Theme.hairline))
        .accessibilityHidden(true)
        .task(id: urls) {
            if let found = CoverCache.shared.cached(urls) { image = found; return }
            image = nil
            if let loaded = await CoverCache.shared.image(urls) { image = loaded }
        }
    }
}

/// Every cover the app shows: kept in memory, on disk (URLCache), and loaded once however many rows ask for it.
@MainActor
final class CoverCache {
    static let shared = CoverCache()

    private let memory = NSCache<NSURL, UIImage>()
    private var loading: [URL: Task<UIImage?, Never>] = [:]
    /// Covers that couldn't be had, so a list doesn't ask again on every redraw (cleared on the next launch).
    private var missing: Set<URL> = []
    private let session: URLSession = {
        let c = URLSessionConfiguration.default
        c.urlCache = URLCache(memoryCapacity: 16 << 20, diskCapacity: 200 << 20,
                              directory: URL.cachesDirectory.appending(path: "covers", directoryHint: .isDirectory))
        c.requestCachePolicy = .returnCacheDataElseLoad
        c.timeoutIntervalForRequest = 30
        c.httpMaximumConnectionsPerHost = 6
        return URLSession(configuration: c)
    }()

    private var tints: [URL: UIColor] = [:]

    private init() { memory.countLimit = 300 }

    /// The cover's average colour, for the player's background.
    func tint(_ urls: [URL]) async -> UIColor? {
        for url in urls { if let t = tints[url] { return t } }
        for url in urls {
            guard let image = await image(url) else { continue }
            let t = await Task.detached(priority: .userInitiated) { Self.average(image) }.value
            if let t { tints[url] = t; return t }
        }
        return nil
    }

    nonisolated private static func average(_ image: UIImage) -> UIColor? {
        guard let cg = image.cgImage else { return nil }
        // Drawn into a context of a known layout (RGBA, 8 bits each), so the bytes are read the right way round.
        var px = [UInt8](repeating: 0, count: 8 * 8 * 4)
        guard let ctx = CGContext(data: &px, width: 8, height: 8, bitsPerComponent: 8, bytesPerRow: 32,
                                  space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { return nil }
        ctx.interpolationQuality = .medium
        ctx.draw(cg, in: CGRect(x: 0, y: 0, width: 8, height: 8))
        let bpr = 32
        let p = px
        // The most colourful of the 64 pixels weighs more, so a cover with a bright patch on white isn't grey.
        var r = 0.0, g = 0.0, b = 0.0, w = 0.0
        for y in 0..<8 {
            for x in 0..<8 {
                let i = y * bpr + x * 4
                let pr = Double(p[i]) / 255, pg = Double(p[i + 1]) / 255, pb = Double(p[i + 2]) / 255
                let sat = max(pr, pg, pb) - min(pr, pg, pb)
                let weight = 0.15 + sat * sat * 4
                r += pr * weight; g += pg * weight; b += pb * weight; w += weight
            }
        }
        return UIColor(red: r / w, green: g / w, blue: b / w, alpha: 1)
    }

    /// The first of `urls` already in memory.
    func cached(_ urls: [URL]) -> UIImage? {
        for url in urls { if let i = memory.object(forKey: url as NSURL) { return i } }
        return nil
    }

    /// The first of `urls` that loads.
    func image(_ urls: [URL]) async -> UIImage? {
        for url in urls {
            if let i = await image(url) { return i }
        }
        return nil
    }

    func image(_ url: URL) async -> UIImage? {
        if let i = memory.object(forKey: url as NSURL) { return i }
        if missing.contains(url) { return nil }
        let task = loading[url] ?? {
            // Not a child of the view's task: the view going away doesn't stop it.
            let t = Task { await Self.fetch(url, session: session) }
            loading[url] = t
            return t
        }()
        let image = await task.value
        loading[url] = nil
        if let image { memory.setObject(image, forKey: url as NSURL) } else { missing.insert(url) }
        return image
    }

    /// Through our server first; straight from the host if the server couldn't get it.
    nonisolated private static func fetch(_ url: URL, session: URLSession) async -> UIImage? {
        let proxied = await MainActor.run { API.shared.art(url) }
        for source in proxied == url ? [url] : [proxied, url] {
            guard let (data, response) = try? await session.data(from: source),
                  (response as? HTTPURLResponse).map({ (200..<300).contains($0.statusCode) }) ?? true,
                  let image = UIImage(data: data) else { continue }
            // Covers from feeds can be 3000 px; rows need a few hundred.
            return await image.byPreparingThumbnail(ofSize: fit(image.size, 600)) ?? image
        }
        return nil
    }

    nonisolated private static func fit(_ size: CGSize, _ side: CGFloat) -> CGSize {
        let scale = min(1, side / max(size.width, size.height, 1))
        return CGSize(width: size.width * scale, height: size.height * scale)
    }
}
