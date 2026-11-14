import SwiftUI

/// A button shown when a row is swiped left (design P26).
struct SwipeAction: Identifiable {
    let title: String
    let symbol: String
    var background: Color = Theme.surface3
    var foreground: Color = Theme.ink
    let run: () -> Void
    var id: String { title }
}

/// Swipe left on a row in our own row groups (they aren't system lists) to show its actions. A tap on the row while
/// they show closes them. VoiceOver gets the same actions from the rotor.
struct Swipeable<Content: View>: View {
    let actions: [SwipeAction]
    @ViewBuilder var content: Content
    @State private var offset: CGFloat = 0
    @State private var settled: CGFloat = 0
    @State private var dragging: Bool?

    private let width: CGFloat = 76
    private var total: CGFloat { width * CGFloat(actions.count) }

    var body: some View {
        ZStack(alignment: .trailing) {
            HStack(spacing: 0) {
                ForEach(actions) { a in
                    Button {
                        close()
                        a.run()
                    } label: {
                        VStack(spacing: 5) {
                            Image(systemName: a.symbol).font(.system(size: 18, weight: .medium))
                            Text(a.title).font(Theme.text(12, .medium)).lineLimit(1).minimumScaleFactor(0.8)
                        }
                        .foregroundStyle(a.foreground)
                        .frame(width: width).frame(maxHeight: .infinity)
                        .background(a.background)
                    }
                    .buttonStyle(.plain)
                }
            }
            .opacity(offset < 0 ? 1 : 0)
            .accessibilityHidden(true)

            content
                .background(Theme.surface1)
                // A sideways drag mustn't end as a tap on the row (it would open it).
                .disabled(dragging == true || settled < 0)
                .overlay {
                    // Moves with the row, so the buttons beside it stay tappable.
                    if settled < 0 {
                        Color.clear.contentShape(Rectangle()).onTapGesture { close() }
                    }
                }
                .offset(x: offset)
        }
        .clipped()
        .simultaneousGesture(
            DragGesture(minimumDistance: 16)
                .onChanged { v in
                    // Decided once per drag: sideways moves the row, up and down is left to the scroll view.
                    if dragging == nil { dragging = abs(v.translation.width) > abs(v.translation.height) * 1.4 }
                    guard dragging == true else { return }
                    let x = settled + v.translation.width
                    offset = x < -total ? -total + (x + total) / 4 : min(0, x)
                }
                .onEnded { v in
                    defer { dragging = nil }
                    guard dragging == true else { return }
                    let open = settled + v.predictedEndTranslation.width < -total / 2
                    withAnimation(.snappy(duration: 0.25)) { offset = open ? -total : 0 }
                    settled = open ? -total : 0
                }
        )
        .accessibilityActions {
            ForEach(actions) { a in Button(a.title, action: a.run) }
        }
    }

    private func close() {
        withAnimation(.snappy(duration: 0.25)) { offset = 0 }
        settled = 0
    }
}
