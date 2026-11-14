import Foundation

/// Parses a podcast RSS feed on the phone (DESIGN.md section 0: no server involved).
nonisolated final class FeedParser: NSObject, XMLParserDelegate {
    struct Feed: Sendable {
        var show: PodcastShow
        var episodes: [PodcastEpisode]
    }

    /// Off the main thread: a big feed (thousands of episodes) takes a second or more to read.
    @concurrent static func load(_ url: URL) async throws -> Feed {
        let (data, response) = try await URLSession.shared.data(from: url)
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw URLError(.badServerResponse)
        }
        return try parse(data, feedUrl: url)
    }

    static func parse(_ data: Data, feedUrl: URL) throws -> Feed {
        let delegate = FeedParser(feedUrl: feedUrl)
        let parser = XMLParser(data: data)
        parser.delegate = delegate
        parser.shouldProcessNamespaces = false
        guard parser.parse() || !delegate.items.isEmpty else { throw parser.parserError ?? URLError(.cannotParseResponse) }
        let show = PodcastShow(feedUrl: feedUrl, title: delegate.channel["title"] ?? "", author: delegate.channel["itunes:author"],
                               artworkUrl: delegate.channelImage.flatMap(URL.init(string:)),
                               summary: (delegate.channel["itunes:summary"] ?? delegate.channel["description"])?.strippingHTML)
        let episodes = delegate.items.compactMap { item -> PodcastEpisode? in
            guard let audio = item.enclosure.flatMap(URL.init(string:)) else { return nil }
            return PodcastEpisode(
                audioUrl: audio, guid: item.fields["guid"], title: item.fields["title"] ?? "",
                summary: (item.fields["description"] ?? item.fields["itunes:summary"] ?? item.fields["content:encoded"] ?? "").strippingHTML,
                published: item.fields["pubDate"].flatMap(parseDate), duration: item.fields["itunes:duration"].flatMap(parseDuration),
                artworkUrl: item.image.flatMap(URL.init(string:)), showTitle: show.title, showArtworkUrl: show.artworkUrl,
                feedUrl: feedUrl, audioBytes: item.length,
                transcriptUrl: item.transcript.flatMap { URL(string: $0.url) }, transcriptType: item.transcript?.type)
        }
        return Feed(show: show, episodes: episodes)
    }

    static func parseDuration(_ s: String) -> Double? {
        let parts = s.trimmingCharacters(in: .whitespaces).split(separator: ":").compactMap { Double($0) }
        guard !parts.isEmpty else { return nil }
        return parts.reduce(0) { $0 * 60 + $1 }
    }

    /// Made once: a formatter is slow to make, and a feed has a date per episode. Only read from, so shared safely.
    private static let dateFormatters: [DateFormatter] =
        ["EEE, dd MMM yyyy HH:mm:ss Z", "EEE, dd MMM yyyy HH:mm:ss zzz", "dd MMM yyyy HH:mm:ss Z", "EEE, dd MMM yyyy HH:mm Z"].map {
            let f = DateFormatter()
            f.locale = Locale(identifier: "en_US_POSIX")
            f.dateFormat = $0
            return f
        }

    static func parseDate(_ s: String) -> Date? {
        let s = s.trimmingCharacters(in: .whitespaces)
        for f in dateFormatters { if let d = f.date(from: s) { return d } }
        return nil
    }

    // MARK: XMLParserDelegate

    private struct Item {
        var fields: [String: String] = [:]
        var enclosure: String?
        var length: Int64?
        var image: String?
        var transcript: (url: String, type: String)?
    }

    /// Of several podcast:transcript links, the one with timings first.
    private static func rank(_ type: String) -> Int {
        ["json", "srt", "vtt", "html", "plain"].firstIndex { type.contains($0) } ?? 5
    }

    private let feedUrl: URL
    private var channel: [String: String] = [:]
    private var channelImage: String?
    private var items: [Item] = []
    private var current: Item?
    private var text = ""
    private var path: [String] = []

    private init(feedUrl: URL) { self.feedUrl = feedUrl }

    func parser(_ parser: XMLParser, didStartElement name: String, namespaceURI: String?, qualifiedName: String?,
                attributes: [String: String] = [:]) {
        path.append(name)
        text = ""
        switch name {
        case "item": current = Item()
        case "enclosure":
            current?.enclosure = attributes["url"]
            current?.length = attributes["length"].flatMap { Int64($0) }
        case "podcast:transcript":
            if let url = attributes["url"] {
                let type = attributes["type"]?.lowercased() ?? ""
                if current?.transcript.map({ Self.rank(type) < Self.rank($0.type) }) ?? true { current?.transcript = (url, type) }
            }
        case "itunes:image":
            if current != nil { current?.image = attributes["href"] } else if channelImage == nil { channelImage = attributes["href"] }
        default: break
        }
    }

    func parser(_ parser: XMLParser, foundCharacters string: String) { text += string }

    func parser(_ parser: XMLParser, foundCDATA CDATABlock: Data) { text += String(decoding: CDATABlock, as: UTF8.self) }

    func parser(_ parser: XMLParser, didEndElement name: String, namespaceURI: String?, qualifiedName: String?) {
        let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if name == "item", let item = current {
            items.append(item)
            current = nil
        } else if current != nil {
            if !value.isEmpty, current?.fields[name] == nil { current?.fields[name] = value }
        } else if path.count == 3, !value.isEmpty, channel[name] == nil {
            channel[name] = value  // rss > channel > field
        } else if name == "url", path.suffix(2).first == "image", channelImage == nil {
            channelImage = value
        }
        path.removeLast()
        text = ""
    }
}
