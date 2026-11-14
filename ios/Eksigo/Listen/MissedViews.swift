import SwiftUI

/// The missed sentences, one at a time (design P03): the sentence with the missed words boxed, what was typed with the
/// wrong words in red, each played a few times before the next.
struct MissedPlayerView: View {
    @Environment(PlaybackCenter.self) private var center
    @Environment(AppSettings.self) private var settings
    @Environment(\.dismiss) private var dismiss
    @State private var showList = false

    var body: some View {
        VStack(spacing: 0) {
            if let s = center.missed {
                NavBar(title: s.finishedAll ? "Done" : "\(s.index + 1) of \(s.items.count)", close: true, onBack: { dismiss() }) {
                    IconButton(symbol: "list.bullet", label: "All sentences", size: 20) { showList = true }
                }
                content(s)
            } else {
                NavBar(close: true, onBack: { dismiss() })
                Spacer()
            }
        }
        .canvas()
        .sheet(isPresented: $showList) {
            NavigationStack { MissedListView(asPage: false) }
        }
    }

    @ViewBuilder private func content(_ s: PlaybackCenter.MissedSession) -> some View {
        if s.finishedAll {
            VStack(alignment: .leading, spacing: 20) {
                Image(systemName: "checkmark").font(.system(size: 24, weight: .medium)).foregroundStyle(Theme.success)
                    .frame(width: 56, height: 56).background(Theme.surface2, in: Circle()).overlay(Circle().strokeBorder(Theme.hairlineStrong))
                Text("All \(s.items.count) sentences played").font(Theme.display(28)).tracking(-0.7).foregroundStyle(Theme.ink)
                Text("They stay here until you dictate the episode again on your computer.")
                    .font(Theme.text(16)).foregroundStyle(Theme.inkSubtle)
                Button("Play them again") { center.missedJump(to: 0) }.buttonStyle(.eks(.secondary, block: true))
                Button("Done") { dismiss() }.buttonStyle(.eks(.primary, block: true, height: 52))
                Spacer()
            }
            .padding(.horizontal, 24).padding(.top, 32)
        } else if let m = s.current {
            let parts = Compare.align(m.text, m.typed)
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    Track(value: Double(s.index + 1) / Double(max(s.items.count, 1)))
                    HStack(spacing: 12) {
                        Artwork(url: m.artworkUrl.flatMap(URL.init(string:)), size: 44)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(m.episode).font(Theme.text(15, .medium)).foregroundStyle(Theme.ink).lineLimit(1)
                            Text("\(m.show) · sentence \(m.idx + 1) · \(Stats.clock(Double(m.startMs) / 1000))")
                                .font(Theme.text(13)).foregroundStyle(Theme.inkSubtle).lineLimit(1)
                        }
                    }
                    VStack(alignment: .leading, spacing: 14) {
                        Eyebrow("The sentence")
                        if s.revealed {
                            MissedWordsText(parts: parts.sentence.map { ($0.text, $0.marked) }, font: Theme.display(24, .medium))
                                .lineSpacing(6)
                                .accessibilityLabel(m.text)
                        } else {
                            Button { center.missedReveal() } label: {
                                HStack(spacing: 8) {
                                    Image(systemName: "eye")
                                    Text(settings.showText == .afterPlay ? "Shown after it plays · tap to show now" : "Tap to show the text")
                                }
                                .font(Theme.text(15)).foregroundStyle(Theme.inkSubtle)
                                .frame(maxWidth: .infinity, minHeight: 96)
                                .background(Theme.surface1, in: RoundedRectangle(cornerRadius: 12))
                                .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.hairline, style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    if let problem = center.missedProblem {
                        Note(problem)
                    }
                    if s.revealed, !m.typed.trimmingCharacters(in: .whitespaces).isEmpty {
                        VStack(alignment: .leading, spacing: 8) {
                            Eyebrow("You typed")
                            Text(MissedWordsText.attributed(parts.typed.map { ($0.text, $0.marked) }, color: Theme.inkMuted, wrong: true))
                                .font(Theme.text(16)).lineSpacing(4)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.top, 16)
                        .overlay(alignment: .top) { Rectangle().fill(Theme.hairline).frame(height: 1) }
                    }
                    HStack(spacing: 8) {
                        Image(systemName: "repeat")
                        Text(playStatus(s))
                    }
                    .font(Theme.text(13)).foregroundStyle(Theme.inkSubtle)
                }
                .padding(.horizontal, 20).padding(.top, 4).padding(.bottom, 24)
            }
            controls(s)
        }
    }

    private func playStatus(_ s: PlaybackCenter.MissedSession) -> String {
        let n = settings.repeats
        let ordinal = ["First", "Second", "Third", "Fourth"]
        let now = min(s.plays + (s.playing ? 1 : 0), n)
        if now == 0 { return n == 1 ? "Plays once, then the next one" : "Plays \(n) times, then the next one" }
        let which = ordinal[min(max(now - 1, 0), 3)]
        return now >= n ? "\(which) time · then the next one" : "\(which) time of \(n)"
    }

    private func controls(_ s: PlaybackCenter.MissedSession) -> some View {
        VStack(spacing: 22) {
            Segmented(items: [(Float(1), "1.0×"), (Float(0.85), "0.85×"), (Float(0.7), "0.7×")],
                      selection: Binding(get: { s.rate }, set: { center.missedSetRate($0) }), label: "Speed")
            HStack {
                IconButton(symbol: "backward.end.fill", label: "Previous sentence", size: 24) { center.missedPrevious() }
                    .disabled(s.index == 0)
                Spacer()
                IconButton(symbol: "arrow.counterclockwise", label: "Play again", size: 24) { center.missedReplay() }
                Spacer()
                BigPlayButton(playing: center.isPlaying) { center.togglePlayPause() }
                Spacer()
                IconButton(symbol: s.revealed ? "eye.slash" : "eye", label: s.revealed ? "Hide the text" : "Show the text", size: 22) {
                    center.missedReveal()
                }
                Spacer()
                IconButton(symbol: "forward.end.fill", label: "Next sentence", size: 24) { center.missedNext() }
            }
            .padding(.horizontal, 6)
        }
        .padding(.horizontal, 20).padding(.bottom, 20).padding(.top, 8)
    }
}

/// Every missed sentence, by episode (design P04). Ones whose audio the phone doesn't have are text only.
struct MissedListView: View {
    let asPage: Bool
    @Environment(RecordStore.self) private var store
    @Environment(PlaybackCenter.self) private var center
    @Environment(AppUI.self) private var ui
    @Environment(\.dismiss) private var dismiss
    @State private var filter = "all"

    var body: some View {
        let groups = MissedGroup.groups(store.missed)
        let shown = filter == "all" ? groups : groups.filter { $0.id == filter }
        let current = center.missed?.current
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                if groups.count > 1 {
                    ChipRow(items: [("all", "All \(store.missed.count)")] + groups.map { ($0.id, "\(short($0.ref.episode)) · \($0.items.count)") },
                            selection: $filter)
                }
                if groups.isEmpty {
                    Note("Nothing missed yet. Sentences you get wrong in dictation on your computer come here.")
                }
                ForEach(shown) { g in
                    let textOnly = g.items.contains { !center.playable($0) }
                    Block(g.ref.episode, trailing: {
                        if !textOnly { Button("Play") { play(g.items, from: 0) } }
                    }) {
                        RowGroup {
                            ForEach(Array(g.items.enumerated()), id: \.element.id) { i, m in
                                sentenceRow(m, current: m == current, textOnly: !center.playable(m)) { play(g.items, from: i) }
                            }
                        }
                        if textOnly {
                            Note("The episode on this phone isn't the same file as on the computer, so these have the text but no audio.")
                        }
                    }
                }
            }
            .padding(.horizontal, 16).padding(.top, 4).padding(.bottom, 40)
        }
        .canvas()
        .navigationTitle("Missed sentences")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Theme.canvas, for: .navigationBar)
        .toolbar {
            if !asPage {
                ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } }
            }
        }
    }

    private func play(_ items: [Missed], from i: Int) {
        if center.mode == .missed, let s = center.missed, let j = s.items.firstIndex(of: items[i]) {
            center.missedJump(to: j)
        } else {
            center.startMissed(items, at: i)
        }
        if asPage { ui.showMissed = true } else { dismiss() }
    }

    private func short(_ s: String) -> String { s.count > 22 ? String(s.prefix(20)) + "…" : s }

    private func sentenceRow(_ m: Missed, current: Bool, textOnly: Bool, play: @escaping () -> Void) -> some View {
        let parts = Compare.align(m.text, m.typed)
        return Button(action: play) {
            HStack(alignment: .top, spacing: 12) {
                Text("\(m.idx + 1)").font(Theme.mono(12)).foregroundStyle(Theme.inkSubtle).frame(width: 26, alignment: .leading).padding(.top, 3)
                VStack(alignment: .leading, spacing: 4) {
                    MissedWordsText(parts: parts.sentence.map { ($0.text, $0.marked) }, font: Theme.text(15))
                    if !m.typed.isEmpty {
                        Text(MissedWordsText.attributed(parts.typed.map { ($0.text, $0.marked) }, color: Theme.inkSubtle, wrong: true))
                            .font(Theme.text(13))
                    }
                    if textOnly {
                        Badge { Image(systemName: "textformat"); Text("Text only") }.padding(.top, 4)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(12)
            .background(current ? Theme.surface2 : .clear)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(textOnly)
        .accessibilityLabel("Sentence \(m.idx + 1): \(m.text)")
    }
}
