import SwiftData
import SwiftUI

/// The Listen tab (design P02, P10): last night's missed sentences, the episode to continue, new episodes.
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
            VStack(alignment: .leading, spacing: 24) {
                HStack(alignment: .bottom) {
                    LargeTitle("Listen").frame(maxWidth: .infinity, alignment: .leading)
                    SyncBadge()
                }
                if !store.missed.isEmpty {
                    MissedCard()
                } else {
                    EmptyMissedCard()
                }
                if let r = continuing, let e = r.episode {
                    Block("Continue") {
                        RowGroup {
                            NavigationLink(value: e) {
                                VStack(spacing: 10) {
                                    Row(title: e.title, subtitle: "\(e.showTitle) · \(Stats.length(max(60, r.duration - r.position))) left",
                                        leading: { Artwork(url: e.artwork, size: 52) },
                                        trailing: { RoundButton(symbol: "play.fill", label: "Resume") { center.play(e) } })
                                    Track(value: r.progress).padding(.horizontal, 12).padding(.bottom, 12).padding(.top, -6)
                                }
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                newEpisodes
            }
            .padding(.horizontal, 16).padding(.top, 8).padding(.bottom, 24)
        }
        .canvas()
        .toolbar(.hidden, for: .navigationBar)
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
            Block("New from your shows", trailing: { Button("All") { ui.tab = .discover } }) {
                if episodes.isEmpty {
                    HStack { Spacer(); ProgressView(); Spacer() }.padding(.vertical, 20)
                } else {
                    RowGroup {
                        ForEach(episodes) { e in EpisodeRow(episode: e, showArt: true) }
                    }
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

/// The missed sentences waiting from the computer.
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
        VStack(alignment: .leading, spacing: 12) {
            Text(MissedGroup.when(groups.first?.latest ?? 0)).font(Theme.text(12, .medium)).tracking(0.3).foregroundStyle(Theme.inkSubtle)
            Text("\(all.count) sentence\(all.count == 1 ? "" : "s") you missed").font(Theme.display(22)).tracking(-0.4).foregroundStyle(Theme.ink)
            Text(summary(groups: groups.count, minutes: Int((seconds / 60).rounded(.up)), textOnly: all.count - playable.count))
                .font(Theme.text(13)).foregroundStyle(Theme.inkSubtle)
            HStack(spacing: 8) {
                Button {
                    center.startMissed(all)
                    ui.showMissed = true
                } label: {
                    Label("Play them all", systemImage: "play.fill")
                }
                .buttonStyle(.eks(.primary))
                .disabled(playable.isEmpty)
                NavigationLink(value: Route.missedList) { Text("See all") }.buttonStyle(.eks(.ghost))
            }
        }
        .card()
    }

    private func summary(groups: Int, minutes: Int, textOnly: Int) -> String {
        var s = "\(groups) episode\(groups == 1 ? "" : "s") · about \(max(1, minutes)) minute\(minutes == 1 ? "" : "s")"
        s += settings.repeats == 1 ? "" : settings.repeats == 2 ? ", each twice" : ", each \(settings.repeats) times"
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
            IconTile("laptopcomputer")
            Text(account.isSignedIn ? "Nothing missed yet" : "Your missed sentences play here")
                .font(Theme.display(19)).tracking(-0.3).foregroundStyle(Theme.ink)
            Text(account.isSignedIn
                 ? "Dictate an episode on your computer. The sentences you miss come over by themselves, ready for the commute."
                 : "Dictate an episode on your computer, then sign in with the same account here. The sentences you missed come over by themselves, ready for the commute.")
                .font(Theme.text(14)).lineSpacing(3).foregroundStyle(Theme.inkSubtle)
            HStack(spacing: 8) {
                if !account.isSignedIn {
                    NavigationLink(value: Route.account) { Text("Sign in") }.buttonStyle(.eks(.primary))
                }
                Button("Get the desktop app") { openURL(URL(string: "https://eksigo.com")!) }.buttonStyle(.eks(.ghost))
            }
        }
        .card()
    }
}

/// An episode in a list: a tap opens it; play, or a check once played.
struct EpisodeRow: View {
    let episode: PodcastEpisode
    var showArt = false
    @Environment(PlaybackCenter.self) private var center
    @Query private var records: [EpisodeRecord]

    init(episode: PodcastEpisode, showArt: Bool = false) {
        self.episode = episode
        self.showArt = showArt
        let key = episode.key
        _records = Query(filter: #Predicate<EpisodeRecord> { $0.key == key })
    }

    var body: some View {
        let record = records.first
        NavigationLink(value: episode) {
            Row(title: episode.title, subtitle: subtitle(record),
                leading: { if showArt { Artwork(url: episode.artwork, size: 44) } },
                trailing: { trailing(record) })
        }
        .buttonStyle(.plain)
        .contextMenu {
            Button("Play", systemImage: "play") { center.play(episode) }
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
