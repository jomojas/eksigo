import SwiftUI

// The pieces every screen is made of (design canvas P01–P22): titles, grouped rows, cards, buttons, badges.

struct LargeTitle: View {
    let text: String
    init(_ text: String) { self.text = text }
    var body: some View {
        Text(text).font(Theme.display(34)).tracking(0.37).foregroundStyle(Theme.ink)
            .accessibilityAddTraits(.isHeader)
    }
}

struct Eyebrow: View {
    let text: String
    init(_ text: String) { self.text = text }
    var body: some View {
        Text(text).font(Theme.text(13, .medium)).tracking(0.3).foregroundStyle(Theme.inkSubtle)
    }
}

/// A section: a small title, maybe a link on the right, then its content.
struct Block<Content: View, Trailing: View>: View {
    let title: String
    @ViewBuilder var trailing: Trailing
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text(title).font(Theme.display(22)).tracking(0.35).foregroundStyle(Theme.ink).accessibilityAddTraits(.isHeader)
                Spacer(minLength: 8)
                trailing.font(Theme.text(17)).foregroundStyle(Theme.primary)
            }
            content
        }
    }
}

extension Block where Trailing == EmptyView {
    init(_ title: String, @ViewBuilder content: () -> Content) {
        self.title = title
        trailing = EmptyView()
        self.content = content()
    }
}

extension Block {
    init(_ title: String, @ViewBuilder trailing: () -> Trailing, @ViewBuilder content: () -> Content) {
        self.title = title
        self.trailing = trailing()
        self.content = content()
    }
}

extension EnvironmentValues {
    /// The fill of grouped rows and cards. The player, on its cover colour, uses a see-through white instead of grey.
    @Entry var groupFill: Color = Theme.surface1
}

/// Rows in one rounded box, with a hairline between them.
struct RowGroup<Content: View>: View {
    @Environment(\.groupFill) private var fill
    @ViewBuilder var content: Content
    var body: some View {
        VStack(spacing: 0) {
            Group(subviews: content) { rows in
                ForEach(Array(rows.enumerated()), id: \.offset) { i, row in
                    row
                    if i < rows.count - 1 { Rectangle().fill(Theme.hairline).frame(height: 0.5).padding(.leading, 16) }
                }
            }
        }
        .background(fill)
        .clipShape(RoundedRectangle(cornerRadius: Theme.radius, style: .continuous))
    }
}

/// A row: something on the left, a title and a line under it, something on the right, maybe a chevron.
struct Row<Leading: View, Trailing: View>: View {
    var title: String
    var subtitle: String? = nil
    var chevron = false
    var titleColor: Color = Theme.ink
    @ViewBuilder var leading: Leading
    @ViewBuilder var trailing: Trailing

    var body: some View {
        HStack(spacing: 12) {
            leading
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(Theme.text(17)).foregroundStyle(titleColor).lineLimit(1)
                if let subtitle, !subtitle.isEmpty {
                    Text(subtitle).font(Theme.text(14)).foregroundStyle(Theme.inkSubtle).lineLimit(2)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            trailing
            if chevron {
                Image(systemName: "chevron.right").font(.system(size: 14, weight: .semibold)).foregroundStyle(Theme.inkTertiary)
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 11)
        .frame(minHeight: 52)
        .contentShape(Rectangle())
    }
}

extension Row where Leading == EmptyView, Trailing == EmptyView {
    init(_ title: String, subtitle: String? = nil, chevron: Bool = false, titleColor: Color = Theme.ink) {
        self.init(title: title, subtitle: subtitle, chevron: chevron, titleColor: titleColor, leading: { EmptyView() }, trailing: { EmptyView() })
    }
}

extension Row where Leading == EmptyView {
    init(_ title: String, subtitle: String? = nil, chevron: Bool = false, @ViewBuilder trailing: () -> Trailing) {
        self.init(title: title, subtitle: subtitle, chevron: chevron, leading: { EmptyView() }, trailing: trailing)
    }
}

/// The value on the right of a settings row.
struct RowValue: View {
    let text: String
    init(_ text: String) { self.text = text }
    var body: some View { Text(text).font(Theme.text(17)).foregroundStyle(Theme.inkSubtle).lineLimit(1) }
}

/// A small square with an icon, at the start of a row.
struct IconTile: View {
    let symbol: String
    var color: Color
    init(_ symbol: String, color: Color = Color(uiColor: .systemGray)) { self.symbol = symbol; self.color = color }
    var body: some View {
        Image(systemName: symbol).font(.system(size: 15, weight: .semibold)).foregroundStyle(.white)
            .frame(width: 30, height: 30)
            .background(color, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .accessibilityHidden(true)
    }
}

struct CardModifier: ViewModifier {
    var padding: CGFloat = 16
    @Environment(\.groupFill) private var fill
    func body(content: Content) -> some View {
        content.padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(fill, in: RoundedRectangle(cornerRadius: Theme.radius, style: .continuous))
    }
}

extension View {
    func card(padding: CGFloat = 16) -> some View { modifier(CardModifier(padding: padding)) }

    /// The page's background, edge to edge.
    func canvas() -> some View { background(Theme.canvas.ignoresSafeArea()) }
}

// MARK: Buttons

struct EksButtonStyle: ButtonStyle {
    enum Kind { case primary, secondary, ghost, inverse }
    var kind: Kind = .secondary
    var small = false
    var block = false
    var height: CGFloat? = nil

    func makeBody(configuration: Configuration) -> some View {
        StyledButton(configuration: configuration, style: self)
    }

    private struct StyledButton: View {
        let configuration: Configuration
        let style: EksButtonStyle
        @Environment(\.isEnabled) private var enabled
        var body: some View {
            style.styled(configuration).opacity(enabled ? 1 : 0.45)
        }
    }

    fileprivate func styled(_ configuration: Configuration) -> some View {
        configuration.label
            .font(Theme.text(small ? 15 : 17, .semibold))
            .lineLimit(1)
            .padding(.horizontal, small ? 14 : 20)
            .frame(maxWidth: block ? .infinity : nil)
            .frame(height: height ?? (small ? 34 : 50))
            .foregroundStyle(foreground)
            .background(background, in: Capsule())
            .opacity(configuration.isPressed ? 0.7 : 1)
            .contentShape(Capsule())
    }

    private var foreground: Color {
        switch kind {
        case .primary: Theme.onPrimary
        case .secondary: Theme.primary
        case .ghost: Theme.primary
        case .inverse: Theme.canvas
        }
    }

    private var background: Color {
        switch kind {
        case .primary: Theme.primary
        case .secondary: Theme.primarySoft
        case .ghost: .clear
        case .inverse: Theme.ink
        }
    }
}

extension ButtonStyle where Self == EksButtonStyle {
    static func eks(_ kind: EksButtonStyle.Kind = .secondary, small: Bool = false, block: Bool = false, height: CGFloat? = nil) -> EksButtonStyle {
        EksButtonStyle(kind: kind, small: small, block: block, height: height)
    }
}

/// A round button with an icon (play, download), 40 pt like the canvas, with a 44 pt touch area.
struct RoundButton: View {
    let symbol: String
    let label: String
    var size: CGFloat = 40
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: symbol).font(.system(size: size * 0.36, weight: .semibold))
                .foregroundStyle(Theme.primary)
                .frame(width: size * 0.82, height: size * 0.82)
                .background(Theme.surface2, in: Circle())
                .frame(width: max(size, 44), height: max(size, 44))
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }
}

/// A big round control in the players: ink on the canvas.
struct BigPlayButton: View {
    let playing: Bool
    var size: CGFloat = 68
    var action: () -> Void
    var body: some View {
        Button(action: action) {
            Image(systemName: playing ? "pause.fill" : "play.fill").font(.system(size: size * 0.38))
                .foregroundStyle(.white)
                .frame(width: size, height: size)
                .background(Theme.primary, in: Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(playing ? "Pause" : "Play")
    }
}

struct IconButton: View {
    let symbol: String
    let label: String
    var size: CGFloat = 22
    var color: Color = Theme.ink
    var action: () -> Void
    var body: some View {
        Button(action: action) {
            Image(systemName: symbol).font(.system(size: size, weight: .regular)).foregroundStyle(color)
                .frame(width: 44, height: 44).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }
}

// MARK: Small things

struct Dot: View {
    var color: Color = Theme.inkSubtle
    var body: some View { Circle().fill(color).frame(width: 7, height: 7).accessibilityHidden(true) }
}

struct Badge<Content: View>: View {
    @ViewBuilder var content: Content
    var body: some View {
        HStack(spacing: 6) { content }
            .font(Theme.text(12, .semibold)).foregroundStyle(Theme.inkSubtle)
            .padding(.horizontal, 8).frame(height: 22)
            .background(Theme.surface2, in: Capsule())
    }
}

struct Track: View {
    var value: Double
    var height: CGFloat = 4
    var fill: Color = Theme.primary
    var body: some View {
        GeometryReader { g in
            ZStack(alignment: .leading) {
                Capsule().fill(Theme.surface3)
                Capsule().fill(fill).frame(width: g.size.width * min(max(value, 0), 1))
            }
        }
        .frame(height: height)
        .accessibilityElement()
        .accessibilityValue("\(Int(min(max(value, 0), 1) * 100)) percent")
    }
}

struct Chip: View {
    let text: String
    var on = false
    var action: () -> Void
    var body: some View {
        Button(action: action) {
            Text(text).font(Theme.text(15, on ? .semibold : .medium)).lineLimit(1)
                .foregroundStyle(on ? Theme.canvas : Theme.ink)
                .padding(.horizontal, 14).frame(height: 34)
                .background(on ? Theme.ink : Theme.surface2, in: Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

/// A row of chips that scrolls sideways.
struct ChipRow<Value: Hashable>: View {
    let items: [(Value, String)]
    @Binding var selection: Value
    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(items, id: \.0) { value, label in
                    Chip(text: label, on: value == selection) { selection = value }
                }
            }
            .padding(.horizontal, 16)
        }
        .padding(.horizontal, -16)
    }
}

/// The segmented control of the canvas.
struct Segmented<Value: Hashable>: View {
    let items: [(Value, String)]
    @Binding var selection: Value
    var label: String = ""
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        HStack(spacing: 2) {
            ForEach(items, id: \.0) { value, text in
                let on = value == selection
                Button { selection = value } label: {
                    Text(text).font(Theme.text(14, on ? .semibold : .medium)).foregroundStyle(Theme.ink)
                        .frame(maxWidth: .infinity).frame(height: 30)
                        .background(on ? (scheme == .dark ? Color.white.opacity(0.28) : Color.white) : .clear, in: Capsule())
                        .shadow(color: .black.opacity(on ? 0.12 : 0), radius: 4, y: 1)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(on ? .isSelected : [])
            }
        }
        .padding(2)
        .background(scheme == .dark ? Color.white.opacity(0.12) : Theme.surface2, in: Capsule())
        .accessibilityElement(children: .contain)
        .accessibilityLabel(label)
    }
}

/// Figures side by side in one box.
struct Cells: View {
    let items: [(String, String)]
    var small = false
    var body: some View {
        HStack(spacing: 10) {
            ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                VStack(alignment: .leading, spacing: 4) {
                    Text(item.0).font(Theme.display(small ? 20 : 26)).foregroundStyle(Theme.ink)
                        .lineLimit(1).minimumScaleFactor(0.6)
                    Text(item.1).font(Theme.text(13)).foregroundStyle(Theme.inkSubtle).lineLimit(1)
                }
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Theme.surface1, in: RoundedRectangle(cornerRadius: Theme.radius, style: .continuous))
                .accessibilityElement(children: .combine)
            }
        }
    }
}

/// A sentence with some words marked: the missed words, or the gap to recall, on a soft fill with a dashed line.
struct MissedWordsText: View {
    let parts: [(String, Bool)]
    var font: Font = Theme.display(24, .medium)
    var color: Color = Theme.ink

    var body: some View { Text(Self.attributed(parts, color: color)).font(font) }

    static func attributed(_ parts: [(String, Bool)], color: Color = Theme.ink, marked: Color = Theme.ink, wrong: Bool = false) -> AttributedString {
        var out = AttributedString()
        for (text, isMarked) in parts {
            var a = AttributedString(text)
            a.foregroundColor = isMarked ? (wrong ? Theme.error : marked) : color
            if isMarked {
                a.backgroundColor = wrong ? Theme.errorFill : Theme.missFill
                if wrong { a.strikethroughStyle = Text.LineStyle(pattern: .solid, color: Theme.error) }
            }
            out += a
        }
        return out
    }
}

/// A small note under a section.
struct Note: View {
    let text: String
    init(_ text: String) { self.text = text }
    var body: some View {
        Text(text).font(Theme.text(13)).lineSpacing(2).foregroundStyle(Theme.inkSubtle).padding(.horizontal, 4)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// The bar at the top of pushed pages: back (or close), a title, maybe an action.
struct NavBar<Trailing: View>: View {
    var title: String = ""
    var close = false
    /// A small grey title (the player's show name) instead of the page's name.
    var quiet = false
    var onBack: () -> Void
    @ViewBuilder var trailing: Trailing

    var body: some View {
        HStack(spacing: 4) {
            GlassCircleButton(symbol: close ? "chevron.down" : "chevron.left", label: close ? "Close" : "Back", action: onBack)
            Text(title).font(quiet ? Theme.text(13, .semibold) : Theme.text(17, .semibold))
                .foregroundStyle(quiet ? Theme.inkSubtle : Theme.ink).lineLimit(1)
                .frame(maxWidth: .infinity)
            trailing.frame(minWidth: 44)
        }
        .padding(.horizontal, 16)
        .frame(height: 52)
    }
}

/// A round glass button for a bar the system doesn't draw (the players, a card session). On iOS 26 it is Liquid
/// Glass; before that, a thin material.
struct GlassCircleButton: View {
    let symbol: String
    let label: String
    var tint: Color? = nil
    var action: () -> Void
    var body: some View {
        Button(action: action) {
            Image(systemName: symbol).font(.system(size: 17, weight: .semibold))
                .foregroundStyle(tint ?? Theme.ink)
                .frame(width: 44, height: 44)
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .glassCircle()
        .accessibilityLabel(label)
    }
}

extension View {
    /// Liquid Glass in a circle from iOS 26, a material before.
    @ViewBuilder func glassCircle() -> some View {
        if #available(iOS 26.0, *) {
            glassEffect(.regular.interactive(), in: Circle())
        } else {
            background(.ultraThinMaterial, in: Circle())
        }
    }

    /// Liquid Glass in a capsule from iOS 26, a material before.
    @ViewBuilder func glassCapsule() -> some View {
        if #available(iOS 26.0, *) {
            glassEffect(.regular.interactive(), in: Capsule())
        } else {
            background(.ultraThinMaterial, in: Capsule())
        }
    }
}

extension NavBar where Trailing == Color {
    init(title: String = "", close: Bool = false, onBack: @escaping () -> Void) {
        self.init(title: title, close: close, onBack: onBack) { Color.clear }
    }
}

/// A pushed page: the system's bar, in the canvas colours, with an inline title; its content scrolls under it.
struct Page<Content: View, Trailing: View>: View {
    var title: String = ""
    @ViewBuilder var trailing: Trailing
    @ViewBuilder var content: Content

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) { content }
                .padding(.horizontal, 16).padding(.top, 4).padding(.bottom, 120)
        }
        .canvas()
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(title.isEmpty ? .inline : .large)
        .toolbar { ToolbarItem(placement: .topBarTrailing) { trailing } }
    }
}

extension Page where Trailing == EmptyView {
    init(title: String = "", @ViewBuilder content: () -> Content) {
        self.title = title
        trailing = EmptyView()
        self.content = content()
    }
}

/// An episode as a big cover with its title and a line under it (Up Next on Listen).
struct CoverTile: View {
    let episode: PodcastEpisode
    var size: CGFloat = 150
    var subtitle: String = ""
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Artwork(episode: episode, size: size, radius: 12)
            VStack(alignment: .leading, spacing: 1) {
                Text(episode.title).font(Theme.text(14, .medium)).foregroundStyle(Theme.ink).lineLimit(1)
                if !subtitle.isEmpty {
                    Text(subtitle).font(Theme.text(13)).foregroundStyle(Theme.inkSubtle).lineLimit(1)
                }
            }
        }
        .frame(width: size, alignment: .leading)
        .contentShape(Rectangle())
    }
}
