import Foundation
import Testing
@testable import Eksigo

/// The language picked in Settings is used at once, for texts in code as well as SwiftUI's own.
@MainActor @Suite(.serialized)
struct LanguageTests {
    @Test func chineseIsUsedOncePicked() {
        defer { AppLanguage.chosen = .system }
        AppLanguage.chosen = .chinese
        #expect(L("Review") == "复习")
        #expect(L(3, "%lld word", "%lld words") == "3 个单词")
        #expect(Stats.duration(200 * 60) == "3 小时 20 分")
        // A show's name has no translation and stays as it is.
        #expect(L("The Daily") == "The Daily")
    }

    @Test func englishStaysEnglishOnAChinesePhone() {
        defer { AppLanguage.chosen = .system }
        AppLanguage.chosen = .english
        #expect(L("Review") == "Review")
        #expect(L(1, "%lld word", "%lld words") == "1 word")
        #expect(L(2, "%lld word", "%lld words") == "2 words")
    }
}
