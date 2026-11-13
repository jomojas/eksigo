import SwiftUI

/// The few settings there are (design P21), kept on the phone.
@Observable
final class AppSettings {
    enum ShowText: String, CaseIterable, Identifiable {
        case afterPlay, always, never
        var id: String { rawValue }
        var label: String {
            switch self {
            case .afterPlay: "After it plays"
            case .always: "While it plays"
            case .never: "Only when I ask"
            }
        }
    }

    enum Appearance: String, CaseIterable, Identifiable {
        case system, light, dark
        var id: String { rawValue }
        var label: String { rawValue.capitalized }
        var scheme: ColorScheme? { self == .light ? .light : self == .dark ? .dark : nil }
    }

    @ObservationIgnored private let defaults: UserDefaults

    /// How many times each missed sentence plays before the next one.
    var repeats: Int { didSet { defaults.set(repeats, forKey: "repeats") } }
    var showText: ShowText { didSet { defaults.set(showText.rawValue, forKey: "showText") } }
    /// Seconds of quiet between plays.
    var gap: Double { didSet { defaults.set(gap, forKey: "gap") } }
    var speed: Float { didSet { defaults.set(speed, forKey: "speed") } }
    var skipBack: Double { didSet { defaults.set(skipBack, forKey: "skipBack") } }
    var skipForward: Double { didSet { defaults.set(skipForward, forKey: "skipForward") } }
    /// Episodes with missed sentences are downloaded by themselves, so they play without a connection.
    var downloadMissed: Bool { didSet { defaults.set(downloadMissed, forKey: "downloadMissed") } }
    var wifiOnly: Bool { didSet { defaults.set(wifiOnly, forKey: "wifiOnly") } }
    var appearance: Appearance { didSet { defaults.set(appearance.rawValue, forKey: "appearance") } }

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        defaults.register(defaults: ["repeats": 2, "gap": 2.0, "speed": 1.0, "skipBack": 15.0, "skipForward": 30.0,
                                     "downloadMissed": true, "wifiOnly": true])
        repeats = defaults.integer(forKey: "repeats")
        showText = ShowText(rawValue: defaults.string(forKey: "showText") ?? "") ?? .afterPlay
        gap = defaults.double(forKey: "gap")
        speed = defaults.float(forKey: "speed")
        skipBack = defaults.double(forKey: "skipBack")
        skipForward = defaults.double(forKey: "skipForward")
        downloadMissed = defaults.bool(forKey: "downloadMissed")
        wifiOnly = defaults.bool(forKey: "wifiOnly")
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
