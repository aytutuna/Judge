#if DEBUG
import Foundation
import SwiftData

/// Debug builds only: deterministic app states for screenshots, rendered
/// from mobile/shared/fixtures/verdicts.json (bundled into Debug builds
/// only) with no network.
///
/// Launch argument: `-JudgeScreenshotState <screen>:<lang>`, where screen is
/// `home`, `home-error`, `judging`, `history`, `settings`, `signin`,
/// `signin-code`, `account` (Settings, signed in), `verdict/<sample>` (a
/// key of `verdictResponses`), or a Premium state: `tier/locked` (signed
/// in, monthly allowance used up), `tier/premium` (Premium chosen with
/// credits), `pricing`, `pricing-store` (store prices on the buy buttons),
/// `clarify` (the questions), `evidence` (picked
/// screenshots in mixed states), `judging-premium`, `mode-both` (Both sides
/// chosen), `history-cases` ("Your cases") or `case/<state>`: the owner's
/// case page for a key of `cases.views` or one of the short names `awaiting`,
/// `judging`, `judged`, `one-sided`, `appeal`, `appeal-judging`, `failed`,
/// `expired`, `removed` (Turkish takes the `_tr` view when there is one);
/// lang is `en` or `tr`.
/// Examples: `home:tr`, `verdict/win_a_self:tr`, `tier/locked:en`, `case/judged:en`.
///
/// The state runs on an in-memory history store and a separate defaults
/// suite, so it never touches the real data, and the API points at a closed
/// local port, so nothing reaches a server.
struct ScreenshotState {
    enum Screen: Equatable {
        case home
        case homeError
        case judging
        case verdict(sample: String)
        case history
        case settings
        case signIn
        case signInCode
        case account
        case tierLocked
        case tierPremium
        case pricing
        case pricingStore
        case clarify
        case evidence
        case judgingPremium
        case modeBoth
        case historyCases
        case caseDetail(view: String)
    }

    static let argument = "-JudgeScreenshotState"

    let screen: Screen
    let lang: AppLang

    var tab: RootTab {
        switch screen {
        case .home, .homeError, .judging, .verdict, .signIn, .signInCode,
             .tierLocked, .tierPremium, .pricing, .pricingStore, .clarify, .evidence, .judgingPremium, .modeBoth, .caseDetail:
            return .new
        case .history, .historyCases: return .history
        case .settings, .account: return .settings
        }
    }

    static func fromLaunchArguments(_ arguments: [String] = ProcessInfo.processInfo.arguments) -> ScreenshotState? {
        guard let index = arguments.firstIndex(of: argument), arguments.indices.contains(index + 1) else { return nil }
        return parse(arguments[index + 1])
    }

    static func parse(_ raw: String) -> ScreenshotState? {
        let parts = raw.split(separator: ":").map(String.init)
        guard parts.count == 2, let lang = AppLang(rawValue: parts[1]) else { return nil }
        let name = parts[0]
        let screen: Screen
        switch name {
        case "home": screen = .home
        case "home-error": screen = .homeError
        case "judging": screen = .judging
        case "history": screen = .history
        case "settings": screen = .settings
        case "signin": screen = .signIn
        case "signin-code": screen = .signInCode
        case "account": screen = .account
        case "tier/locked": screen = .tierLocked
        case "tier/premium": screen = .tierPremium
        case "pricing": screen = .pricing
        case "pricing-store": screen = .pricingStore
        case "clarify": screen = .clarify
        case "evidence": screen = .evidence
        case "judging-premium": screen = .judgingPremium
        case "mode-both": screen = .modeBoth
        case "history-cases": screen = .historyCases
        default:
            if name.hasPrefix("case/") {
                let view = String(name.dropFirst("case/".count))
                guard !view.isEmpty else { return nil }
                screen = .caseDetail(view: Self.caseAliases[view] ?? view)
            } else {
                guard name.hasPrefix("verdict/") else { return nil }
                let sample = String(name.dropFirst("verdict/".count))
                guard !sample.isEmpty else { return nil }
                screen = .verdict(sample: sample)
            }
        }
        return ScreenshotState(screen: screen, lang: lang)
    }

    /// An app model holding this state.
    @MainActor
    func makeModel(container: ModelContainer) -> AppModel {
        let suite = "judge.screenshots"
        UserDefaults().removePersistentDomain(forName: suite)
        let defaults = UserDefaults(suiteName: suite) ?? .standard
        let base = AppConfig.load()
        let offline = URL(string: "http://127.0.0.1:9") ?? base.apiBaseURL
        let config = AppConfig(
            apiBaseURL: offline,
            shareBaseURL: base.shareBaseURL,
            turnstileSiteKey: "",
            version: base.version,
            build: base.build
        )
        var gateway: (any PurchaseGateway)?
        if screen == .pricingStore { gateway = FixedPurchaseGateway(Self.storeOffers(lang)) }
        let app = AppModel(
            config: config,
            container: container,
            defaults: defaults,
            tokenStore: MemoryTokenStore(),
            persistsDraft: false,
            caseNames: MemoryCaseNamesStore(),
            purchaseGateway: gateway
        )
        app.account.usesNetwork = false
        app.usesNetwork = false
        app.caseList.usesNetwork = false
        app.setLangPreference(lang == .tr ? .tr : .en)
        apply(to: app)
        return app
    }

    @MainActor
    private func apply(to app: AppModel) {
        switch screen {
        case .home, .settings:
            break
        case .homeError:
            app.home.argument = ExampleArgument.all[0].text(lang)
            app.home.showForScreenshot(error: .timeout)
        case .judging:
            app.home.argument = ExampleArgument.all[0].text(lang)
            app.home.isJudging = true
        case .verdict(let sample):
            guard let session = ScreenshotFixtures.session(sample) else { return }
            app.home.updateSession(session)
            app.home.path = [.verdict(id: session.id)]
        case .signIn:
            app.home.argument = ExampleArgument.all[0].text(lang)
            app.account.showForScreenshot(providers: Self.allProviders)
            app.account.isSignInPresented = true
        case .signInCode:
            app.home.argument = ExampleArgument.all[0].text(lang)
            app.account.showForScreenshot(providers: Self.allProviders, step: .code(email: Self.email), email: Self.email)
            app.account.isSignInPresented = true
        case .account:
            app.account.showForScreenshot(
                providers: Self.allProviders,
                info: AccountInfo(
                    user: Viewer(id: "user000001", email: Self.email, name: "Sam"),
                    entitlement: Entitlement(canUsePremium: false, blockedReason: "premium_required", credits: 0)
                )
            )
        case .tierLocked:
            premium(app, me: "fair_use")
            app.setTierChoice(.premium)
            app.home.argument = ExampleArgument.all[0].text(lang)
            app.home.initialScroll = HomeModel.tierAnchor
        case .tierPremium:
            premium(app, me: "credits7")
            app.setTierChoice(.premium)
            app.home.argument = ExampleArgument.all[0].text(lang)
            app.home.initialScroll = HomeModel.tierAnchor
        case .pricing:
            premium(app, me: "subscriber")
            app.home.path = [.pricing]
        case .pricingStore:
            var config = ScreenshotFixtures.config("full")
            config?.pricing?.purchasesEnabled = true
            app.account.showForScreenshot(providers: Self.allProviders, info: ScreenshotFixtures.me("credits7"), config: config)
            app.purchases.showForScreenshot(offers: Self.storeOffers(lang))
            app.home.path = [.pricing]
        case .clarify:
            premium(app, me: "credits7")
            app.setTierChoice(.premium)
            app.home.argument = ExampleArgument.all[0].text(lang)
            app.home.showForScreenshot(questions: ScreenshotFixtures.questions(lang: lang))
        case .evidence:
            premium(app, me: "credits7")
            app.setTierChoice(.premium)
            app.home.argument = ExampleArgument.all[0].text(lang)
            app.home.initialScroll = HomeModel.evidenceAnchor
            let preview = ScreenshotFixtures.evidencePreview()
            app.home.evidence.showForScreenshot([
                (status: .ok, preview: preview),
                (status: .reading, preview: nil),
                (status: .unreadable, preview: nil),
            ])
        case .judgingPremium:
            premium(app, me: "credits7")
            app.setTierChoice(.premium)
            app.home.argument = ExampleArgument.all[0].text(lang)
            app.home.showForScreenshot(judgingPremium: true)
        case .modeBoth:
            premium(app, me: "credits7")
            app.setTierChoice(.premium)
            app.home.mode = .both
            app.home.argument = ExampleArgument.all[0].text(lang)
            app.home.initialScroll = HomeModel.tierAnchor
        case .historyCases:
            premium(app, me: "credits7")
            app.historySegment = .cases
            app.caseList.showForScreenshot(ScreenshotFixtures.caseList())
        case .caseDetail(let name):
            premium(app, me: "credits7")
            let localized = lang == .tr ? ScreenshotFixtures.caseView(name + "_tr") : nil
            guard let view = localized ?? ScreenshotFixtures.caseView(name) else { return }
            app.seedCase(view)
            app.home.path = [.caseDetail(id: view.id)]
        case .history:
            // Fixed times, newest first, an hour apart.
            let newest = Date(timeIntervalSince1970: 1_792_000_000)
            let samples = ["win_a_self", "overturned_tr", "win_b_named", "lean_b_majority_escalated", "split", "conditional"]
            for (offset, name) in samples.enumerated() {
                guard let session = ScreenshotFixtures.session(name) else { continue }
                try? app.history.save(session, preset: Preset.defaultID, now: newest.addingTimeInterval(Double(-offset) * 3600))
            }
        }
    }

    /// Signed in with a fixture account on a server with Premium, cases and
    /// evidence switched on.
    @MainActor
    private func premium(_ app: AppModel, me: String) {
        app.account.showForScreenshot(
            providers: Self.allProviders,
            info: ScreenshotFixtures.me(me),
            config: ScreenshotFixtures.config("full")
        )
    }

    /// Short names for the case views in the screenshot list.
    static let caseAliases: [String: String] = [
        "awaiting": "waiting_for_respondent",
        "one-sided": "judged_one_sided",
        "appeal": "appeal_overturned",
        "appeal-judging": "appeal_judging",
    ]

    /// Store prices as the App Store would show them: US dollars for the
    /// English shots, Turkish lira for the Turkish ones.
    static func storeOffers(_ lang: AppLang) -> [StoreOffer] {
        if lang == .tr {
            return [
                StoreOffer(planId: "pack_1", productId: "pack_1", price: "₺44,99", amount: Decimal(4499) / 100, currencyCode: "TRY"),
                StoreOffer(planId: "pack_10", productId: "pack_10", price: "₺329,99", amount: Decimal(32999) / 100, currencyCode: "TRY"),
                StoreOffer(planId: "monthly", productId: "monthly", price: "₺649,99", amount: Decimal(64999) / 100, currencyCode: "TRY"),
            ]
        }
        return [
            StoreOffer(planId: "pack_1", productId: "pack_1", price: "$1.00", amount: Decimal(100) / 100, currencyCode: "USD"),
            StoreOffer(planId: "pack_10", productId: "pack_10", price: "$7.50", amount: Decimal(750) / 100, currencyCode: "USD"),
            StoreOffer(planId: "monthly", productId: "monthly", price: "$15.00", amount: Decimal(1500) / 100, currencyCode: "USD"),
        ]
    }

    private static let email = "sam@example.com"
    private static let allProviders = SignInProviders(apple: true, google: true, email: true, emailCode: true)
}

/// A store that already has its prices and never sells (screenshots).
@MainActor
final class FixedPurchaseGateway: PurchaseGateway {
    private let list: [StoreOffer]

    init(_ list: [StoreOffer]) {
        self.list = list
    }

    func logIn(userId: String) async throws {}
    func logOut() async {}
    func isLoggedIn(as userId: String) -> Bool { true }
    func offers() async throws -> [StoreOffer] { list }
    func purchase(planId: String) async throws -> PurchaseOutcome { .cancelled }
    func restore() async throws -> Bool { false }
}

/// Reads verdicts.json from the app bundle (Debug builds copy it in; Release
/// excludes it with EXCLUDED_SOURCE_FILE_NAMES).
enum ScreenshotFixtures {
    static func root() -> [String: Any] {
        guard let url = Bundle.main.url(forResource: "verdicts", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return [:] }
        return object
    }

    /// A sample verdict, with every fixture translation of it attached so no
    /// language needs a fetch.
    static func session(_ name: String) -> VerdictSession? {
        let root = root()
        guard let responses = root["verdictResponses"] as? [String: Any],
              let sample = responses[name],
              let data = try? JSONSerialization.data(withJSONObject: sample),
              let payload = try? WireDecoding.verdictPayload(from: data)
        else { return nil }
        var translations: [AppLang: RawResult] = [:]
        if let translate = root["translateResponse"],
           let data = try? JSONSerialization.data(withJSONObject: translate),
           let translated = try? WireDecoding.translatePayload(from: data),
           translated.id == payload.id, let lang = translated.lang {
            translations[lang] = translated.result
        }
        return VerdictSession(id: payload.id, original: payload.result, nameMap: payload.nameMap, translations: translations)
    }

    /// `config.<name>` as GET /api/v1/config would answer.
    static func config(_ name: String) -> ServerConfig? {
        decode(ServerConfig.self, (root()["config"] as? [String: Any])?[name])
    }

    /// `me.<name>` as GET /api/v1/me would answer.
    static func me(_ name: String) -> AccountInfo? {
        decode(AccountInfo.self, (root()["me"] as? [String: Any])?[name])
    }

    /// The two clarifying questions. The fixture is English; Turkish
    /// screenshots get the same questions in Turkish.
    static func questions(lang: AppLang) -> [ClarifyQuestion] {
        if lang == .tr {
            return [
                ClarifyQuestion(id: "q1", text: "Sam'le neyin sandviç sayılacağı konusunda hiç anlaştınız mı?"),
                ClarifyQuestion(id: "q2", text: "Mesele menüdeki ifade mi, yoksa önüne gelen yemek mi?"),
            ]
        }
        struct Answer: Decodable { var questions: [ClarifyQuestion] }
        let fixture = ((root()["clarifyResponse"] as? [String: Any])?["two_questions"])
        return decode(Answer.self, fixture)?.questions ?? []
    }

    /// The preview text of the first (readable) evidence item.
    static func evidencePreview() -> String? {
        let items = (root()["evidenceResponse"] as? [String: Any])?["items"] as? [[String: Any]]
        return items?.first?["preview"] as? String
    }

    /// `cases.views.<name>` as GET /api/v1/cases/{id} would answer.
    static func caseView(_ name: String) -> CaseView? {
        let views = (root()["cases"] as? [String: Any])?["views"] as? [String: Any]
        guard let object = views?[name] as? [String: Any] else { return nil }
        return try? CaseDecoding.view(object)
    }

    /// `cases.list` as GET /api/v1/cases would answer.
    static func caseList() -> [CaseSummary] {
        let list = (root()["cases"] as? [String: Any])?["list"]
        guard let list, JSONSerialization.isValidJSONObject(list),
              let data = try? JSONSerialization.data(withJSONObject: list)
        else { return [] }
        return (try? CaseDecoding.list(data)) ?? []
    }

    static func decode<T: Decodable>(_ type: T.Type, _ value: Any?) -> T? {
        guard let value, JSONSerialization.isValidJSONObject(value),
              let data = try? JSONSerialization.data(withJSONObject: value)
        else { return nil }
        return try? JSONDecoder().decode(type, from: data)
    }
}
#endif
