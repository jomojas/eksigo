import AVKit
import SwiftUI

/// The episode playing, above the tabs: a tap opens the player.
struct MiniPlayer: View {
    @Environment(PlaybackCenter.self) private var center
    @Environment(AppUI.self) private var ui

    var body: some View {
        if let e = center.episode, center.mode != .missed {
            HStack(spacing: 10) {
                Artwork(url: e.artwork, size: 40, radius: 6)
                VStack(alignment: .leading, spacing: 2) {
                    Text(e.title).font(Theme.text(14, .medium)).foregroundStyle(Theme.ink).lineLimit(1)
                    Text("\(center.rate.speedText) · \(Stats.clock(max(0, center.duration - center.position))) left")
                        .font(Theme.mono(12)).foregroundStyle(Theme.inkSubtle).lineLimit(1)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                IconButton(symbol: "gobackward.15", label: "Back 15 seconds", size: 19) { center.skip(-center.settings.skipBack) }
                IconButton(symbol: center.isPlaying ? "pause.fill" : "play.fill", label: center.isPlaying ? "Pause" : "Play", size: 18) {
                    center.togglePlayPause()
                }
            }
            .padding(.leading, 8).padding(.trailing, 6).padding(.vertical, 6)
            .background(Theme.surface2, in: RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.hairlineStrong))
            .contentShape(RoundedRectangle(cornerRadius: 12))
            .onTapGesture { ui.showPlayer = true }
            .accessibilityElement(children: .contain)
            .accessibilityLabel("Now playing: \(e.title)")
            .accessibilityAction(named: "Open the player") { ui.showPlayer = true }
            .padding(.horizontal, 8).padding(.bottom, 8)
        }
    }
}

/// Now playing (design P05).
struct NowPlayingView: View {
    @Environment(PlaybackCenter.self) private var center
    @Environment(Account.self) private var account
    @Environment(\.dismiss) private var dismiss
    @State private var scrub: Double?

    var body: some View {
        VStack(spacing: 0) {
            NavBar(close: true, onBack: { dismiss() }) {
                if let e = center.episode {
                    Menu {
                        if center.isDownloaded(e) {
                            Button("Remove download", systemImage: "trash", role: .destructive) { center.deleteDownload(e) }
                        } else {
                            Button("Download", systemImage: "arrow.down.circle") { center.download(e) }
                        }
                    } label: {
                        Image(systemName: "ellipsis").font(.system(size: 20)).foregroundStyle(Theme.ink).frame(width: 44, height: 44)
                    }
                    .accessibilityLabel("More")
                }
            }
            if let e = center.episode {
                ScrollView {
                    VStack(alignment: .leading, spacing: 26) {
                        Artwork(url: e.artwork, size: 334, radius: 14)
                            .frame(maxWidth: .infinity)
                            .aspectRatio(1, contentMode: .fit)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(e.title).font(Theme.display(22)).tracking(-0.4).foregroundStyle(Theme.ink)
                            Text([e.showTitle, e.published?.formatted(.dateTime.day().month(.abbreviated))].compactMap { $0 }.joined(separator: " · "))
                                .font(Theme.text(15)).foregroundStyle(Theme.inkSubtle)
                        }
                        scrubber
                        controls
                        HStack {
                            Menu {
                                ForEach(AppSettings.speeds, id: \.self) { s in
                                    Button(s.speedText) { center.setRate(s) }
                                }
                            } label: {
                                Text(center.rate.speedText).font(Theme.mono(13, .medium)).foregroundStyle(Theme.inkMuted)
                                    .padding(.horizontal, 10).frame(height: 28)
                                    .background(Theme.surface2, in: Capsule()).overlay(Capsule().strokeBorder(Theme.hairlineStrong))
                                    .frame(minHeight: 44)
                            }
                            .accessibilityLabel("Speed \(center.rate.speedText)")
                            Spacer()
                            Menu {
                                Button("Off") { center.sleep(after: nil) }
                                ForEach([5, 15, 30, 45, 60], id: \.self) { m in Button("\(m) minutes") { center.sleep(after: m) } }
                                Button("End of episode") { center.sleepAtEndOfEpisode() }
                            } label: {
                                Image(systemName: center.sleepActive ? "moon.fill" : "moon").font(.system(size: 20))
                                    .foregroundStyle(center.sleepActive ? Theme.ink : Theme.inkSubtle).frame(width: 44, height: 44)
                            }
                            .accessibilityLabel(center.sleepActive ? "Sleep timer on" : "Sleep timer")
                            Spacer()
                            RoutePicker().frame(width: 44, height: 44).accessibilityLabel("AirPlay")
                        }
                        if account.isSignedIn {
                            HStack(spacing: 6) {
                                Dot(color: Theme.success)
                                Text("On your computer's Today, ready to dictate")
                            }
                            .font(Theme.text(12)).foregroundStyle(Theme.inkSubtle)
                            .frame(maxWidth: .infinity)
                        }
                    }
                    .padding(.horizontal, 28).padding(.top, 8).padding(.bottom, 32)
                }
            }
        }
        .canvas()
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
        .padding(.horizontal, 18)
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
