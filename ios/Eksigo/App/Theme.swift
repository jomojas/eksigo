import SwiftUI

/// The native iOS look (design canvas, iPhone v3): the system's own colours, so light, dark and Increase Contrast come
/// out right by themselves; plain content with soft grey groups and no outlines; Liquid Glass only on the controls the
/// system draws (tab bar, bars, the mini player); colour from the covers and one indigo accent for the main action.
enum Theme {
    /// The accent: the one main action of a screen, links, the selected tab.
    static let primary = Color(light: 0x5E5CE6, dark: 0x7D7AFF)
    static let primarySoft = Color(light: 0x5E5CE6, dark: 0x7D7AFF, opacity: (0.12, 0.20))
    static let onPrimary = Color.white
    static let canvas = Color(uiColor: .systemBackground)
    /// Groups of rows and cards on the canvas: a soft grey, no outline.
    static let surface1 = Color(uiColor: .secondarySystemBackground)
    static let surface2 = Color(uiColor: .tertiarySystemFill)
    static let surface3 = Color(uiColor: .secondarySystemFill)
    static let hairline = Color(uiColor: .separator)
    static let hairlineStrong = Color(uiColor: .separator)
    static let hairlineTertiary = Color(uiColor: .tertiaryLabel)
    static let ink = Color(uiColor: .label)
    static let inkMuted = Color(uiColor: .label).opacity(0.85)
    static let inkSubtle = Color(uiColor: .secondaryLabel)
    static let inkTertiary = Color(uiColor: .tertiaryLabel)
    static let success = Color(uiColor: .systemGreen)
    static let error = Color(uiColor: .systemRed)
    static let errorFill = Color(light: 0xFF3B30, dark: 0xFF453A, opacity: (0.12, 0.20))
    /// The missed words in a sentence: a highlighter yellow.
    static let missFill = Color(light: 0xFFD60A, dark: 0xFFD60A, opacity: (0.45, 0.32))
    static let warm = Color(uiColor: .systemOrange)
    /// Missed sentences have their own colour: the card on Listen, the missed player.
    static let missedGradient = LinearGradient(colors: [Color(hex: 0x6D5CF0), Color(hex: 0xA35CF0), Color(hex: 0xE070C4)],
                                               startPoint: .topLeading, endPoint: .bottomTrailing)
    static let missedInk = Color(hex: 0x5B4AE0)

    /// Group corners (iOS 26 inset groups are rounder than before).
    static let radius: CGFloat = 22

    static func display(_ size: CGFloat, _ weight: Font.Weight = .bold) -> Font { .system(size: size, weight: weight) }
    static func text(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font { .system(size: size, weight: weight) }
    /// Times and counts: the system font with digits that don't jump, not a typewriter face.
    static func mono(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font { .system(size: size, weight: weight).monospacedDigit() }
}

extension Color {
    init(hex: UInt32, opacity: Double = 1) {
        self.init(.sRGB, red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255,
                  blue: Double(hex & 0xFF) / 255, opacity: opacity)
    }

    /// A colour for each appearance.
    init(light: UInt32, dark: UInt32, opacity: (Double, Double) = (1, 1)) {
        self.init(dynamicColor(light: light, dark: dark, opacity: opacity))
    }
}

/// SwiftUI resolves colours on its render thread too, so the provider must not be tied to the main actor.
nonisolated private func dynamicColor(light: UInt32, dark: UInt32, opacity: (Double, Double)) -> UIColor {
    UIColor { @Sendable traits in
        let isDark = traits.userInterfaceStyle == .dark
        let v = isDark ? dark : light
        return UIColor(red: CGFloat((v >> 16) & 0xFF) / 255, green: CGFloat((v >> 8) & 0xFF) / 255,
                       blue: CGFloat(v & 0xFF) / 255, alpha: isDark ? opacity.1 : opacity.0)
    }
}
