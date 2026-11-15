import SwiftUI

/// The few settings there are (design P21), kept on the phone.
@Observable
final class AppSettings {
    enum Appearance: String, CaseIterable, Identifiable {
        case system, light, dark
        var id: String { rawValue }
        var label: String { rawValue.capitalized }
        var scheme: ColorScheme? { self == .light ? .light : self == .dark ? .dark : nil }
    }

    @ObservationIgnored private let defaults: UserDefaults

    var speed: Float { didSet { defaults.set(speed, forKey: "speed") } }
    var skipBack: Double { didSet { defaults.set(skipBack, forKey: "skipBack") } }
    var skipForward: Double { didSet { defaults.set(skipForward, forKey: "skipForward") } }
    var appearance: Appearance { didSet { defaults.set(appearance.rawValue, forKey: "appearance") } }

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        defaults.register(defaults: ["speed": 1.0, "skipBack": 15.0, "skipForward": 30.0])
        speed = defaults.float(forKey: "speed")
        skipBack = defaults.double(forKey: "skipBack")
        skipForward = defaults.double(forKey: "skipForward")
        appearance = Appearance(rawValue: defaults.string(forKey: "appearance") ?? "") ?? .system
    }

    static let speeds: [Float] = [0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.5]
}

extension Float {
    /// "1.0×", "0.85×".
    var speedText: String {
        let s = String(format: "%.2f", self)
        return (s.hasSuffix("0") ? String(s.dropLast()) : s) + "×"
    }
}
