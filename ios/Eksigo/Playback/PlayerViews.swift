import AVKit
import SwiftUI

/// The episode playing, above the tabs: a tap opens the player.
struct MiniPlayer: View {
    @Environment(PlaybackCenter.self) private var center
    @Environment(AppUI.self) private var ui

    /// From iOS 26.1 the mini player is the tab bar's accessory (the system draws its glass and leaves room for it);
    /// before that it is our own card above the tab bar.
    static var isTabAccessory: Bool {
        if #available(iOS 26.1, *) { true } else { false }
    }

    var body: some View {
        if let e = center.episode, center.mode != .missed {
            if Self.isTabAccessory {
                row(e).padding(.horizontal, 10)
            } else {
                row(e)
                    .padding(.leading, 8).padding(.trailing, 6).padding(.vertical, 6)
                    .background(Theme.surface2, in: RoundedRectangle(cornerRadius: 12))
                    .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.hairlineStrong))
                    .padding(.horizontal, 8).padding(.bottom, 8)
            }
        }
    }

    private func row(_ e: PodcastEpisode) -> some View {
        HStack(spacing: 10) {
            Artwork(episode: e, size: Self.isTabAccessory ? 32 : 40, radius: 6)
            VStack(alignment: .leading, spacing: 1) {
                Text(e.title).font(Theme.text(14, .medium)).foregroundStyle(Theme.ink).lineLimit(1)
                Text("\(center.rate.speedText) · \(Stats.clock(max(0, center.duration - center.position))) left")
                    .font(Theme.mono(11)).foregroundStyle(Theme.inkSubtle).lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            IconButton(symbol: "gobackward.15", label: "Back 15 seconds", size: 18) { center.skip(-center.settings.skipBack) }
            IconButton(symbol: center.isPlaying ? "pause.fill" : "play.fill", label: center.isPlaying ? "Pause" : "Play", size: 18) {
                center.togglePlayPause()
            }
        }
        .contentShape(Rectangle())
        .onTapGesture { ui.showPlayer = true }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Now playing: \(e.title)")
        .accessibilityAction(named: "Open the player") { ui.showPlayer = true }
    }
}

/// Now playing (design P28, P29): the cover, the episode's missed sentences, the time bar and controls, what plays
/// next, and a row of labelled controls (speed, sleep, Up Next, AirPlay, more). Scrolled up: the missed sentences,
/// the episode's notes and details, with a small bar to keep control.
struct NowPlayingView: View {
    @Environment(PlaybackCenter.self) private var center
    @Environment(RecordStore.self) private var store
    @Environment(AppUI.self) private var ui
    @Environment(\.dismiss) private var dismiss
    @State private var scrub: Double?
    @State private var showUpNext = false
    @State private var showShow: PodcastShow?
    @State private var scrolled = false
    @State private var route = RouteName.current()

    var body: some View {
        VStack(spacing: 0) {
            NavBar(title: center.episode?.showTitle ?? "", close: true, quiet: true, onBack: { dismiss() }) {
                if let e = center.episode { MoreMenu(episode: e, showShow: $showShow) { moreLabel } }
            }
            if let e = center.episode {
                GeometryReader { g in
                    ScrollView {
                        VStack(alignment: .leading, spacing: 0) {
                            top(e, side: min(g.size.width - 56, g.size.height * 0.42))
                                .frame(minHeight: g.size.height)
                            details(e)
                        }
                        .padding(.horizontal, 28)
                    }
                    .onScrollGeometryChange(for: Bool.self) { $0.contentOffset.y > g.size.height * 0.55 } action: { _, new in
                        withAnimation(.easeOut(duration: 0.15)) { scrolled = new }
                    }
                    .overlay(alignment: .top) { if scrolled { compactBar(e) } }
                }
            }
        }
        .canvas()
        .sheet(isPresented: $showUpNext) {
            UpNextView().presentationDetents([.medium, .large]).presentationDragIndicator(.visible)
        }
        .sheet(item: $showShow) { show in
            NavigationStack {
                ShowView(show: show)
                    .navigationDestination(for: PodcastEpisode.self) { EpisodeView(episode: $0) }
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: AVAudioSession.routeChangeNotification).receive(on: RunLoop.main)) { _ in
            route = RouteName.current()
        }
    }

    // MARK: The first screen

    private func top(_ e: PodcastEpisode, side: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: 22) {
            Artwork(episode: e, size: side, radius: 16).frame(maxWidth: .infinity)
            VStack(alignment: .leading, spacing: 10) {
                Text(e.title).font(Theme.display(22)).tracking(-0.4).foregroundStyle(Theme.ink).lineLimit(3)
                let missed = missedHere(e)
                if !missed.isEmpty {
                    Button { playMissed(missed) } label: {
                        HStack(spacing: 8) {
                            Image(systemName: "headphones").font(.system(size: 13, weight: .medium))
                            Text(plural(missed.count, "missed sentence"))
                            Text("· Play").foregroundStyle(Theme.inkSubtle)
                        }
                        .font(Theme.text(13, .medium)).foregroundStyle(Theme.ink)
                        .padding(.leading, 10).padding(.trailing, 12).frame(height: 34)
                        .background(Theme.surface2, in: Capsule()).overlay(Capsule().strokeBorder(Theme.hairlineStrong))
                        .frame(minHeight: 44)
                    }
                    .buttonStyle(.plain)
                    .disabled(!missed.contains(where: center.playable))
                }
            }
            scrubber
            controls
            Spacer(minLength: 8)
            if let next = center.queue.first {
                Button { showUpNext = true } label: {
                    HStack(spacing: 10) {
                        Artwork(episode: next, size: 36, radius: 6)
                        VStack(alignment: .leading, spacing: 3) {
                            Text("Up next").font(Theme.text(11, .medium)).foregroundStyle(Theme.inkSubtle)
                            Text(next.title).font(Theme.text(14, .medium)).foregroundStyle(Theme.ink).lineLimit(1)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        Image(systemName: "chevron.right").font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.inkTertiary)
                    }
                    .padding(.leading, 8).padding(.trailing, 12).frame(height: 52)
                    .background(Theme.surface1, in: RoundedRectangle(cornerRadius: 12))
                    .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.hairline))
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Up next: \(next.title)")
                .padding(.horizontal, -12)
            }
            controlRow(e).padding(.horizontal, -16).padding(.bottom, 8)
        }
        .padding(.top, 6)
    }

    private var scrubber: some View {
        VStack(spacing: 8) {
            let value = scrub ?? center.position
            Slider(value: Binding(get: { value }, set: { scrub = $0 }), in: 0...max(center.duration, 1)) { editing in
                if !editing, let s = scrub {
                    center.seek(to: s)
                    scrub = nil
                }
            }
            .tint(Theme.ink)
            .accessibilityLabel("Position")
            .accessibilityValue(Stats.clock(value))
            HStack {
                Text(Stats.clock(value))
                Spacer()
                Text("−" + Stats.clock(center.duration - value))
            }
            .font(Theme.mono(12)).foregroundStyle(Theme.inkSubtle)
        }
    }

    private var controls: some View {
        HStack {
            IconButton(symbol: "gobackward.\(Int(center.settings.skipBack))", label: "Back \(Int(center.settings.skipBack)) seconds", size: 30) {
                center.skip(-center.settings.skipBack)
            }
            .frame(width: 56, height: 56)
            Spacer()
            BigPlayButton(playing: center.isPlaying, size: 76) { center.togglePlayPause() }
            Spacer()
            IconButton(symbol: "goforward.\(Int(center.settings.skipForward))", label: "Forward \(Int(center.settings.skipForward)) seconds", size: 30) {
                center.skip(center.settings.skipForward)
            }
            .frame(width: 56, height: 56)
        }
        .padding(.horizontal, 14)
    }

    /// Speed · Sleep · Up Next · AirPlay · More, each with its name under it.
    private func controlRow(_ e: PodcastEpisode) -> some View {
        HStack(alignment: .top) {
            Menu {
                ForEach(AppSettings.speeds, id: \.self) { s in
                    Button { center.setRate(s) } label: {
                        if s == center.rate { Label(s.speedText, systemImage: "checkmark") } else { Text(s.speedText) }
                    }
                }
            } label: {
                ControlLabel(name: "Speed") { Text(center.rate.speedText).font(Theme.mono(15, .medium)).foregroundStyle(Theme.ink) }
            }
            .accessibilityLabel("Speed \(center.rate.speedText)")
            Spacer(minLength: 0)
            Menu {
                Button("Off") { center.sleep(after: nil) }
                ForEach([5, 15, 30, 45, 60], id: \.self) { m in Button("\(m) minutes") { center.sleep(after: m) } }
                Button("End of episode") { center.sleepAtEndOfEpisode() }
            } label: {
                TimelineView(.periodic(from: .now, by: 20)) { context in
                    ControlLabel(name: sleepText(context.date), on: center.sleepActive) {
                        Image(systemName: center.sleepActive ? "moon.fill" : "moon").font(.system(size: 20))
                    }
                }
            }
            .accessibilityLabel(center.sleepActive ? "Sleep timer: \(sleepText(.now))" : "Sleep timer")
            Spacer(minLength: 0)
            Button { showUpNext = true } label: {
                ControlLabel(name: "Up Next") {
                    Image(systemName: "list.bullet").font(.system(size: 20))
                        .overlay(alignment: .topTrailing) {
                            if !center.queue.isEmpty {
                                Text("\(center.queue.count)").font(Theme.text(10, .semibold)).foregroundStyle(Theme.canvas)
                                    .padding(.horizontal, 4).frame(minWidth: 16, minHeight: 16)
                                    .background(Theme.ink, in: Capsule())
                                    .offset(x: 10, y: -6)
                            }
                        }
                }
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Up Next, \(plural(center.queue.count, "episode"))")
            Spacer(minLength: 0)
            ZStack {
                ControlLabel(name: route) { Image(systemName: "airplayaudio").font(.system(size: 20)) }
                RoutePicker().frame(width: 56, height: 52).opacity(0.02)
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Play on: \(route)")
            .accessibilityAddTraits(.isButton)
            Spacer(minLength: 0)
            MoreMenu(episode: e, showShow: $showShow) { ControlLabel(name: "More") { Image(systemName: "ellipsis").font(.system(size: 20)) } }
        }
    }

    private var moreLabel: some View {
        Image(systemName: "ellipsis").font(.system(size: 20)).foregroundStyle(Theme.ink).frame(width: 44, height: 44)
    }

    private func sleepText(_ now: Date) -> String {
        if center.sleepAtEnd { return "End" }
        if let at = center.sleepAt { return "\(max(1, Int((at.timeIntervalSince(now) / 60).rounded(.up)))) min" }
        return "Sleep"
    }

    // MARK: Scrolled up

    @ViewBuilder private func details(_ e: PodcastEpisode) -> some View {
        VStack(alignment: .leading, spacing: 22) {
            let missed = missedHere(e)
            if !missed.isEmpty {
                Block("Missed on your computer") {
                    Button { playMissed(missed) } label: {
                        RowGroup {
                            Row(title: plural(missed.count, "sentence") + " you missed",
                                subtitle: missed.contains(where: center.playable) ? "Each played \(center.settings.repeats == 1 ? "once" : center.settings.repeats == 2 ? "twice" : "\(center.settings.repeats) times"), then the text" : "This phone's copy isn't the computer's file: text only",
                                chevron: true, leading: { IconTile("headphones") }, trailing: { EmptyView() })
                        }
                    }
                    .buttonStyle(.plain)
                    .disabled(!missed.contains(where: center.playable))
                }
            }
            if !e.summary.isEmpty {
                Block("About this episode") {
                    Text(e.summary).font(Theme.text(15)).lineSpacing(5).foregroundStyle(Theme.inkMuted).padding(.horizontal, 4)
                        .textSelection(.enabled)
                }
            }
            Block("Episode") {
                RowGroup {
                    if let d = e.published { Row("Published") { RowValue(d.formatted(.dateTime.day().month(.abbreviated).year())) } }
                    if center.duration > 0 { Row("Length") { RowValue(Stats.length(center.duration)) } }
                    Row("On this phone") { RowValue(downloadText(e)) }
                }
            }
        }
        .padding(.top, 8).padding(.bottom, 40)
    }

    /// The small bar once the cover has scrolled away (design P29).
    private func compactBar(_ e: PodcastEpisode) -> some View {
        HStack(spacing: 12) {
            Artwork(episode: e, size: 44)
            VStack(alignment: .leading, spacing: 3) {
                Text(e.title).font(Theme.text(15, .medium)).foregroundStyle(Theme.ink).lineLimit(1)
                Text("\(Stats.clock(center.position)) · −\(Stats.clock(max(0, center.duration - center.position)))")
                    .font(Theme.mono(12)).foregroundStyle(Theme.inkSubtle)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            BigPlayButton(playing: center.isPlaying, size: 40) { center.togglePlayPause() }
        }
        .padding(10)
        .background(Theme.surface1, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.hairline))
        .padding(.horizontal, 16).padding(.top, 4).padding(.bottom, 10)
        .background(Theme.canvas)
        .transition(.move(edge: .top).combined(with: .opacity))
    }

    // MARK: Helpers

    private func missedHere(_ e: PodcastEpisode) -> [Missed] {
        store.missed.filter { $0.ref.key == e.key }.sorted { $0.idx < $1.idx }
    }

    /// The missed-sentences player opens over the tabs, so this one closes first.
    private func playMissed(_ missed: [Missed]) {
        dismiss()
        Task {
            try? await Task.sleep(for: .milliseconds(450))
            center.startMissed(missed)
            ui.showMissed = true
        }
    }

    private func downloadText(_ e: PodcastEpisode) -> String {
        if let p = center.downloading[e.key] { return "Downloading \(Int(p * 100))%" }
        guard center.isDownloaded(e) else { return "Streaming" }
        let bytes = center.downloads().first { $0.key == e.key }?.fileBytes ?? 0
        return bytes > 0 ? ByteCountFormatter.string(fromByteCount: bytes, countStyle: .file) : "Downloaded"
    }
}

/// An icon (or value) with its name under it, in the player's bottom row.
private struct ControlLabel<Icon: View>: View {
    let name: String
    var on = false
    @ViewBuilder var icon: Icon

    var body: some View {
        VStack(spacing: 5) {
            icon.foregroundStyle(on ? Theme.ink : Theme.inkMuted).frame(height: 24)
            Text(name).font(Theme.text(11, .medium)).foregroundStyle(on ? Theme.ink : Theme.inkSubtle).lineLimit(1)
        }
        .frame(width: 64, height: 52)
        .contentShape(Rectangle())
    }
}

/// The player's More (design P31): download, go to the show, mark played, share, skip to what's next.
private struct MoreMenu<Label: View>: View {
    let episode: PodcastEpisode
    @Binding var showShow: PodcastShow?
    @ViewBuilder var label: Label
    @Environment(PlaybackCenter.self) private var center

    var body: some View {
        Menu {
            if let p = center.downloading[episode.key] {
                Button("Downloading \(Int(p * 100))%", systemImage: "arrow.down.circle") {}.disabled(true)
            } else if center.isDownloaded(episode) {
                Button("Remove download", systemImage: "trash", role: .destructive) { center.deleteDownload(episode) }
            } else {
                Button(episode.audioBytes.flatMap { $0 > 0 ? "Download · \(ByteCountFormatter.string(fromByteCount: $0, countStyle: .file))" : nil } ?? "Download",
                       systemImage: "arrow.down.circle") { center.download(episode) }
            }
            if let feed = episode.feedUrl {
                Button("Go to show", systemImage: "square.stack") {
                    showShow = PodcastShow(feedUrl: feed, title: episode.showTitle, author: nil, artworkUrl: episode.showArtworkUrl ?? episode.artworkUrl)
                }
            }
            Button("Mark as played", systemImage: "checkmark.circle") { center.markPlayed() }
            ShareLink(item: episode.audioUrl, subject: Text(episode.title), message: Text("\(episode.title) · \(episode.showTitle)")) {
                SwiftUI.Label("Share episode", systemImage: "square.and.arrow.up")
            }
            if let next = center.queue.first {
                Section {
                    Button("Skip to “\(next.title)”", systemImage: "forward.end") { center.playNextInQueue() }
                }
            }
        } label: {
            label
        }
        .accessibilityLabel("More")
    }
}

/// Where the sound goes: "iPhone", "AirPods Pro", a speaker's name.
enum RouteName {
    static func current() -> String {
        guard let out = AVAudioSession.sharedInstance().currentRoute.outputs.first else { return "iPhone" }
        switch out.portType {
        case .builtInSpeaker, .builtInReceiver: return UIDevice.current.model
        default: return out.portName
        }
    }
}

/// The system's AirPlay button.
struct RoutePicker: UIViewRepresentable {
    func makeUIView(context: Context) -> AVRoutePickerView {
        let v = AVRoutePickerView()
        v.tintColor = UIColor(Theme.inkSubtle)
        v.activeTintColor = UIColor(Theme.ink)
        v.prioritizesVideoDevices = false
        return v
    }

    func updateUIView(_ uiView: AVRoutePickerView, context: Context) {}
}
