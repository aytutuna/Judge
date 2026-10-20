#if DEBUG
import Foundation
import SwiftData

/// Debug builds only: deterministic app states for screenshots, rendered
/// from mobile/shared/fixtures/verdicts.json (bundled into Debug builds
/// only) with no network.
///
/// Launch argument: `-JudgeScreenshotState <screen>:<lang>`, where screen is
/// `home`, `home-error`, `judging`, `history`, `settings` or
/// `verdict/<sample>` (a key of `verdictResponses`), and lang is `en` or `tr`.
/// Examples: `home:tr`, `verdict/win_a_self:tr`, `history:en`.
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
    }

    static let argument = "-JudgeScreenshotState"

    let screen: Screen
    let lang: AppLang

    var tab: RootTab {
        switch screen {
        case .home, .homeError, .judging, .verdict: return .new
        case .history: return .history
        case .settings: return .settings
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
        default:
            guard name.hasPrefix("verdict/") else { return nil }
            let sample = String(name.dropFirst("verdict/".count))
            guard !sample.isEmpty else { return nil }
            screen = .verdict(sample: sample)
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
        let app = AppModel(config: config, container: container, defaults: defaults, persistsDraft: false)
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
}

/// Reads verdicts.json from the app bundle (Debug builds copy it in; Release
/// excludes it with EXCLUDED_SOURCE_FILE_NAMES).
enum ScreenshotFixtures {
    private static func root() -> [String: Any] {
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
}
#endif
