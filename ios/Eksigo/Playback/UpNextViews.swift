import SwiftUI

/// Up Next (design P30): what plays now, then the list in order. Drag to reorder, swipe to remove, Clear empties it.
/// A sheet from the player, or a page from Listen's "See all".
struct UpNextView: View {
    var asPage = false
    @Environment(PlaybackCenter.self) private var center
    @Environment(\.dismiss) private var dismiss
    @State private var confirmClear = false

    var body: some View {
        VStack(spacing: 0) {
            if !asPage {
                HStack {
                    Text("Up Next").font(Theme.display(20)).tracking(-0.3).foregroundStyle(Theme.ink)
                    Spacer()
                    clearButton
                }
                .padding(.horizontal, 16).padding(.top, 20).padding(.bottom, 4)
            }
            List {
                if let e = center.episode, center.mode != .missed {
                    Section {
                        row(e, subtitle: "\(e.showTitle) · \(Stats.length(max(60, center.duration - center.position))) left") {
                            Image(systemName: center.isPlaying ? "pause.fill" : "play.fill").font(.system(size: 15))
                                .foregroundStyle(Theme.inkSubtle).frame(width: 30)
                        }
                        .contentShape(Rectangle())
                        .onTapGesture { center.togglePlayPause() }
                        .accessibilityAddTraits(.isButton)
                        .accessibilityHint(center.isPlaying ? "Pauses" : "Plays")
                    } header: { header("Now playing") }
                }
                Section {
                    if center.queue.isEmpty {
                        Text("Nothing yet. Swipe an episode left, or tap Up Next on an episode, to add it here.")
                            .font(Theme.text(14)).foregroundStyle(Theme.inkSubtle).listRowBackground(Theme.surface1)
                    }
                    ForEach(center.queue) { e in
                        row(e, subtitle: [e.showTitle, e.duration.map(Stats.length)].compactMap { $0 }.joined(separator: " · ")) {
                            // Long-press and drag to reorder (no edit mode, so swipe to remove still works).
                            Image(systemName: "line.3.horizontal").font(.system(size: 15)).foregroundStyle(Theme.inkTertiary)
                                .accessibilityHidden(true)
                        }
                            .contentShape(Rectangle())
                            .onTapGesture { center.play(e) }
                            .accessibilityAddTraits(.isButton)
                            .accessibilityHint("Plays it now")
                            .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                                Button("Remove", systemImage: "trash", role: .destructive) { center.removeFromQueue(e.key) }
                            }
                    }
                    .onMove { center.moveQueue(from: $0, to: $1) }
                } header: {
                    header(center.queue.isEmpty ? "Then" : "Then · \(plural(center.queue.count, "episode")), \(Stats.length(center.queueSeconds))")
                } footer: {
                    Text("Hold and drag to reorder. Each episode leaves the list when it starts. When the list is empty, playback stops after the current episode.")
                        .font(Theme.text(12)).foregroundStyle(Theme.inkSubtle).padding(.top, 6)
                }
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
        }
        .canvas()
        .navigationTitle(asPage ? "Up Next" : "")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { if asPage { ToolbarItem(placement: .topBarTrailing) { clearButton } } }
        .confirmationDialog("Clear Up Next?", isPresented: $confirmClear, titleVisibility: .visible) {
            Button("Clear \(plural(center.queue.count, "episode"))", role: .destructive) { center.clearQueue() }
        }
    }

    private var clearButton: some View {
        Button("Clear") { confirmClear = true }
            .buttonStyle(.eks(.ghost, small: true))
            .disabled(center.queue.isEmpty)
    }

    private func header(_ text: String) -> some View {
        Text(text).font(Theme.text(13, .medium)).tracking(0.3).foregroundStyle(Theme.inkSubtle).textCase(nil)
    }

    private func row<T: View>(_ e: PodcastEpisode, subtitle: String, @ViewBuilder trailing: () -> T) -> some View {
        HStack(spacing: 12) {
            Artwork(episode: e, size: 44)
            VStack(alignment: .leading, spacing: 2) {
                Text(e.title).font(Theme.text(15, .medium)).foregroundStyle(Theme.ink).lineLimit(1)
                Text(subtitle).font(Theme.text(13)).foregroundStyle(Theme.inkSubtle).lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            trailing()
        }
        .listRowBackground(Theme.surface1)
        .listRowSeparatorTint(Theme.hairline)
    }
}
