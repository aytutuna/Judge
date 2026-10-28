import Foundation
import Observation
import SwiftData

/// The language setting: follow the phone, or a fixed language.
enum LangPreference: Hashable, Sendable {
    case system
    case fixed(AppLang)

    /// "system" or a language code, as stored. Anything else, a language no
    /// longer offered included, follows the phone.
    init(stored: String?) {
        if let stored, let lang = AppLang(rawValue: stored), AppLang.enabled.contains(lang) {
            self = .fixed(lang)
        } else {
            self = .system
        }
    }

    var stored: String {
        switch self {
        case .system: return "system"
        case .fixed(let lang): return lang.rawValue
        }
    }

    /// System takes the first of the phone's preferred languages the app
    /// speaks (the website's rule in lib/langs.ts), English otherwise.
    func resolved(preferredLanguages: [String]) -> AppLang {
        switch self {
        case .system: return AppLang.match(preferredLanguages)
        case .fixed(let lang): return lang
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
    /// The Verdicts tab's pages.
    var historyPath: [HistoryRoute] = []
    /// The account's Verdicts list (GET /api/v1/me/history and its cache).
    let historyList: HistoryListModel
    /// Whose list Verdicts shows: the signed-in account once known; at
    /// launch, until /me answers, the account the list was last loaded for,
    /// so it shows offline. Nil signed out.
    var historyUser: String?
    /// Off for screenshot states: case pages neither load nor poll.
    @ObservationIgnored var usesNetwork = true
    /// Screenshot states: the writer's gate (and typed context) a verdict
    /// screen opens with, the form out.
    @ObservationIgnored var appealSeed: (gate: CaseAppealGate, text: String)?
    /// Screenshot states: the Pricing anchor the screen scrolls to; nil = the top.
    @ObservationIgnored var pricingScroll: String?
    /// Screenshot states: verdicts the Verdicts list opens with picked, in
    /// select mode.
    @ObservationIgnored var historySelectionSeed: Set<String>?
    /// Case views created on this phone, so their page opens at once.
    @ObservationIgnored private var caseSeeds: [String: CaseView] = [:]
    /// The other side's name typed on Home, for the waiting page. Only for
    /// this run of the app: the server never gets it.
    @ObservationIgnored private var caseOthers: [String: String] = [:]
    /// One model per case page, so a re-rendered screen keeps its state.
    @ObservationIgnored private var caseModels: [String: CaseModel] = [:]

    private let defaults: UserDefaults
    private static let langKey = "settings.lang"

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
        langPreference = LangPreference(stored: defaults.string(forKey: Self.langKey))
        self.api = api ?? JudgeAPI(baseURL: config.apiBaseURL, userAgent: config.userAgent, tokenStore: tokenStore)
        history = HistoryStore(context: container.mainContext)
        home = HomeModel()
        account = AccountModel(api: self.api)
        historyList = HistoryListModel(api: self.api, store: history, account: account)
        let gateway: (any PurchaseGateway)?
        if let purchaseGateway {
            gateway = purchaseGateway
        } else if config.revenueCatAPIKey.isEmpty {
            gateway = nil
        } else {
            gateway = RevenueCatGateway(apiKey: config.revenueCatAPIKey)
        }
        purchases = PurchaseModel(gateway: gateway, account: account)
        let names = self.caseNames
        let list = historyList
        let store = history
        let purchases = self.purchases
        account.onSessionEnded = { [weak self, weak purchases] byUser in
            list.reset()
            self?.historyUser = nil
            self?.historyPath = []
            self?.caseModels = [:]
            purchases?.userSignedOut()
            // Real names kept for this account's cases go with it, and so do
            // its verdicts on this phone (they come back from the account).
            // An expired session keeps them, unlisted, for the same person.
            if byUser {
                names.forgetAll()
                try? store.forgetAccounts()
            } else {
                try? store.setAccount(nil)
            }
        }
        account.onUserKnown = { [weak self, weak purchases] id in
            purchases?.userSignedIn(id)
            try? store.setAccount(id)
            self?.historyUser = id
        }
        if account.isSignedIn { historyUser = try? history.cachedUser() }
    }

    /// The UI language right now. Every string lookup takes it explicitly,
    /// so a change re-renders in place without a restart.
    var lang: AppLang {
        langPreference.resolved(preferredLanguages: Locale.preferredLanguages)
    }

    func setLangPreference(_ preference: LangPreference) {
        langPreference = preference
        defaults.set(preference.stored, forKey: Self.langKey)
    }

    /// Screenshot evidence on Home: uploading needs an account.
    var evidenceOn: Bool { account.isSignedIn && account.features.evidence }

    // MARK: - Two-sided cases

    /// "Or send them a link" on Home: signed in and cases offered.
    var casesOn: Bool { account.isSignedIn && account.features.cases }

    func seedCase(_ view: CaseView, otherName: String? = nil) {
        caseSeeds[view.id] = view
        caseModels[view.id] = nil
        if let otherName { caseOthers[view.id] = otherName }
    }

    func caseOtherName(_ id: String) -> String? { caseOthers[id] }

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
