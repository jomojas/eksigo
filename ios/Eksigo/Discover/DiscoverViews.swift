import SwiftData
import SwiftUI

/// The Discover tab (design P06): search, your shows, shows for learners, Apple's top shows.
struct DiscoverView: View {
    @Query(sort: \Subscription.subscribedAt) private var subscriptions: [Subscription]
    @State private var top: [Listing] = []
    @State private var searching = false
    private let learners = Directory.forLearners()
    private let feeds = FeedCache.shared

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
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

                if !subscriptions.isEmpty {
                    Block("Your shows") {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(alignment: .top, spacing: 12) {
                                ForEach(subscriptions.compactMap(\.show)) { show in
                                    NavigationLink(value: show) {
                                        VStack(alignment: .leading, spacing: 6) {
                                            Artwork(url: show.artworkUrl, size: 96, radius: 10)
                                            Text(show.title).font(Theme.text(13, .medium)).foregroundStyle(Theme.ink).lineLimit(1)
                                            Text(newCount(show)).font(Theme.text(12)).foregroundStyle(Theme.inkSubtle).lineLimit(1)
                                        }
                                        .frame(width: 96)
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                            .padding(.horizontal, 16)
                        }
                        .padding(.horizontal, -16)
                    }
                }

                Block("For learners") {
                    RowGroup {
                        ForEach(learners) { l in ListingRow(listing: l) }
                    }
                }

                if !top.isEmpty {
                    Block("Top shows · United States") {
                        RowGroup {
                            ForEach(Array(top.prefix(20).enumerated()), id: \.element.id) { i, l in
                                ListingRow(listing: l, rank: i + 1)
                            }
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
        return n > 0 ? "\(n) new" : (show.author ?? "")
    }
}

/// A show in a list, with + to subscribe.
struct ListingRow: View {
    let listing: Listing
    var rank: Int? = nil
    @Environment(\.modelContext) private var context
    @Query private var subscriptions: [Subscription]

    var body: some View {
        if let show = listing.show {
            NavigationLink(value: show) { row }.buttonStyle(.plain)
        } else {
            NavigationLink(value: listing) { row }.buttonStyle(.plain)
        }
    }

    private var row: some View {
        let subscribed = listing.feedUrl.map { url in subscriptions.contains { $0.feedUrl == url.absoluteString } } ?? false
        return Row(title: listing.title, subtitle: listing.note ?? listing.author,
                   leading: {
                       HStack(spacing: 10) {
                           if let rank { Text("\(rank)").font(Theme.mono(13)).foregroundStyle(Theme.inkSubtle).frame(width: 20) }
                           Artwork(url: listing.artworkUrl, size: 44)
                       }
                   },
                   trailing: {
                       if let show = listing.show {
                           RoundButton(symbol: subscribed ? "checkmark" : "plus",
                                       label: subscribed ? "Subscribed to \(listing.title)" : "Subscribe to \(listing.title)") {
                               Store.setSubscribed(show, !subscribed, in: context)
                           }
                       }
                   })
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
                Artwork(url: episode.artwork, size: 64)
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
