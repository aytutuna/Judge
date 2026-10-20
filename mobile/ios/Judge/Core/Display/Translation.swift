import Foundation

/// A verdict as the verdict screen needs it: the original, the submitter's
/// name map (device-only) and every translation fetched so far.
struct VerdictSession: Sendable, Equatable, Identifiable {
    let id: String
    let original: RawResult
    let nameMap: [NameMapping]
    var translations: [AppLang: RawResult]

    /// The language the original text is written in.
    var sourceLang: AppLang { ContentLang.verdictLang(original.result) }
}

/// Port of lib/use-translation.ts's pure half.
enum TranslationStatus: Sendable, Equatable {
    case original
    case loading
    case translated(from: AppLang)
    case failed
    /// Failed because the phone is offline (app.translate.offline).
    case offline

    func note(_ lang: AppLang) -> String? {
        switch self {
        case .original: return nil
        case .loading: return L10n.translateLoading(lang)
        case .translated(let source): return source == .tr ? L10n.translateFromTr(lang) : L10n.translateFromEn(lang)
        case .failed: return L10n.translateFailed(lang)
        case .offline: return L10n.appTranslateOffline(lang)
        }
    }
}

/// What has been fetched for one language.
enum TranslationEntry: Sendable, Equatable {
    case result(RawResult)
    /// The server said the verdict was already in that language.
    case same
    /// Retried on the next language switch.
    case failed(offline: Bool)
    /// Rate limited: not retried before `until`.
    case blocked(until: Date)
}

struct TranslationView: Sendable, Equatable {
    let result: VerdictResult
    let status: TranslationStatus
}

enum TranslationLogic {
    /// Longest Retry-After honoured for a translation.
    static let maxRetryAfterSec = 600.0

    static func view(original: VerdictResult, lang: AppLang, entry: TranslationEntry?) -> TranslationView {
        let source = ContentLang.verdictLang(original)
        if source == lang { return TranslationView(result: original, status: .original) }
        switch entry {
        case .none: return TranslationView(result: original, status: .loading)
        case .same: return TranslationView(result: original, status: .original)
        case .result(let raw): return TranslationView(result: raw.result, status: .translated(from: source))
        case .failed(let offline): return TranslationView(result: original, status: offline ? .offline : .failed)
        case .blocked: return TranslationView(result: original, status: .failed)
        }
    }

    /// Whether `lang` needs a fetch now: a different language, nothing usable
    /// cached, and no rate-limit block still running.
    static func needsFetch(original: VerdictResult, lang: AppLang, entry: TranslationEntry?, now: Date) -> Bool {
        guard ContentLang.verdictLang(original) != lang else { return false }
        switch entry {
        case .none: return true
        case .result, .same, .failed: return false
        case .blocked(let until): return now >= until
        }
    }

    /// A language switch forgets retryable failures, so the next visit fetches again.
    static func dropRetryable(_ entries: [AppLang: TranslationEntry]) -> [AppLang: TranslationEntry] {
        entries.filter { _, entry in
            if case .failed = entry { return false }
            return true
        }
    }

    /// Entry for a finished translate call.
    static func entry(for outcome: Result<TranslatePayload, APIError>, lang: AppLang, now: Date) -> TranslationEntry {
        switch outcome {
        case .success(let payload):
            guard payload.lang == lang, payload.looksValid else { return .failed(offline: false) }
            return payload.translated ? .result(payload.result) : .same
        case .failure(let error):
            if error == .offline { return .failed(offline: true) }
            if case .server(let status, _) = error, status == 429 {
                let wait = min(error.retryAfterSec ?? 0, maxRetryAfterSec)
                return wait > 0 ? .blocked(until: now.addingTimeInterval(wait)) : .failed(offline: false)
            }
            return .failed(offline: false)
        }
    }
}
