import XCTest
@testable import Judge

final class LanguageTests: XCTestCase {
    func testTagsMatchLikeTheWebsite() {
        XCTAssertEqual(AppLang(languageTag: "de-AT"), .de)
        XCTAssertEqual(AppLang(languageTag: "zh"), .zhHans)
        XCTAssertEqual(AppLang(languageTag: "zh-Hans-CN"), .zhHans)
        XCTAssertEqual(AppLang(languageTag: "zh-Hant-TW"), .zhHant)
        XCTAssertEqual(AppLang(languageTag: "zh-HK"), .zhHant)
        XCTAssertEqual(AppLang(languageTag: "zh_TW"), .zhHant)
        XCTAssertEqual(AppLang(languageTag: "pt"), .ptBR)
        XCTAssertEqual(AppLang(languageTag: "pt-BR"), .ptBR)
        XCTAssertEqual(AppLang(languageTag: "pt-PT"), .ptPT)
        XCTAssertEqual(AppLang(languageTag: "pt-AO"), .ptPT)
        XCTAssertEqual(AppLang(languageTag: "nn-NO"), .nb)
        XCTAssertEqual(AppLang(languageTag: "no"), .nb)
        XCTAssertEqual(AppLang(languageTag: "he-IL"), .he)
        XCTAssertNil(AppLang(languageTag: "fa-IR"))
        XCTAssertNil(AppLang(languageTag: ""))
    }

    func testTheFirstSpokenPreferenceWins() {
        XCTAssertEqual(AppLang.match(["fa-IR", "fr-CA", "de"]), .fr)
        XCTAssertEqual(AppLang.match(["ar-EG"]), .ar)
        XCTAssertEqual(AppLang.match(["fa", "sw"]), .en)
        XCTAssertEqual(AppLang.match([]), .en)
        XCTAssertEqual(LangPreference.system.resolved(preferredLanguages: ["ja-JP", "en-US"]), .ja)
    }

    func testStoredPreferenceKeepsOldValuesWorking() {
        XCTAssertEqual(LangPreference(stored: "en"), .fixed(.en))
        XCTAssertEqual(LangPreference(stored: "tr"), .fixed(.tr))
        XCTAssertEqual(LangPreference(stored: "system"), .system)
        XCTAssertEqual(LangPreference(stored: nil), .system)
        XCTAssertEqual(LangPreference(stored: "zh-Hant"), .fixed(.zhHant))
        XCTAssertEqual(LangPreference(stored: "klingon"), .system)
        for lang in AppLang.enabled {
            XCTAssertEqual(LangPreference(stored: LangPreference.fixed(lang).stored), .fixed(lang), lang.rawValue)
        }
        XCTAssertEqual(LangPreference.system.stored, "system")
    }

    @MainActor
    func testTheChoiceIsSavedAndReadBack() throws {
        let config = AppConfig(apiBaseURL: AppConfig.production, shareBaseURL: AppConfig.production, version: "1", build: "1")
        let defaults = try XCTUnwrap(UserDefaults(suiteName: "judge.tests.\(UUID().uuidString)"))
        // A setting saved by a build that only had English and Turkish.
        defaults.set("tr", forKey: "settings.lang")
        let app = AppModel(config: config, container: HistoryContainer.inMemory(), defaults: defaults, tokenStore: MemoryTokenStore(), persistsDraft: false, caseNames: MemoryCaseNamesStore())
        XCTAssertEqual(app.langPreference, .fixed(.tr))
        app.setLangPreference(.fixed(.ptBR))
        XCTAssertEqual(app.lang, .ptBR)
        XCTAssertEqual(defaults.string(forKey: "settings.lang"), "pt-BR")
    }

    func testEveryCodeDecodes() throws {
        for lang in AppLang.allCases {
            let decoded = try JSONDecoder().decode(AppLang.self, from: Data("\"\(lang.rawValue)\"".utf8))
            XCTAssertEqual(decoded, lang)
        }
        let json = try Fixtures.sample("win_a_self").result.json
        var object = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any])
        object["lang"] = "zh-Hant"
        let data = try JSONSerialization.data(withJSONObject: object)
        let result = try WireDecoding.result(fromJSON: String(decoding: data, as: UTF8.self))
        XCTAssertEqual(result.lang, .zhHant)
        XCTAssertEqual(ContentLang.verdictLang(result), .zhHant)
    }

    func testRightToLeftAndTrackingFollowTheScript() {
        XCTAssertEqual(AppLang.allCases.filter(\.isRTL), [.ar, .he, .ur])
        XCTAssertFalse(AppLang.ar.tracks)
        XCTAssertFalse(AppLang.hi.tracks)
        XCTAssertFalse(AppLang.th.tracks)
        XCTAssertTrue(AppLang.ru.tracks)
        XCTAssertTrue(AppLang.ja.tracks)
        // The locale the views get back to the language, as the type styles read it.
        for lang in AppLang.enabled {
            XCTAssertEqual(AppLang(languageTag: lang.locale.identifier), lang, lang.rawValue)
        }
    }

    func testEveryEnabledLanguageHasItsStrings() {
        for lang in AppLang.enabled {
            XCTAssertFalse(L10n.getVerdict(lang).isEmpty, lang.rawValue)
            XCTAssertNotEqual(lang.bundle, Bundle.main, "\(lang.rawValue).lproj is missing")
        }
        XCTAssertEqual(L10n.partyA(.de), "Partei A")
        XCTAssertEqual(L10n.partyA(.zhHant), "當事人A")
    }

    func testCountsTakeEachLanguagesPluralForms() {
        XCTAssertEqual(L10n.pricingPack(.en, n: 1), "1 verdict")
        XCTAssertEqual(L10n.pricingPack(.ru, n: 1), "1 вердикт")
        XCTAssertEqual(L10n.pricingPack(.ru, n: 3), "3 вердикта")
        XCTAssertEqual(L10n.pricingPack(.ru, n: 5), "5 вердиктов")
        XCTAssertEqual(L10n.pricingPack(.ru, n: 21), "21 вердикт")
        XCTAssertEqual(L10n.appBalanceLeft(.en, n: 1), "1 verdict left")
        XCTAssertEqual(L10n.appBalanceLeft(.en, n: 2), "2 verdicts left")
        // Counts keep ASCII digits in every script, as on the website.
        XCTAssertEqual(L10n.waitMinutes(.ar, n: 3), "3 دقائق")
        XCTAssertEqual(L10n.threadJudgesAgree(.en, n: 2, total: "3"), "Judges · 2 of 3 agree")
        XCTAssertFalse(L10n.threadJudgesAgree(.ru, n: 2, total: "3").contains("{total}"))
    }
}
