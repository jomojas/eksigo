import SwiftData
import SwiftUI

/// The Listen tab (design P26, P10): last night's missed sentences, the episode to continue, Up Next, new episodes.
struct ListenView: View {
    @Environment(RecordStore.self) private var store
    @Environment(Account.self) private var account
    @Environment(PlaybackCenter.self) private var center
    @Environment(AppUI.self) private var ui
    @Query(filter: #Predicate<EpisodeRecord> { $0.lastPlayedAt != nil }, sort: \EpisodeRecord.lastPlayedAt, order: .reverse)
    private var recent: [EpisodeRecord]
    @Query(sort: \Subscription.subscribedAt) private var subscriptions: [Subscription]
    private let feeds = FeedCache.shared

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                if !store.missed.isEmpty {
                    MissedCard()
                } else {
                    EmptyMissedCard()
                }
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
        recent.first { r in
            !r.played && r.position > 30 && r.progress < 0.98 && !(r.key == center.episode?.key && center.isPlaying)
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
                        .contextMenu {
                            Button("Play now", systemImage: "play") { center.play(e) }
                            Button("Remove from Up Next", systemImage: "text.badge.minus", role: .destructive) { center.removeFromQueue(e.key) }
                        }
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

/// The missed sentences waiting from the computer: one line and Play; a tap on the text opens the list.
private struct MissedCard: View {
    @Environment(RecordStore.self) private var store
    @Environment(PlaybackCenter.self) private var center
    @Environment(AppSettings.self) private var settings
    @Environment(AppUI.self) private var ui

    var body: some View {
        let groups = MissedGroup.groups(store.missed)
        let all = groups.flatMap(\.items)
        let playable = all.filter(center.playable)
        let seconds = playable.reduce(0) { $0 + $1.seconds * Double(settings.repeats) + settings.gap * Double(settings.repeats) }
        VStack(alignment: .leading, spacing: 14) {
            NavigationLink(value: Route.missedList) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(MissedGroup.when(groups.first?.latest ?? 0).uppercased())
                        .font(Theme.text(12, .semibold)).tracking(0.3).foregroundStyle(.white.opacity(0.8))
                    Text("\(plural(all.count, "sentence")) you missed").font(Theme.display(22)).foregroundStyle(.white)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityHint("Shows them all")
            HStack {
                Text(summary(minutes: Int((seconds / 60).rounded(.up)), textOnly: all.count - playable.count))
                    .font(Theme.text(15)).foregroundStyle(.white.opacity(0.85)).lineLimit(2)
                Spacer(minLength: 12)
                Button {
                    center.startMissed(all)
                    ui.showMissed = true
                } label: {
                    Label("Play", systemImage: "play.fill").font(Theme.text(15, .semibold))
                        .foregroundStyle(Theme.missedInk)
                        .padding(.horizontal, 16).frame(height: 36)
                        .background(.white, in: Capsule())
                }
                .buttonStyle(.plain)
                .disabled(playable.isEmpty)
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background {
            ZStack(alignment: .topTrailing) {
                Theme.missedGradient
                Circle().fill(.white.opacity(0.12)).frame(width: 130, height: 130).offset(x: 24, y: -24)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: Theme.radius, style: .continuous))
    }

    private func summary(minutes: Int, textOnly: Int) -> String {
        var s = "About \(max(1, minutes)) min"
        if textOnly > 0 { s += " · \(textOnly) as text only" }
        return s
    }
}

/// Signed out, or nothing missed yet (design P10).
private struct EmptyMissedCard: View {
    @Environment(Account.self) private var account
    @Environment(\.openURL) private var openURL

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            IconTile("laptopcomputer", color: Theme.primary)
            Text(account.isSignedIn ? "Nothing missed yet" : "Your missed sentences play here")
                .font(Theme.display(20)).foregroundStyle(Theme.ink)
            Text(account.isSignedIn
                 ? "Dictate an episode on your computer. The sentences you miss come over by themselves, ready for the commute."
                 : "Dictate an episode on your computer, then sign in with the same account here. The sentences you missed come over by themselves, ready for the commute.")
                .font(Theme.text(15)).lineSpacing(2).foregroundStyle(Theme.inkSubtle)
            HStack(spacing: 8) {
                if !account.isSignedIn {
                    NavigationLink(value: Route.account) { Text("Sign in") }.buttonStyle(.eks(.primary, small: true))
                }
                Button("Get the desktop app") { openURL(URL(string: "https://eksigo.com")!) }.buttonStyle(.eks(.ghost, small: true))
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.primarySoft, in: RoundedRectangle(cornerRadius: Theme.radius, style: .continuous))
    }
}

/// The episode left in the middle: a big cover, its title, and how much is left.
private struct ContinueCard: View {
    let record: EpisodeRecord
    let episode: PodcastEpisode
    @Environment(PlaybackCenter.self) private var center

    var body: some View {
        let left = Stats.length(max(60, record.duration - record.position))
        NavigationLink(value: episode) {
            HStack(spacing: 14) {
                Artwork(episode: episode, size: 96, radius: 12)
                VStack(alignment: .leading, spacing: 2) {
                    Text(episode.showTitle.uppercased()).font(Theme.text(12, .semibold)).tracking(0.2)
                        .foregroundStyle(Theme.inkSubtle).lineLimit(1)
                    Text(episode.title).font(Theme.text(17, .semibold)).foregroundStyle(Theme.ink).lineLimit(2)
                        .multilineTextAlignment(.leading)
                    HStack(spacing: 10) {
                        Button { center.play(episode) } label: {
                            Label("\(left) left", systemImage: "play.fill").font(Theme.text(14, .semibold))
                        }
                        .buttonStyle(.eks(.secondary, small: true, height: 32))
                        .accessibilityLabel("Resume, \(left) left")
                        Track(value: record.progress)
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
    @Environment(PlaybackCenter.self) private var center
    @Environment(AppUI.self) private var ui
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
        let record = records.first
        return NavigationLink(value: episode) {
            Row(title: episode.title, subtitle: subtitle(record),
                leading: { if showArt { Artwork(episode: episode, size: plain ? 56 : 44) } },
                trailing: { trailing(record) })
        }
        .buttonStyle(.plain)
        .contextMenu {
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
        }
    }

    private func subtitle(_ r: EpisodeRecord?) -> String {
        var parts: [String] = []
        if showArt { parts.append(episode.showTitle) }
        if !showArt, let d = episode.published { parts.append(d.formatted(.dateTime.day().month(.abbreviated))) }
        if let d = episode.duration, d > 0 { parts.append(Stats.length(d)) }
        if r?.played == true { parts.append("played") }
        else if let r, r.position > 30, r.duration > 0 { parts.append("\(Stats.length(r.duration - r.position)) left") }
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
            RoundButton(symbol: "play.fill", label: "Play \(episode.title)") { center.play(episode) }
        }
    }
}

func relativeDay(_ date: Date) -> String {
    if Calendar.current.isDateInToday(date) { return "today" }
    if Calendar.current.isDateInYesterday(date) { return "yesterday" }
    return date.formatted(.dateTime.day().month(.abbreviated))
}
