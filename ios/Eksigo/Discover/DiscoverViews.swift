import SwiftData
import SwiftUI

/// The Discover tab (design P23): search, your shows, then short rows to swipe sideways (for learners, Apple's top
/// shows) and topics. The long lists are a tap away.
struct DiscoverView: View {
    @Query(sort: \Subscription.subscribedAt) private var subscriptions: [Subscription]
    @State private var top: [Listing] = []
    @State private var searching = false
    private let learners = Directory.forLearners()
    private let feeds = FeedCache.shared

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                VStack(alignment: .leading, spacing: 16) {
                    LargeTitle("Discover")
                    Button { searching = true } label: {
                        HStack(spacing: 8) {
                            Image(systemName: "magnifyingglass")
                            Text("Shows, episodes or an RSS link")
                            Spacer()
                        }
                        .font(Theme.text(15)).foregroundStyle(Theme.inkSubtle)
                        .padding(.horizontal, 12).frame(height: 40)
                        .background(Theme.surface2, in: RoundedRectangle(cornerRadius: 10))
                        .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Theme.hairline))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Search")
                }

                if !subscriptions.isEmpty {
                    Block("Your shows") {
                        Shelf(spacing: 12) {
                            ForEach(subscriptions.compactMap(\.show)) { show in
                                NavigationLink(value: show) {
                                    VStack(alignment: .leading, spacing: 5) {
                                        Artwork(url: show.artworkUrl, size: 72, radius: 10)
                                        Text(show.title).font(Theme.text(12, .medium)).foregroundStyle(Theme.ink).lineLimit(1)
                                        let n = newCount(show)
                                        if !n.isEmpty { Text(n).font(Theme.text(11)).foregroundStyle(Theme.inkSubtle).lineLimit(1) }
                                    }
                                    .frame(width: 72)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                }

                Block("For learners", trailing: { NavigationLink("See all", value: Route.forLearners) }) {
                    Shelf(spacing: 12) {
                        ForEach(learners) { l in
                            ListingTile(listing: l, size: 148)
                        }
                    }
                }

                Block("Top shows", trailing: { NavigationLink("See all", value: Route.topShows(nil)) }) {
                    if top.isEmpty {
                        HStack { Spacer(); ProgressView(); Spacer() }.frame(height: 192)
                    } else {
                        ChartColumns(listings: Array(top.prefix(12)))
                    }
                }

                Block("Browse by topic") {
                    LazyVGrid(columns: [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)], spacing: 8) {
                        ForEach(Directory.topics) { t in
                            NavigationLink(value: Route.topShows(t.id)) {
                                HStack(spacing: 10) {
                                    Image(systemName: t.symbol).font(.system(size: 15)).foregroundStyle(Theme.inkSubtle).frame(width: 20)
                                    Text(t.name).font(Theme.text(14, .medium)).foregroundStyle(Theme.ink).lineLimit(1).minimumScaleFactor(0.85)
                                    Spacer(minLength: 0)
                                }
                                .padding(.horizontal, 12).frame(height: 52)
                                .background(Theme.surface1, in: RoundedRectangle(cornerRadius: 10))
                                .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Theme.hairline))
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
            .padding(.horizontal, 16).padding(.top, 8).padding(.bottom, 24)
        }
        .canvas()
        .toolbar(.hidden, for: .navigationBar)
        .navigationDestination(isPresented: $searching) { SearchView() }
        .task {
            if top.isEmpty { top = (try? await Directory.top()) ?? [] }
            await feeds.load(subscriptions.compactMap { URL(string: $0.feedUrl) })
        }
    }

    /// "2 new" this week.
    private func newCount(_ show: PodcastShow) -> String {
        let week = Date.now.addingTimeInterval(-7 * 86400)
        let n = feeds.feed(show.feedUrl)?.episodes.filter { ($0.published ?? .distantPast) > week }.count ?? 0
        return n > 0 ? "\(n) new" : ""
    }
}

/// A row that scrolls sideways, to the screen's edges.
struct Shelf<Content: View>: View {
    var spacing: CGFloat = 12
    @ViewBuilder var content: Content
    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            LazyHStack(alignment: .top, spacing: spacing) { content }
                .scrollTargetLayout()
                .padding(.horizontal, 16)
        }
        .scrollTargetBehavior(.viewAligned)
        .padding(.horizontal, -16)
    }
}

/// A show as a cover with its name under it.
struct ListingTile: View {
    let listing: Listing
    var size: CGFloat? = nil

    var body: some View {
        link {
            VStack(alignment: .leading, spacing: 6) {
                if let size {
                    Artwork(url: listing.artworkUrl, size: size, radius: 12)
                } else {
                    Color.clear.aspectRatio(1, contentMode: .fit)
                        .overlay { GeometryReader { g in Artwork(url: listing.artworkUrl, size: g.size.width, radius: 12) } }
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(listing.title).font(Theme.text(14, .medium)).foregroundStyle(Theme.ink).lineLimit(1)
                    Text(listing.note ?? listing.author).font(Theme.text(12)).foregroundStyle(Theme.inkSubtle).lineLimit(1)
                }
            }
            .frame(width: size)
            .contentShape(Rectangle())
        }
    }

    @ViewBuilder private func link<L: View>(@ViewBuilder _ label: () -> L) -> some View {
        if let show = listing.show {
            NavigationLink(value: show, label: label).buttonStyle(.plain)
        } else {
            NavigationLink(value: listing, label: label).buttonStyle(.plain)
        }
    }
}

/// Top shows three to a column, columns side by side: swipe for the next three.
private struct ChartColumns: View {
    let listings: [Listing]

    var body: some View {
        let columns = stride(from: 0, to: listings.count, by: 3).map { Array(listings[$0..<min($0 + 3, listings.count)]) }
        ScrollView(.horizontal, showsIndicators: false) {
            LazyHStack(alignment: .top, spacing: 16) {
                ForEach(Array(columns.enumerated()), id: \.offset) { c, column in
                    VStack(spacing: 0) {
                        ForEach(Array(column.enumerated()), id: \.offset) { r, item in
                            ChartRow(listing: item, rank: c * 3 + r + 1)
                            if r < column.count - 1 { Rectangle().fill(Theme.hairline).frame(height: 1).padding(.leading, 64) }
                        }
                    }
                    .containerRelativeFrame(.horizontal) { w, _ in w - 32 - 40 }
                }
            }
            .scrollTargetLayout()
            .padding(.horizontal, 16)
        }
        .scrollTargetBehavior(.viewAligned)
        .padding(.horizontal, -16)
    }
}

private struct ChartRow: View {
    let listing: Listing
    let rank: Int

    var body: some View {
        NavigationLink(value: listing) {
            HStack(spacing: 12) {
                Artwork(url: listing.artworkUrl, size: 52)
                Text("\(rank)").font(Theme.mono(13)).foregroundStyle(Theme.inkSubtle).frame(width: 18, alignment: .leading)
                VStack(alignment: .leading, spacing: 2) {
                    Text(listing.title).font(Theme.text(15, .medium)).foregroundStyle(Theme.ink).lineLimit(1)
                    Text(listing.author).font(Theme.text(13)).foregroundStyle(Theme.inkSubtle).lineLimit(1)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(height: 64)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

/// For learners, all of it (design P25): a grid of covers.
struct ForLearnersView: View {
    private let learners = Directory.forLearners()

    var body: some View {
        Page(title: "For learners") {
            Text("Shows made for people learning English: clear voices, a gentler pace.")
                .font(Theme.text(14)).lineSpacing(3).foregroundStyle(Theme.inkSubtle).padding(.horizontal, 4)
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)], spacing: 18) {
                ForEach(learners) { ListingTile(listing: $0) }
            }
        }
    }
}

/// Apple's top shows, all or one topic (design P24), each with + to subscribe.
struct TopShowsView: View {
    @State var genre: Int?
    @State private var shows: [Listing] = []
    @State private var error: String?

    var body: some View {
        Page(title: "Top shows") {
            ChipRow(items: [(Int?.none, "All")] + Directory.topics.map { (Int?.some($0.id), $0.name) }, selection: $genre)
            Note("Apple Podcasts chart · United States")
            if let error {
                Note(error)
            } else if shows.isEmpty {
                HStack { Spacer(); ProgressView(); Spacer() }.padding(.vertical, 30)
            } else {
                RowGroup {
                    ForEach(Array(shows.enumerated()), id: \.element.id) { i, l in ListingRow(listing: l, rank: i + 1) }
                }
            }
        }
        .task(id: genre) {
            shows = []
            error = nil
            do { shows = try await Directory.top(genre: genre) } catch { self.error = "Couldn't load the chart: \(error.localizedDescription)" }
        }
    }
}

/// A show in a list, with + to subscribe (a chart show is looked up first: Apple's charts give no feed).
struct ListingRow: View {
    let listing: Listing
    var rank: Int? = nil
    @Environment(\.modelContext) private var context
    @Query private var subscriptions: [Subscription]
    @State private var working = false

    var body: some View {
        if let show = listing.show {
            NavigationLink(value: show) { row }.buttonStyle(.plain)
        } else {
            NavigationLink(value: listing) { row }.buttonStyle(.plain)
        }
    }

    private var feedUrl: URL? { listing.feedUrl ?? listing.appleId.flatMap { Directory.looked[$0]?.feedUrl } }

    private var row: some View {
        let subscribed = feedUrl.map { url in subscriptions.contains { $0.feedUrl == url.absoluteString } } ?? false
        return Row(title: listing.title, subtitle: listing.note ?? listing.author,
                   leading: {
                       HStack(spacing: 10) {
                           if let rank { Text("\(rank)").font(Theme.mono(13)).foregroundStyle(Theme.inkSubtle).frame(width: 20) }
                           Artwork(url: listing.artworkUrl, size: 48)
                       }
                   },
                   trailing: {
                       if working {
                           ProgressView().frame(width: 44, height: 44)
                       } else {
                           RoundButton(symbol: subscribed ? "checkmark" : "plus",
                                       label: subscribed ? "Subscribed to \(listing.title)" : "Subscribe to \(listing.title)") {
                               Task { await toggle(subscribed) }
                           }
                       }
                   })
    }

    private func toggle(_ subscribed: Bool) async {
        if let show = listing.show {
            Store.setSubscribed(show, !subscribed, in: context)
            return
        }
        guard let id = listing.appleId else { return }
        working = true
        defer { working = false }
        guard let show = try? await Directory.lookupCached(id) else { return }
        Store.setSubscribed(show, !subscribed, in: context)
    }
}

/// A chart show has no feed until Apple's directory is asked.
struct ShowLoader: View {
    let listing: Listing
    @State private var show: PodcastShow?
    @State private var error: String?

    var body: some View {
        Group {
            if let show {
                ShowView(show: show)
            } else if let error {
                Page(title: listing.title) { Note(error) }
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity).canvas()
            }
        }
        .task {
            guard show == nil, let id = listing.appleId else { return }
            do { show = try await Directory.lookup(id) } catch { self.error = error.localizedDescription }
        }
    }
}

/// Search (design P07): Apple's directory, shows or episodes; an RSS link opens that feed.
struct SearchView: View {
    @State private var text = ""
    @State private var kind = 0
    @State private var shows: [PodcastShow] = []
    @State private var episodes: [PodcastEpisode] = []
    @State private var loading = false
    @State private var error: String?
    @FocusState private var focused: Bool
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(spacing: 10) {
                HStack(spacing: 8) {
                    Image(systemName: "magnifyingglass").foregroundStyle(Theme.inkSubtle)
                    TextField("Shows, episodes or an RSS link", text: $text)
                        .focused($focused).submitLabel(.search).autocorrectionDisabled().textInputAutocapitalization(.never)
                        .foregroundStyle(Theme.ink)
                        .onSubmit { Task { await search() } }
                }
                .font(Theme.text(15))
                .padding(.horizontal, 12).frame(height: 40)
                .background(Theme.surface2, in: RoundedRectangle(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Theme.hairline))
                Button("Cancel") { dismiss() }.font(Theme.text(15)).foregroundStyle(Theme.ink)
            }
            Segmented(items: [(0, "Shows"), (1, "Episodes")], selection: $kind, label: "Search for")
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    if loading { HStack { Spacer(); ProgressView(); Spacer() }.padding(.top, 20) }
                    if let error { Note(error) }
                    if kind == 0, !shows.isEmpty {
                        RowGroup {
                            ForEach(shows) { s in
                                NavigationLink(value: s) {
                                    Row(title: s.title, subtitle: [s.author, s.genre].compactMap { $0 }.joined(separator: " · "), chevron: true,
                                        leading: { Artwork(url: s.artworkUrl, size: 52) }, trailing: { EmptyView() })
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                    if kind == 1, !episodes.isEmpty {
                        RowGroup { ForEach(episodes) { EpisodeRow(episode: $0, showArt: true) } }
                    }
                    Note("Paste an RSS link to add a show that isn't listed.")
                }
                .padding(.bottom, 40)
            }
        }
        .padding(.horizontal, 16).padding(.top, 8)
        .canvas()
        .toolbar(.hidden, for: .navigationBar)
        .onAppear { focused = true }
        .onChange(of: kind) { Task { await search() } }
    }

    private func search() async {
        let term = text.trimmingCharacters(in: .whitespaces)
        guard !term.isEmpty else { return }
        loading = true
        error = nil
        defer { loading = false }
        do {
            if let url = URL(string: term), url.scheme?.hasPrefix("http") == true {
                let feed = try await FeedCache.shared.load(url)
                shows = [feed.show]
                episodes = feed.episodes
            } else if kind == 0 {
                shows = try await ApplePodcasts.searchShows(term)
                if shows.isEmpty { error = "No shows found for “\(term)”." }
            } else {
                episodes = try await ApplePodcasts.searchEpisodes(term)
                if episodes.isEmpty { error = "No episodes found for “\(term)”." }
            }
        } catch {
            self.error = "Couldn't search: \(error.localizedDescription)"
        }
    }
}

/// A show (design P08): subscribe, its episodes.
struct ShowView: View {
    let show: PodcastShow
    @Environment(\.modelContext) private var context
    @Query private var subscriptions: [Subscription]
    @State private var feed: FeedParser.Feed?
    @State private var error: String?
    @State private var newestFirst = true
    @State private var expanded = false

    var body: some View {
        let subscribed = subscriptions.contains { $0.feedUrl == show.feedUrl.absoluteString }
        let current = feed?.show ?? show
        Page {
            HStack(alignment: .bottom, spacing: 16) {
                Artwork(url: current.artworkUrl ?? show.artworkUrl, size: 120, radius: 12)
                VStack(alignment: .leading, spacing: 6) {
                    Text(current.title.isEmpty ? show.title : current.title).font(Theme.display(22)).tracking(-0.4).foregroundStyle(Theme.ink)
                        .lineLimit(3)
                    if let a = current.author ?? show.author { Text(a).font(Theme.text(14)).foregroundStyle(Theme.inkSubtle).lineLimit(1) }
                    Button {
                        Store.setSubscribed(current.artworkUrl == nil ? show : current, !subscribed, in: context)
                    } label: {
                        Label(subscribed ? "Subscribed" : "Subscribe", systemImage: subscribed ? "checkmark" : "plus")
                    }
                    .buttonStyle(.eks(subscribed ? .secondary : .primary, small: true))
                    .padding(.top, 4)
                }
            }
            if let summary = current.summary ?? show.summary, !summary.isEmpty {
                Text(summary).font(Theme.text(14)).lineSpacing(3).foregroundStyle(Theme.inkSubtle)
                    .lineLimit(expanded ? nil : 3)
                    .onTapGesture { expanded.toggle() }
            }
            Block("Episodes", trailing: {
                Button(newestFirst ? "Newest first" : "Oldest first") { newestFirst.toggle() }
            }) {
                if let feed {
                    RowGroup {
                        ForEach(newestFirst ? feed.episodes : feed.episodes.reversed()) { EpisodeRow(episode: $0) }
                    }
                } else if let error {
                    Note(error)
                } else {
                    HStack { Spacer(); ProgressView(); Spacer() }.padding(.vertical, 20)
                }
            }
        }
        .task {
            do { feed = try await FeedCache.shared.load(show.feedUrl) } catch { self.error = "Couldn't read this show's feed: \(error.localizedDescription)" }
        }
    }
}

/// An episode (design P09): play, download, and how its dictation went on the computer.
struct EpisodeView: View {
    let episode: PodcastEpisode
    @Environment(PlaybackCenter.self) private var center
    @Environment(RecordStore.self) private var store
    @Environment(AppUI.self) private var ui
    @State private var expanded = false

    var body: some View {
        let missed = store.missed.filter { $0.ref.key == episode.key }.sorted { $0.idx < $1.idx }
        let practice = store.practices.first { $0.ref.key == episode.key }
        Page {
            HStack(spacing: 14) {
                Artwork(episode: episode, size: 64)
                VStack(alignment: .leading, spacing: 4) {
                    Text([episode.showTitle, episode.published?.formatted(.dateTime.day().month(.abbreviated))].compactMap { $0 }.joined(separator: " · "))
                        .font(Theme.text(12, .medium)).foregroundStyle(Theme.inkSubtle).lineLimit(1)
                    Text(episode.title).font(Theme.display(20)).tracking(-0.3).foregroundStyle(Theme.ink)
                }
            }
            HStack(spacing: 8) {
                Button { center.play(episode) } label: {
                    Label(center.episode?.key == episode.key && center.isPlaying ? "Playing" : "Play\(episode.duration.map { " · \(Stats.length($0))" } ?? "")",
                          systemImage: "play.fill")
                }
                .buttonStyle(.eks(.primary, block: true))
                upNextButton
                downloadButton
            }
            if let practice {
                Block("Dictated on your computer") {
                    Cells(items: [("\(Int((Double(practice.accuracy) / 10).rounded()))%", "Words right"),
                                  ("\(missed.count)", "Missed"),
                                  (Stats.short(practice.seconds), relativeDay(Date(timeIntervalSince1970: TimeInterval(practice.updatedAt))).capFirst)])
                    if !missed.isEmpty {
                        let playable = missed.filter(center.playable)
                        Button {
                            center.startMissed(missed)
                            ui.showMissed = true
                        } label: {
                            RowGroup {
                                Row(title: "Play the \(missed.count) missed sentence\(missed.count == 1 ? "" : "s")",
                                    subtitle: playable.isEmpty ? "This phone's copy isn't the computer's file: text only" : "The same file as on the computer",
                                    chevron: true, leading: { IconTile("headphones") }, trailing: { EmptyView() })
                            }
                        }
                        .buttonStyle(.plain)
                        .disabled(playable.isEmpty)
                    }
                }
            }
            if !episode.summary.isEmpty {
                Block("About this episode") {
                    Text(episode.summary).font(Theme.text(14)).lineSpacing(4).foregroundStyle(Theme.inkSubtle)
                        .lineLimit(expanded ? nil : 8).padding(.horizontal, 4)
                        .onTapGesture { expanded.toggle() }
                }
            }
        }
    }

    /// Adds to Up Next (a check once it's there; a tap then takes it out).
    @ViewBuilder private var upNextButton: some View {
        let queued = center.isQueued(episode)
        Button {
            if queued { center.removeFromQueue(episode.key) } else { ui.addToUpNext(episode, center: center) }
        } label: {
            Image(systemName: queued ? "checkmark" : "text.badge.plus")
        }
        .buttonStyle(.eks(.secondary))
        .disabled(center.episode?.key == episode.key && center.mode == .episode)
        .accessibilityLabel(queued ? "In Up Next. Remove" : "Add to Up Next")
    }

    @ViewBuilder private var downloadButton: some View {
        if let p = center.downloading[episode.key] {
            Button {} label: { Label("\(Int(p * 100))%", systemImage: "arrow.down") }
                .buttonStyle(.eks(.secondary)).disabled(true)
        } else if center.isDownloaded(episode) {
            Menu {
                Button("Remove download", systemImage: "trash", role: .destructive) { center.deleteDownload(episode) }
            } label: {
                Label(sizeText, systemImage: "checkmark").font(Theme.text(15, .medium)).foregroundStyle(Theme.inkSubtle)
                    .padding(.horizontal, 16).frame(height: 44)
                    .background(Theme.surface2, in: RoundedRectangle(cornerRadius: 8))
                    .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Theme.hairlineStrong))
            }
            .accessibilityLabel("Downloaded")
        } else {
            Button { center.download(episode) } label: { Image(systemName: "arrow.down.to.line") }
                .buttonStyle(.eks(.secondary))
                .accessibilityLabel("Download")
        }
    }

    private var sizeText: String {
        let bytes = center.downloads().first { $0.key == episode.key }?.fileBytes ?? episode.audioBytes ?? 0
        return bytes > 0 ? ByteCountFormatter.string(fromByteCount: bytes, countStyle: .file) : "Downloaded"
    }
}
