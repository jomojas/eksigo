import SwiftUI

/// The Linear style the desktop uses (design canvas, "Shared style"): a near-black canvas, a ladder of surfaces with
/// hairlines instead of shadows, and one lavender accent kept for the main action of a screen. The light theme is
/// the desktop's. Inter isn't bundled: the system font stands in, as on the desktop's fallback stack.
enum Theme {
    static let primary = Color(hex: 0x5E6AD2)
    /// The text on `primary` (the canvas has it a soft grey rather than white).
    static let onPrimary = Color(light: 0xD2D2D9, dark: 0xD2D2D9)
    static let canvas = Color(light: 0xFCFCFD, dark: 0x010102)
    static let surface1 = Color(light: 0xF5F5F7, dark: 0x0F1011)
    static let surface2 = Color(light: 0xEFEFF2, dark: 0x141516)
    static let surface3 = Color(light: 0xE9E9ED, dark: 0x18191A)
    static let hairline = Color(light: 0xE3E3E8, dark: 0x23252A)
    static let hairlineStrong = Color(light: 0xD2D2D9, dark: 0x34343A)
    static let hairlineTertiary = Color(light: 0xC2C2CA, dark: 0x3E3E44)
    static let ink = Color(light: 0x121316, dark: 0xF7F8F8)
    static let inkMuted = Color(light: 0x3A3D44, dark: 0xD0D6E0)
    static let inkSubtle = Color(light: 0x62666F, dark: 0x8A8F98)
    static let inkTertiary = Color(light: 0x9A9DA5, dark: 0x62666D)
    static let success = Color(light: 0x1F8A3A, dark: 0x27A644)
    static let error = Color(light: 0xD33F45, dark: 0xEB5757)
    static let errorFill = Color(light: 0xD33F45, dark: 0xEB5757, opacity: (0.10, 0.14))
    static let missFill = Color(light: 0x121316, dark: 0xFFFFFF, opacity: (0.07, 0.08))

    static func display(_ size: CGFloat, _ weight: Font.Weight = .semibold) -> Font { .system(size: size, weight: weight) }
    static func text(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font { .system(size: size, weight: weight) }
    static func mono(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font { .system(size: size, weight: weight, design: .monospaced) }
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
