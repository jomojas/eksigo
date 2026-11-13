import SwiftData
import SwiftUI

@main
struct EksigoApp: App {
    private let container: ModelContainer
    @State private var settings: AppSettings
    @State private var store: RecordStore
    @State private var account: Account
    @State private var syncer: Syncer
    @State private var center: PlaybackCenter
    @State private var clips = ClipPlayer()
    @State private var ui = AppUI()
    @Environment(\.scenePhase) private var phase

    init() {
        // Covers are asked for on every screen: keep them on disk instead of the small default cache.
        URLCache.shared = URLCache(memoryCapacity: 32 << 20, diskCapacity: 300 << 20)
        let container = try! ModelContainer(for: Schema(Store.schema))
        self.container = container
        let settings = AppSettings()
        let store = RecordStore(context: container.mainContext)
        let account = Account()
        let syncer = Syncer(store: store, account: account)
        let center = PlaybackCenter(settings: settings, store: store, context: container.mainContext)
        center.onPause = { [weak syncer] in syncer?.soon(after: 4) }
        _settings = State(initialValue: settings)
        _store = State(initialValue: store)
        _account = State(initialValue: account)
        _syncer = State(initialValue: syncer)
        _center = State(initialValue: center)
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(settings)
                .environment(store)
                .environment(account)
                .environment(syncer)
                .environment(center)
                .environment(clips)
                .environment(ui)
                .tint(Theme.ink)
                .preferredColorScheme(settings.appearance.scheme)
                .onAppear { clips.center = center }
                .task { await syncer.every(minutes: 10) }
                #if DEBUG
                .task { await DebugLaunch.run(store: store, ui: ui) }
                #endif
        }
        .modelContainer(container)
        .onChange(of: phase) { _, now in
            switch now {
            case .active:
                Task { await account.refresh() }
                syncer.now()
                center.downloadMissedEpisodes()
            case .background:
                center.saveProgress()
                store.flush()
                syncer.now()
            default: break
            }
        }
    }
}

/// What's open over the tabs.
@Observable
final class AppUI {
    var tab: Tab = .listen
    var showPlayer = false
    var showMissed = false
    var showReview = false
    /// The Welcome page, on first launch only.
    var welcomed = UserDefaults.standard.bool(forKey: "welcomed") {
        didSet { UserDefaults.standard.set(welcomed, forKey: "welcomed") }
    }

    enum Tab: Hashable { case listen, discover, review, me }
}

#if DEBUG
/// Simulator shortcuts: `-sample YES` fills the phone with made-up words and missed sentences, as if synced from the
/// computer, to try the screens without an account; `-tab review|discover|me` opens a tab.
enum DebugLaunch {
    static func run(store: RecordStore, ui: AppUI) async {
        let d = UserDefaults.standard
        if d.bool(forKey: "sample") {
            ui.welcomed = true
            Sample.fill(store)
        }
        switch d.string(forKey: "tab") {
        case "discover": ui.tab = .discover
        case "review": ui.tab = .review
        case "me": ui.tab = .me
        default: break
        }
        if d.bool(forKey: "openMissed") { ui.showMissed = true }
        if d.bool(forKey: "openReview") { ui.showReview = true }
    }
}
#endif
