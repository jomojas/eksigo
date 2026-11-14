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
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
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
    @State private var tint: UIColor?

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
        .background(CoverBackdrop(tint: tint).ignoresSafeArea())
        // White on the cover's colour, whatever the phone's appearance.
        .environment(\.colorScheme, .dark)
        .environment(\.groupFill, .white.opacity(0.13))
        .preferredColorScheme(.dark)
        .task(id: center.episode?.key) {
            guard let e = center.episode else { return }
            let urls = [e.artworkUrl, e.showArtworkUrl].compactMap { $0 }
            let t = await CoverCache.shared.tint(urls)
            withAnimation(.easeOut(duration: 0.4)) { tint = t }
        }
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
        // The controls sit together at the bottom; any spare height goes under the cover, not between them.
        VStack(alignment: .leading, spacing: 0) {
            Artwork(episode: e, size: side, radius: 16)
                .shadow(color: .black.opacity(0.35), radius: 24, y: 14)
                .frame(maxWidth: .infinity)
            Spacer(minLength: 22)
            VStack(alignment: .leading, spacing: 10) {
                Text(e.title).font(Theme.display(21)).foregroundStyle(Theme.ink).lineLimit(2)
                let missed = missedHere(e)
                if !missed.isEmpty {
                    Button { playMissed(missed) } label: {
                        HStack(spacing: 6) {
                            Image(systemName: "ear").font(.system(size: 14, weight: .semibold))
                            Text(plural(missed.count, "missed sentence"))
                            Text("· Play").foregroundStyle(Theme.inkSubtle)
                        }
                        .font(Theme.text(14, .semibold)).foregroundStyle(Theme.ink)
                        .padding(.leading, 12).padding(.trailing, 14).frame(height: 34)
                        .background(.white.opacity(0.16), in: Capsule())
                        .frame(minHeight: 44)
                    }
                    .buttonStyle(.plain)
                    .disabled(!missed.contains(where: center.playable))
                }
            }
            scrubber.padding(.top, 18)
            controls.padding(.top, 2)
            if let next = center.queue.first {
                Button { showUpNext = true } label: {
                    HStack(spacing: 10) {
                        Artwork(episode: next, size: 36, radius: 6)
                        VStack(alignment: .leading, spacing: 3) {
                            Text("UP NEXT · \(center.queue.count)").font(Theme.text(11, .semibold)).tracking(0.3).foregroundStyle(Theme.inkSubtle)
                            Text(next.title).font(Theme.text(15, .semibold)).foregroundStyle(Theme.ink).lineLimit(1)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        Image(systemName: "chevron.right").font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.inkTertiary)
                    }
                    .padding(.leading, 10).padding(.trailing, 14).frame(height: 58)
                    .background(.white.opacity(0.13), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Up next: \(next.title)")
                .padding(.horizontal, -12)
                .padding(.top, 14)
            }
            controlRow(e).padding(.horizontal, -16).padding(.top, 16).padding(.bottom, 8)
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
            .overlay(alignment: .bottomLeading) { missedMarks }
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
            Button { center.togglePlayPause() } label: {
                Image(systemName: center.isPlaying ? "pause.fill" : "play.fill").font(.system(size: 50))
                    .foregroundStyle(Theme.ink).frame(width: 76, height: 76).contentShape(Rectangle())
                    .contentTransition(.symbolEffect(.replace))
            }
            .buttonStyle(.plain)
            .accessibilityLabel(center.isPlaying ? "Pause" : "Play")
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
                Text(e.title).font(Theme.text(15, .semibold)).foregroundStyle(Theme.ink).lineLimit(1)
                Text("\(Stats.clock(center.position)) · −\(Stats.clock(max(0, center.duration - center.position)))")
                    .font(Theme.mono(13)).foregroundStyle(Theme.inkSubtle)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            IconButton(symbol: center.isPlaying ? "pause.fill" : "play.fill", label: center.isPlaying ? "Pause" : "Play", size: 24) {
                center.togglePlayPause()
            }
        }
        .padding(.leading, 10).padding(.trailing, 6).padding(.vertical, 8)
        .glassCapsule()
        .padding(.horizontal, 16).padding(.top, 4).padding(.bottom, 10)
        .transition(.move(edge: .top).combined(with: .opacity))
    }

    // MARK: Helpers

    /// Where this episode's missed sentences are, as small yellow marks under the time bar.
    @ViewBuilder private var missedMarks: some View {
        if let e = center.episode, center.duration > 0 {
            let marks = missedHere(e).map { Double($0.startMs) / 1000 / center.duration }.filter { $0 >= 0 && $0 <= 1 }
            if !marks.isEmpty {
                GeometryReader { g in
                    ForEach(Array(marks.enumerated()), id: \.offset) { _, m in
                        Capsule().fill(Color(hex: 0xFFD60A)).frame(width: 3, height: 7)
                            .position(x: 2 + (g.size.width - 4) * m, y: g.size.height + 4)
                    }
                }
                .allowsHitTesting(false)
                .accessibilityHidden(true)
            }
        }
    }

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

/// The player's background: the cover's colour, from a lighter top to near-black, so white text always reads.
struct CoverBackdrop: View {
    var tint: UIColor?
    var body: some View {
        let base = tint ?? UIColor(white: 0.35, alpha: 1)
        LinearGradient(colors: [shade(base, 0.7), shade(base, 0.4), shade(base, 0.16)], startPoint: .top, endPoint: .bottom)
    }

    private func shade(_ c: UIColor, _ brightness: CGFloat) -> Color {
        var h: CGFloat = 0, s: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        c.getHue(&h, saturation: &s, brightness: &b, alpha: &a)
        return Color(hue: h, saturation: min(0.85, s * 1.15), brightness: min(b, brightness))
    }
}
