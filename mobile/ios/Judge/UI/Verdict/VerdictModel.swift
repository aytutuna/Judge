import Foundation
import Observation

/// The verdict screen's state: the original, the translations fetched so
/// far (each language once; switching back is instant) and their status.
@MainActor
@Observable
final class VerdictModel {
    private(set) var session: VerdictSession
    private(set) var entries: [AppLang: TranslationEntry]

    private let api: JudgeAPI
    private let onTranslated: @MainActor (VerdictSession, AppLang, RawResult) -> Void
    @ObservationIgnored private var inFlight: Set<AppLang> = []

    init(session: VerdictSession, api: JudgeAPI, onTranslated: @escaping @MainActor (VerdictSession, AppLang, RawResult) -> Void) {
        self.session = session
        self.api = api
        self.onTranslated = onTranslated
        entries = session.translations.mapValues { TranslationEntry.result($0) }
    }

    func view(for lang: AppLang) -> TranslationView {
        TranslationLogic.view(original: session.original.result, lang: lang, entry: entries[lang])
    }

    /// Call on every language change: forgets retryable failures and fetches
    /// the language when the original is written in the other one.
    func languageChanged(to lang: AppLang) {
        entries = TranslationLogic.dropRetryable(entries)
        ensure(lang)
    }

    func ensure(_ lang: AppLang, now: Date = .now) {
        guard TranslationLogic.needsFetch(original: session.original.result, lang: lang, entry: entries[lang], now: now),
              !inFlight.contains(lang)
        else { return }
        if case .blocked = entries[lang] { entries[lang] = nil }
        inFlight.insert(lang)
        let api = api
        let id = session.id
        Task { [weak self] in
            let outcome: Result<TranslatePayload, APIError>
            do {
                outcome = .success(try await api.translate(id: id, to: lang))
            } catch let failure as APIError {
                outcome = .failure(failure)
            } catch {
                outcome = .failure(.malformed)
            }
            self?.receive(outcome, lang: lang)
        }
    }

    private func receive(_ outcome: Result<TranslatePayload, APIError>, lang: AppLang) {
        inFlight.remove(lang)
        let entry = TranslationLogic.entry(for: outcome, lang: lang, now: .now)
        entries[lang] = entry
        if case .result(let raw) = entry {
            session.translations[lang] = raw
            onTranslated(session, lang, raw)
        }
    }
}
