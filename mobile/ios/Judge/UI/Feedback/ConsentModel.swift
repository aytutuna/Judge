import Foundation
import Observation

/// The "Help improve Judge" choice. The card after the second verdict asks
/// once; the switch in Settings changes it any time.
@MainActor
@Observable
final class ConsentModel {
    private(set) var state: ConsentState?
    /// The server's call: not asked yet and at least two finished verdicts.
    private(set) var ask = false

    private let api: JudgeAPI
    @ObservationIgnored var usesNetwork = true

    init(api: JudgeAPI) {
        self.api = api
    }

    var on: Bool { state == .on }

    /// The server decides, so it is never asked again once answered, on any device.
    var showCard: Bool { state == .notAsked && ask }

    func load() async {
        guard usesNetwork, let loaded = try? await api.consent() else { return }
        state = loaded.state
        ask = loaded.ask
    }

    func answerCard(_ on: Bool, lang: AppLang) async {
        await set(on, source: .card, key: "consent.cardBody", lang: lang)
    }

    func setSwitch(_ on: Bool, lang: AppLang) async {
        await set(on, source: .switchRow, key: "consent.switchDetail", lang: lang)
    }

    func reset() {
        state = nil
        ask = false
    }

    @discardableResult
    private func set(_ on: Bool, source: JudgeAPI.ConsentSource, key: String, lang: AppLang) async -> Bool {
        guard let next = try? await api.setConsent(on: on, source: source, wordingKey: key, lang: lang) else { return false }
        state = next
        ask = false
        return true
    }
}
