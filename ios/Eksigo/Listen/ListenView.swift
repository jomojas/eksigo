import SwiftData
import SwiftUI

/// The Listen tab (design P26): the episode to continue, Up Next, new episodes. The missed sentences are in Review.
struct ListenView: View {
    @Environment(PlaybackCenter.self) private var center
    @Environment(AppUI.self) private var ui
    @Query(filter: #Predicate<EpisodeRecord> { $0.lastPlayedAt != nil }, sort: \EpisodeRecord.lastPlayedAt, order: .reverse)
    private var recent: [EpisodeRecord]
    @Query(sort: \Subscription.subscribedAt) private var subscriptions: [Subscription]
    private let feeds = FeedCache.shared

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                if let r = continuing, let e = r.episode {
                    Block("Continue") { ContinueCard(record: r, episode: e) }
                }
                upNext
                newEpisodes
            }
            .padding(.horizontal, 16).padding(.top, 4).padding(.bottom, 24)
        }
        .canvas()
        .navigationTitle("Listen")
        // The title in the bar's own row, not a row below it: less empty space at the top.
        .toolbarTitleDisplayMode(.inlineLarge)
        .toolbar { ToolbarItem(placement: .topBarTrailing) { SyncBadge() } }
        .refreshable {
            await feeds.load(subscriptions.compactMap { URL(string: $0.feedUrl) })
        }
        .task(id: subscriptions.count) {
            await feeds.load(subscriptions.compactMap { URL(string: $0.feedUrl) })
        }
    }

    /// The last episode left in the middle.
    private var continuing: EpisodeRecord? {
        // The same one while it plays (the card turns into its pause button), so a tap doesn't swap it for another.
        recent.first { r in
            (r.key == center.episode?.key && center.position > 30) || (!r.played && r.position > 30 && r.progress < 0.98)
        }
    }

    /// The next three in Up Next; the rest on its page.
    @ViewBuilder private var upNext: some View {
        if !center.queue.isEmpty {
            Block("Up Next", trailing: { NavigationLink("See All", value: Route.upNext) }) {
                Shelf(spacing: 12) {
                    ForEach(center.queue) { e in
                        NavigationLink(value: e) {
                            CoverTile(episode: e, size: 150,
                                      subtitle: [e.showTitle, e.duration.map(Stats.length)].compactMap { $0 }.joined(separator: " · "))
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    @ViewBuilder private var newEpisodes: some View {
        let urls = subscriptions.compactMap { URL(string: $0.feedUrl) }
        if urls.isEmpty {
            Block("Shows for learners", trailing: { Button("Discover") { ui.tab = .discover } }) {
                RowGroup {
                    ForEach(Directory.forLearners().prefix(3)) { l in
                        if let show = l.show {
                            NavigationLink(value: show) {
                                Row(title: l.title, subtitle: l.note ?? l.author, chevron: true, leading: { Artwork(url: l.artworkUrl, size: 44) }, trailing: { EmptyView() })
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
        } else {
            let episodes = feeds.newest(urls, limit: 5)
            Block("New from your shows", trailing: { Button("Discover") { ui.tab = .discover } }) {
                if episodes.isEmpty {
                    HStack { Spacer(); ProgressView(); Spacer() }.padding(.vertical, 20)
                } else {
                    PlainRows {
                        ForEach(episodes) { e in EpisodeRow(episode: e, showArt: true, swipe: true, plain: true) }
                    }
                    .padding(.horizontal, -16)
                    Note("Swipe an episode left to add it to Up Next or download it.")
                }
            }
        }
    }
}

/// "Synced", "Syncing", "Not synced": only when signed in.
struct SyncBadge: View {
    @Environment(Syncer.self) private var syncer
    @Environment(Account.self) private var account

    var body: some View {
        if account.isSignedIn {
            Badge {
                switch syncer.shown {
                case .syncing:
                    ProgressView().controlSize(.mini)
                    Text("Syncing")
                case .failed:
                    Dot(color: Theme.error)
                    Text("Not synced")
                default:
                    Dot(color: Theme.success)
                    Text("Synced")
                }
            }
            .accessibilityElement(children: .combine)
        }
    }
}

/// The episode left in the middle: a big cover, its title, and how much is left.
private struct ContinueCard: View {
    let record: EpisodeRecord
    let episode: PodcastEpisode
    @Environment(PlaybackCenter.self) private var center

    var body: some View {
        let current = center.episode?.key == record.key
        let position = current ? center.position : record.position
        let left = Stats.length(max(60, record.duration - position))
        let playing = current && center.isPlaying
        NavigationLink(value: episode) {
            HStack(spacing: 14) {
                Artwork(episode: episode, size: 96, radius: 12)
                VStack(alignment: .leading, spacing: 2) {
                    Text(episode.showTitle.uppercased()).font(Theme.text(12, .semibold)).tracking(0.2)
                        .foregroundStyle(Theme.inkSubtle).lineLimit(1)
                    Text(episode.title).font(Theme.text(17, .semibold)).foregroundStyle(Theme.ink).lineLimit(2)
                        .multilineTextAlignment(.leading)
                    HStack(spacing: 10) {
                        Button { current ? center.togglePlayPause() : center.play(episode) } label: {
                            Label(L("%@ left", left), systemImage: playing ? "pause.fill" : "play.fill").font(Theme.text(14, .semibold))
                        }
                        .buttonStyle(.eks(.secondary, small: true, height: 32))
                        .accessibilityLabel(L(playing ? "Pause, %@ left" : "Resume, %@ left", left))
                        Track(value: record.duration > 0 ? min(1, position / record.duration) : 0)
                    }
                    .padding(.top, 8)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

/// Rows straight on the page (no grey box), a hairline between them from the text on.
struct PlainRows<Content: View>: View {
    @ViewBuilder var content: Content
    var body: some View {
        VStack(spacing: 0) {
            Group(subviews: content) { rows in
                ForEach(Array(rows.enumerated()), id: \.offset) { i, row in
                    row
                    if i < rows.count - 1 { Rectangle().fill(Theme.hairline).frame(height: 0.5).padding(.leading, 84) }
                }
            }
        }
    }
}

/// An episode in a list: a tap opens it; play, or a check once played.
struct EpisodeRow: View {
    let episode: PodcastEpisode
    var showArt = false
    /// Swipe left for Up Next and Download.
    var swipe = false
    /// Straight on the page rather than in a grey group.
    var plain = false
    @Query private var records: [EpisodeRecord]

    init(episode: PodcastEpisode, showArt: Bool = false, swipe: Bool = false, plain: Bool = false) {
        self.episode = episode
        self.showArt = showArt
        self.swipe = swipe
        self.plain = plain
        let key = episode.key
        _records = Query(filter: #Predicate<EpisodeRecord> { $0.key == key })
    }

    var body: some View {
        EpisodeRowContent(episode: episode, record: records.first, showArt: showArt, swipe: swipe, plain: plain)
    }
}

/// An episode row whose record the caller already has (a show's long list looks them all up at once).
struct EpisodeRowContent: View {
    let episode: PodcastEpisode
    let record: EpisodeRecord?
    var showArt = false
    var swipe = false
    var plain = false
    @Environment(PlaybackCenter.self) private var center
    @Environment(AppUI.self) private var ui

    var body: some View {
        if swipe {
            Swipeable(actions: swipeActions, background: plain ? Theme.canvas : Theme.surface1) { link }
        } else {
            link
        }
    }

    private var swipeActions: [SwipeAction] {
        var list: [SwipeAction] = []
        if center.isQueued(episode) {
            list.append(SwipeAction(title: "Remove", symbol: "text.badge.minus") { center.removeFromQueue(episode.key) })
        } else if center.episode?.key != episode.key {
            list.append(SwipeAction(title: "Up Next", symbol: "text.badge.plus") { ui.addToUpNext(episode, center: center) })
        }
        if !center.isDownloaded(episode), center.downloading[episode.key] == nil {
            list.append(SwipeAction(title: "Download", symbol: "arrow.down", background: Color(uiColor: .systemBlue), foreground: .white) { center.download(episode) })
        }
        return list
    }

    private var link: some View {
        NavigationLink(value: episode) {
            Row(title: episode.title, subtitle: subtitle(record),
                leading: { if showArt { Artwork(episode: episode, size: plain ? 56 : 44) } },
                trailing: { trailing(record) })
        }
        .buttonStyle(.plain)
        .contextMenu(swipe ? nil : ContextMenu {
            Button("Play", systemImage: "play") { center.play(episode) }
            if center.isQueued(episode) {
                Button("Remove from Up Next", systemImage: "text.badge.minus") { center.removeFromQueue(episode.key) }
            } else if center.episode?.key != episode.key {
                Button("Add to Up Next", systemImage: "text.badge.plus") { ui.addToUpNext(episode, center: center) }
            }
            if center.isDownloaded(episode) {
                Button("Remove download", systemImage: "trash", role: .destructive) { center.deleteDownload(episode) }
            } else {
                Button("Download", systemImage: "arrow.down.circle") { center.download(episode) }
            }
        })
    }

    private func subtitle(_ r: EpisodeRecord?) -> String {
        var parts: [String] = []
        if showArt { parts.append(episode.showTitle) }
        if !showArt, let d = episode.published { parts.append(d.formatted(Date.FormatStyle(locale: AppLanguage.locale).day().month(.abbreviated))) }
        if let d = episode.duration, d > 0 { parts.append(Stats.length(d)) }
        if r?.played == true { parts.append(L("played")) }
        else if let r, r.position > 30, r.duration > 0 { parts.append(L("%@ left", Stats.length(r.duration - r.position))) }
        else if showArt, let d = episode.published { parts.append(relativeDay(d)) }
        return parts.joined(separator: " · ")
    }

    @ViewBuilder private func trailing(_ r: EpisodeRecord?) -> some View {
        if let p = center.downloading[episode.key] {
            ProgressView(value: p).progressViewStyle(.circular).frame(width: 44, height: 44)
                .accessibilityLabel("Downloading")
        } else if r?.played == true {
            Image(systemName: "checkmark").font(.system(size: 16, weight: .medium)).foregroundStyle(Theme.inkSubtle)
                .frame(width: 44, height: 44).accessibilityLabel("Played")
        } else {
            RoundButton(symbol: "play.fill", label: L("Play %@", episode.title)) { center.play(episode) }
        }
    }
}

func relativeDay(_ date: Date) -> String {
    if Calendar.current.isDateInToday(date) { return L("today") }
    if Calendar.current.isDateInYesterday(date) { return L("yesterday") }
    return date.formatted(Date.FormatStyle(locale: AppLanguage.locale).day().month(.abbreviated))
}
