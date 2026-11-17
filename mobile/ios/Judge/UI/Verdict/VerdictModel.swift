import Foundation
import Observation

/// The verdict screen's state: the original, the translations fetched so
/// far (each language once; switching back is instant) and their status.
@MainActor
@Observable
final class VerdictModel {
    private(set) var session: VerdictSession
    private(set) var entries: [AppLang: TranslationEntry]
    /// The language the text is shown in. A verdict opens as it was written;
    /// only a change of the UI language afterwards translates it.
    private(set) var shown: AppLang

    private let api: JudgeAPI
    private let onTranslated: @MainActor (VerdictSession, AppLang, RawResult) -> Void
    @ObservationIgnored private var inFlight: Set<AppLang> = []

    /// `opening` is the language to start in; by default the one it was written in.
    init(
        session: VerdictSession,
        opening: AppLang? = nil,
        api: JudgeAPI,
        onTranslated: @escaping @MainActor (VerdictSession, AppLang, RawResult) -> Void
    ) {
        self.session = session
        self.api = api
        self.onTranslated = onTranslated
        shown = opening ?? session.sourceLang
        entries = session.translations.mapValues { TranslationEntry.result($0) }
    }

    func view() -> TranslationView {
        TranslationLogic.view(original: session.original.result, lang: shown, entry: entries[shown])
    }

    /// Call when the UI language changes: forgets retryable failures and
    /// fetches the language when the original is written in the other one.
    func languageChanged(to lang: AppLang) {
        shown = lang
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
        let id = session.currentID
        Task { [weak self] in
            let outcome: Result<TranslatePayload, APIError>
            do {
                outcome = .success(try await api.translate(id: id, to: lang))
            } catch let failure as APIError {
                outcome = .failure(failure)
            } catch {
                outcome = .failure(.malformed)
            }
            self?.receive(outcome, lang: lang, for: id)
        }
    }

    /// A later ruling (context added) takes the screen; it is translated
    /// under its own id.
    func show(_ next: VerdictSession) {
        session = next
        entries = next.translations.mapValues { TranslationEntry.result($0) }
        inFlight = []
        ensure(shown)
    }

    private func receive(_ outcome: Result<TranslatePayload, APIError>, lang: AppLang, for id: String) {
        // The earlier ruling's translation, arriving after a new one took over.
        guard id == session.currentID else { return }
        inFlight.remove(lang)
        let entry = TranslationLogic.entry(for: outcome, lang: lang, now: .now)
        entries[lang] = entry
        if case .result(let raw) = entry {
            session.translations[lang] = raw
            onTranslated(session, lang, raw)
        }
    }
}
