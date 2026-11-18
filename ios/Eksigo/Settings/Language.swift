import Foundation
import ObjectiveC

/// The language the app is shown in: the phone's own, or one picked in Settings. English is the source; the other
/// languages are in Localizable.xcstrings, keyed by the English text.
nonisolated enum AppLanguage: String, CaseIterable, Identifiable {
    case system
    case english = "en"
    case chinese = "zh-Hans"
    case japanese = "ja"
    case korean = "ko"
    case french = "fr"
    case spanish = "es"

    var id: String { rawValue }

    /// Each language in its own words, so a learner who can't read the current one still finds theirs.
    var label: String {
        switch self {
        case .system: L("Same as the phone")
        case .english: "English"
        case .chinese: "简体中文"
        case .japanese: "日本語"
        case .korean: "한국어"
        case .french: "Français"
        case .spanish: "Español"
        }
    }

    private static let key = "uiLanguage"

    /// What Settings shows.
    static var chosen: AppLanguage {
        get { AppLanguage(rawValue: UserDefaults.standard.string(forKey: key) ?? "") ?? .system }
        set {
            UserDefaults.standard.set(newValue.rawValue, forKey: key)
            // The system's own pieces (share sheets, permission prompts) follow from the next launch.
            if newValue == .system {
                UserDefaults.standard.removeObject(forKey: "AppleLanguages")
            } else {
                UserDefaults.standard.set([newValue.rawValue], forKey: "AppleLanguages")
            }
            load()
        }
    }

    /// The language in use now: the chosen one, or the phone's if it's one the app has.
    static var current: AppLanguage {
        if chosen != .system { return chosen }
        let codes = allCases.filter { $0 != .system }.map(\.rawValue)
        let preferred = Bundle.preferredLocalizations(from: codes, forPreferences: Locale.preferredLanguages)
        return preferred.first.flatMap(AppLanguage.init(rawValue:)) ?? .english
    }

    static var locale: Locale { Locale(identifier: current.rawValue) }

    nonisolated(unsafe) fileprivate static var table: Bundle?
    nonisolated(unsafe) fileprivate static var inEnglish = false

    /// Points every lookup (SwiftUI's `Text("…")` included) at the language in use. Called at launch and on a change.
    static func load() {
        if object_getClass(Bundle.main) != LanguageBundle.self { object_setClass(Bundle.main, LanguageBundle.self) }
        let code = current.rawValue
        inEnglish = current == .english
        table = Bundle.main.path(forResource: code, ofType: "lproj").flatMap(Bundle.init(path:))
    }
}

/// Bundle.main, answering in the language in use rather than the one the phone started the app with.
nonisolated private final class LanguageBundle: Bundle, @unchecked Sendable {
    override func localizedString(forKey key: String, value: String?, table tableName: String?) -> String {
        if let table = AppLanguage.table {
            return table.localizedString(forKey: key, value: value, table: tableName)
        }
        // English with no English table: the key is the English text.
        if AppLanguage.inEnglish { return (value?.isEmpty == false ? value : nil) ?? key }
        return super.localizedString(forKey: key, value: value, table: tableName)
    }
}

/// The text in the language in use. A text with no translation (a show's name) comes back as it is.
nonisolated func L(_ english: String) -> String {
    Bundle.main.localizedString(forKey: english, value: english, table: nil)
}

/// A translated format: `L("%lld words due", n)`.
nonisolated func L(_ english: String, _ args: CVarArg...) -> String {
    String(format: L(english), locale: AppLanguage.locale, arguments: args)
}

/// "1 word", "3 words": English needs both; other languages translate the plural one.
nonisolated func L(_ n: Int, _ one: String, _ many: String) -> String {
    n == 1 ? L(one, n) : L(many, n)
}
