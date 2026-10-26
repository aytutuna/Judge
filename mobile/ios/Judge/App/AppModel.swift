import Foundation
import Observation
import SwiftData

/// The language setting: follow the phone, or a fixed language.
enum LangPreference: String, CaseIterable, Sendable {
    case system, en, tr

    /// System resolves to Turkish when the phone's first preferred language
    /// is Turkish (the website's rule in lib/lang.ts), English otherwise.
    func resolved(preferredLanguages: [String]) -> AppLang {
        switch self {
        case .en: return .en
        case .tr: return .tr
        case .system: return preferredLanguages.first?.lowercased().hasPrefix("tr") == true ? .tr : .en
        }
    }
}

/// App-wide state and dependencies, created once in `JudgeApp` and shared
/// through the environment. The API sends the bearer token from the token
/// store (the Keychain in the app); `account` owns sign-in.
@MainActor
@Observable
final class AppModel {
    private(set) var langPreference: LangPreference

    let config: AppConfig
    let api: JudgeAPI
    let botCheck: any BotCheck
    /// Set when a Turnstile site key is configured; the root view hosts its web view.
    let turnstile: TurnstileBotCheck?
    let history: HistoryStore
    let home: HomeModel
    let account: AccountModel
    /// In-app purchases (off without a RevenueCat key).
    let purchases: PurchaseModel
    /// Whether Home saves the unsent draft and brings it back next session
    /// (off for screenshot states, so they neither read nor overwrite it).
    let persistsDraft: Bool
    /// The real names behind each case's labels, kept on this phone.
    let caseNames: any CaseNamesStore
    /// The selected tab (links and "Start a new case" switch it).
    var tab: RootTab = .new
    /// Which list the History tab shows.
    var historySegment: HistorySegment = .verdicts
    /// "Your cases" in the History tab.
    let caseList: CaseListModel
    /// Off for screenshot states: case pages neither load nor poll.
    @ObservationIgnored var usesNetwork = true
    /// Screenshot states: the writer's gate (and typed context) a verdict
    /// screen opens with, the form out.
    @ObservationIgnored var appealSeed: (gate: CaseAppealGate, text: String)?
    /// Case views created on this phone, so their page opens at once.
    @ObservationIgnored private var caseSeeds: [String: CaseView] = [:]
    /// One model per case page, so a re-rendered screen keeps its state.
    @ObservationIgnored private var caseModels: [String: CaseModel] = [:]

    private let defaults: UserDefaults
    private static let langKey = "settings.lang"
    static let presetKey = "settings.lastPreset"

    init(
        config: AppConfig,
        container: ModelContainer,
        defaults: UserDefaults = .standard,
        tokenStore: any TokenStore = KeychainTokenStore(),
        persistsDraft: Bool = true,
        api: JudgeAPI? = nil,
        caseNames: (any CaseNamesStore)? = nil,
        purchaseGateway: (any PurchaseGateway)? = nil
    ) {
        self.config = config
        self.persistsDraft = persistsDraft
        self.defaults = defaults
        self.caseNames = caseNames ?? KeychainCaseNamesStore()
        caseList = CaseListModel()
        langPreference = defaults.string(forKey: Self.langKey).flatMap(LangPreference.init(rawValue:)) ?? .system
        self.api = api ?? JudgeAPI(baseURL: config.apiBaseURL, userAgent: config.userAgent, tokenStore: tokenStore)
        if config.turnstileSiteKey.isEmpty {
            turnstile = nil
            botCheck = NoBotCheck()
        } else {
            let check = TurnstileBotCheck(siteKey: config.turnstileSiteKey, origin: config.apiBaseURL)
            turnstile = check
            botCheck = check
        }
        history = HistoryStore(context: container.mainContext)
        home = HomeModel(preset: defaults.string(forKey: Self.presetKey) ?? Preset.defaultID)
        account = AccountModel(api: self.api)
        let gateway: (any PurchaseGateway)?
        if let purchaseGateway {
            gateway = purchaseGateway
        } else if config.revenueCatAPIKey.isEmpty {
            gateway = nil
        } else {
            gateway = RevenueCatGateway(apiKey: config.revenueCatAPIKey)
        }
        purchases = PurchaseModel(gateway: gateway, account: account)
        loadTierChoice()
        let names = self.caseNames
        let list = caseList
        let purchases = self.purchases
        account.onSessionEnded = { [weak self, weak purchases] byUser in
            list.reset()
            self?.caseModels = [:]
            purchases?.userSignedOut()
            // Real names kept for this account's cases go with it.
            if byUser { names.forgetAll() }
        }
        account.onUserKnown = { [weak purchases] id in purchases?.userSignedIn(id) }
    }

    /// The UI language right now. Every string lookup takes it explicitly,
    /// so a change re-renders in place without a restart.
    var lang: AppLang {
        langPreference.resolved(preferredLanguages: Locale.preferredLanguages)
    }

    func setLangPreference(_ preference: LangPreference) {
        langPreference = preference
        defaults.set(preference.rawValue, forKey: Self.langKey)
    }

    func rememberPreset(_ id: String) {
        defaults.set(id, forKey: Self.presetKey)
    }

    // MARK: - Free or Premium

    /// The last Free / Premium pick, remembered across launches (default
    /// Free). Only a preference: `effectiveTier` decides what is sent.
    private(set) var tierChoice: Tier = .free
    static let tierKey = "settings.tier"

    func loadTierChoice() {
        tierChoice = defaults.string(forKey: Self.tierKey).flatMap(Tier.init(rawValue:)) ?? .free
    }

    func setTierChoice(_ tier: Tier) {
        tierChoice = tier
        defaults.set(tier.rawValue, forKey: Self.tierKey)
    }

    var tierAvailability: TierAvailability {
        TierLogic.availability(config: account.serverConfig, signedIn: account.isSignedIn, entitlement: account.entitlement)
    }

    /// Premium only while it can be used and was chosen.
    var effectiveTier: Tier { TierLogic.effective(tierAvailability, choice: tierChoice) }

    /// Screenshot evidence on Home: premium chosen and offered here.
    var evidenceOn: Bool { effectiveTier == .premium && account.features.evidence }

    // MARK: - Two-sided cases

    /// The Just me / Both sides choice on Home: signed in and cases offered.
    /// The case itself is free or premium, following the tier switch.
    var casesOn: Bool { account.isSignedIn && account.features.cases }

    /// "Your cases" in the History tab: this server offers cases.
    var caseListOffered: Bool { account.features.cases }

    func seedCase(_ view: CaseView) {
        caseSeeds[view.id] = view
        caseModels[view.id] = nil
    }

    /// The model behind one case page (kept per case), starting from a view
    /// created here.
    func makeCaseModel(id: String) -> CaseModel {
        if let model = caseModels[id] { return model }
        let model = CaseModel(id: id, api: api, namesStore: caseNames, account: account, initial: caseSeeds[id])
        model.usesNetwork = usesNetwork
        caseModels[id] = model
        return model
    }

    /// The header's "+": an empty form on the Home tab.
    func newArgument() {
        home.judgeAnother()
        tab = .new
    }

    /// A link the app was opened with: an invite opens the website's answer
    /// page in Safari (answering is done there); a case opens its page.
    func open(_ link: AppLink) -> URL? {
        switch link {
        case .invite(let url):
            return url
        case .caseDetail(let id):
            tab = .new
            home.path = [.caseDetail(id: id)]
            return nil
        }
    }
}

/// Links into the app (okjudge.com URLs).
enum AppLink: Equatable {
    /// /r/{token}: the other side's invite. Never handled natively.
    case invite(URL)
    /// /c/{id}: the owner's case page.
    case caseDetail(id: String)

    static func parse(_ url: URL, site: URL) -> AppLink? {
        guard let host = url.host?.lowercased(), let siteHost = site.host?.lowercased(),
              host == siteHost || host == "www." + siteHost
        else { return nil }
        let parts = url.pathComponents.filter { $0 != "/" }
        guard parts.count == 2, !parts[1].isEmpty else { return nil }
        switch parts[0] {
        case "r": return .invite(url)
        case "c": return .caseDetail(id: parts[1])
        default: return nil
        }
    }
}
