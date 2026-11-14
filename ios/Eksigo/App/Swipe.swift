import SwiftUI

/// A button shown when a row is swiped left (design P26).
struct SwipeAction: Identifiable {
    let title: String
    let symbol: String
    var background: Color = Theme.primary
    var foreground: Color = .white
    let run: () -> Void
    var id: String { title }
}

/// Swipe left on a row in our own row groups (they aren't system lists) to show its actions. A tap on the row while
/// they show closes them. VoiceOver gets the same actions from the rotor.
struct Swipeable<Content: View>: View {
    let actions: [SwipeAction]
    var background: Color = Theme.surface1
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
                .background(background)
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
        // A UIKit pan that starts only for a sideways move, so an up-and-down drag is the scroll view's from the
        // first touch (a SwiftUI drag gesture here held the scroll back).
        .gesture(SidewaysPan(
            began: { dragging = true },
            changed: { dx in
                let x = settled + dx
                offset = x < -total ? -total + (x + total) / 4 : min(0, x)
            },
            ended: { predicted in
                defer { dragging = nil }
                let open = settled + predicted < -total / 2
                withAnimation(.snappy(duration: 0.25)) { offset = open ? -total : 0 }
                settled = open ? -total : 0
            }))
        .accessibilityActions {
            ForEach(actions) { a in Button(a.title, action: a.run) }
        }
    }

    private func close() {
        withAnimation(.snappy(duration: 0.25)) { offset = 0 }
        settled = 0
    }
}

/// A pan that begins only when the finger moves more sideways than up or down.
struct SidewaysPan: UIGestureRecognizerRepresentable {
    var began: () -> Void
    var changed: (CGFloat) -> Void
    /// Where the move would end, with its speed.
    var ended: (CGFloat) -> Void

    func makeCoordinator(converter: CoordinateSpaceConverter) -> Coordinator { Coordinator() }

    func makeUIGestureRecognizer(context: Context) -> UIPanGestureRecognizer {
        let g = UIPanGestureRecognizer()
        g.delegate = context.coordinator
        return g
    }

    func handleUIGestureRecognizerAction(_ g: UIPanGestureRecognizer, context: Context) {
        let dx = g.translation(in: g.view).x
        switch g.state {
        case .began: began(); changed(dx)
        case .changed: changed(dx)
        case .ended, .cancelled, .failed: ended(dx + g.velocity(in: g.view).x * 0.2)
        default: break
        }
    }

    final class Coordinator: NSObject, UIGestureRecognizerDelegate {
        func gestureRecognizerShouldBegin(_ g: UIGestureRecognizer) -> Bool {
            guard let pan = g as? UIPanGestureRecognizer else { return true }
            let v = pan.velocity(in: pan.view)
            return abs(v.x) > abs(v.y) * 1.4
        }
    }
}
