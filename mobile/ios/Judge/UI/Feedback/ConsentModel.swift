import Foundation
import Observation

/// The "Help improve Judge" choice. The card after a first verdict asks
/// once; the switch in Settings changes it any time.
@MainActor
@Observable
final class ConsentModel {
    private(set) var state: ConsentState?

    private let api: JudgeAPI
    private let defaults: UserDefaults
    @ObservationIgnored var usesNetwork = true
    private static let askedKey = "consent.asked"

    init(api: JudgeAPI, defaults: UserDefaults) {
        self.api = api
        self.defaults = defaults
    }

    var on: Bool { state == .on }

    /// Never again once either answer was given, here or on another device.
    var showCard: Bool { state == .notAsked && !defaults.bool(forKey: Self.askedKey) }

    func load() async {
        guard usesNetwork, let loaded = try? await api.consent() else { return }
        state = loaded
        if loaded != .notAsked { defaults.set(true, forKey: Self.askedKey) }
    }

    func answerCard(_ on: Bool, lang: AppLang) async {
        if await set(on, source: .card, key: "consent.cardBody", lang: lang) {
            defaults.set(true, forKey: Self.askedKey)
        }
    }

    func setSwitch(_ on: Bool, lang: AppLang) async {
        await set(on, source: .switchRow, key: "consent.switchDetail", lang: lang)
    }

    func reset() { state = nil }

    @discardableResult
    private func set(_ on: Bool, source: JudgeAPI.ConsentSource, key: String, lang: AppLang) async -> Bool {
        guard let next = try? await api.setConsent(on: on, source: source, wordingKey: key, lang: lang) else { return false }
        state = next
        return true
    }
}
