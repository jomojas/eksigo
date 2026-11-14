import SwiftUI

/// The four tabs (Listen, Discover, Review, Me), the mini player above them, and what opens over them: the player,
/// the missed sentences and a review session. The Welcome page comes first, once.
struct RootView: View {
    @Environment(AppUI.self) private var ui
    @Environment(PlaybackCenter.self) private var center

    var body: some View {
        @Bindable var ui = ui
        Group {
            if ui.welcomed {
                TabView(selection: $ui.tab) {
                    Tab("Listen", systemImage: "headphones", value: AppUI.Tab.listen) { stack { ListenView() } }
                    Tab("Discover", systemImage: "safari", value: AppUI.Tab.discover) { stack { DiscoverView() } }
                    Tab("Review", systemImage: "rectangle.stack", value: AppUI.Tab.review) { stack { ReviewView() } }
                    Tab("Me", systemImage: "person", value: AppUI.Tab.me) { stack { MeView() } }
                }
                .miniPlayerAccessory(showing: hasMiniPlayer)
            } else {
                WelcomeView()
            }
        }
        .fullScreenCover(isPresented: $ui.showPlayer) { NowPlayingView() }
        .fullScreenCover(isPresented: $ui.showMissed, onDismiss: { if center.mode == .missed { center.endMissed() } }) { MissedPlayerView() }
        .fullScreenCover(isPresented: $ui.showReview) { ReviewSessionView() }
        .alert("Something went wrong", isPresented: Binding(get: { center.error != nil }, set: { if !$0 { center.error = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(center.error ?? "")
        }
    }

    private func stack<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        NavigationStack {
            content()
                .navigationDestination(for: PodcastShow.self) { ShowView(show: $0) }
                .navigationDestination(for: PodcastEpisode.self) { EpisodeView(episode: $0) }
                .navigationDestination(for: Listing.self) { ShowLoader(listing: $0) }
                .navigationDestination(for: Route.self) { $0.view }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            VStack(spacing: 0) {
                ToastView()
                if !MiniPlayer.isTabAccessory { MiniPlayer() }
            }
        }
    }

    private var hasMiniPlayer: Bool { center.episode != nil && center.mode != .missed }
}

private extension View {
    /// From iOS 26.1 the mini player sits in the tab bar's own accessory spot, so the system leaves room for it at
    /// the bottom of every page (a view placed over the floating tab bar covered the last rows).
    @ViewBuilder func miniPlayerAccessory(showing: Bool) -> some View {
        if #available(iOS 26.1, *) {
            tabViewBottomAccessory(isEnabled: showing) { MiniPlayer() }
        } else {
            self
        }
    }
}

/// Pages reached from more than one place.
enum Route: Hashable {
    case words(Word.Level?)
    case word(String)
    case history
    case progress
    case settings
    case account
    case downloads
    case missedList
    case upNext
    case forLearners
    /// Apple's top shows, all or one topic (an Apple genre id).
    case topShows(Int?)

    @ViewBuilder var view: some View {
        switch self {
        case .words(let level): WordsView(initial: level)
        case .word(let key): WordView(key: key)
        case .history: HistoryView()
        case .progress: ProgressPage()
        case .settings: SettingsView()
        case .account: AccountView()
        case .downloads: DownloadsView()
        case .missedList: MissedListView(asPage: true)
        case .upNext: UpNextView(asPage: true)
        case .forLearners: ForLearnersView()
        case .topShows(let genre): TopShowsView(genre: genre)
        }
    }
}

/// The message at the bottom, above the mini player, for a few seconds.
struct ToastView: View {
    @Environment(AppUI.self) private var ui

    var body: some View {
        if let t = ui.toast {
            HStack(spacing: 10) {
                Image(systemName: t.symbol).font(.system(size: 15, weight: .medium))
                Text(t.text).font(Theme.text(14, .medium)).lineLimit(1)
                Spacer(minLength: 8)
                if let undo = t.undo {
                    Button("Undo") {
                        undo()
                        ui.toast = nil
                    }
                    .font(Theme.text(14, .semibold)).opacity(0.7)
                }
            }
            .foregroundStyle(Theme.canvas)
            .padding(.horizontal, 14).frame(height: 48)
            .background(Theme.ink, in: RoundedRectangle(cornerRadius: 12))
            .padding(.horizontal, 16).padding(.bottom, 8)
            .transition(.move(edge: .bottom).combined(with: .opacity))
            .id(t.id)
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.updatesFrequently)
        }
    }
}
