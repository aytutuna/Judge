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
/// through the environment. Sign-in and Premium (phase 2) slot in here: a
/// Keychain `TokenStore` replaces `NoTokenStore` and the API already sends
/// the bearer token when one exists.
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
    /// Whether Home saves the unsent draft and brings it back next session
    /// (off for screenshot states, so they neither read nor overwrite it).
    let persistsDraft: Bool

    private let defaults: UserDefaults
    private static let langKey = "settings.lang"
    static let presetKey = "settings.lastPreset"

    init(config: AppConfig, container: ModelContainer, defaults: UserDefaults = .standard, tokenStore: any TokenStore = NoTokenStore(), persistsDraft: Bool = true) {
        self.config = config
        self.persistsDraft = persistsDraft
        self.defaults = defaults
        langPreference = defaults.string(forKey: Self.langKey).flatMap(LangPreference.init(rawValue:)) ?? .system
        api = JudgeAPI(baseURL: config.apiBaseURL, userAgent: config.userAgent, tokenStore: tokenStore)
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
}
