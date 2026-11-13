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
        .safeAreaInset(edge: .bottom, spacing: 0) { MiniPlayer() }
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
        }
    }
}
