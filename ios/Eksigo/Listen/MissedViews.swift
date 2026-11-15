import SwiftUI

/// Every missed sentence, by episode (design P04), to read: the sentence with the missed words boxed, and what was
/// typed with the wrong words in red. Listening to them again is on the computer, which has the episode's own file.
struct MissedListView: View {
    let asPage: Bool
    /// Only this episode's (its audio address), when opened from the episode or the player.
    var only: String? = nil
    @Environment(RecordStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var filter = "all"

    var body: some View {
        let all = MissedGroup.groups(store.missed)
        let groups = only.map { o in all.filter { $0.id == o } } ?? all
        let shown = filter == "all" ? groups : groups.filter { $0.id == filter }
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                if groups.count > 1 {
                    ChipRow(items: [("all", "All \(groups.reduce(0) { $0 + $1.items.count })")] + groups.map { ($0.id, "\(short($0.ref.episode)) · \($0.items.count)") },
                            selection: $filter)
                }
                if groups.isEmpty {
                    Note("Nothing missed yet. The sentences you get wrong in dictation on your computer come here.")
                }
                ForEach(shown) { g in
                    Block(g.ref.episode) {
                        RowGroup {
                            ForEach(g.items) { m in sentenceRow(m) }
                        }
                    }
                }
                if !groups.isEmpty {
                    Note("To hear them again, open the episode on your computer.")
                }
            }
            .padding(.horizontal, 16).padding(.top, 4).padding(.bottom, 40)
        }
        .canvas()
        .navigationTitle("Missed")
        .navigationBarTitleDisplayMode(asPage ? .large : .inline)
        .toolbar {
            if !asPage {
                ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } }
            }
        }
    }

    private func short(_ s: String) -> String { s.count > 22 ? String(s.prefix(20)) + "…" : s }

    private func sentenceRow(_ m: Missed) -> some View {
        let parts = Compare.align(m.text, m.typed)
        return HStack(alignment: .top, spacing: 12) {
            Text("\(m.idx + 1)").font(Theme.mono(12)).foregroundStyle(Theme.inkSubtle).frame(width: 26, alignment: .leading).padding(.top, 3)
            VStack(alignment: .leading, spacing: 6) {
                MissedWordsText(parts: parts.sentence.map { ($0.text, $0.marked) }, font: Theme.text(16))
                if m.typed.isEmpty {
                    Text("Nothing typed").font(Theme.text(13)).foregroundStyle(Theme.inkSubtle)
                } else {
                    Text(MissedWordsText.attributed(parts.typed.map { ($0.text, $0.marked) }, color: Theme.inkSubtle, wrong: true))
                        .font(Theme.text(14))
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(12)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Sentence \(m.idx + 1): \(m.text). You typed: \(m.typed.isEmpty ? "nothing" : m.typed)")
    }
}
