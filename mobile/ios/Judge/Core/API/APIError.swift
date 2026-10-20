import Foundation

/// Every way a call can fail, resolved to text only in the UI layer (with the
/// current language), so a language switch re-localizes an error on screen.
enum APIError: Error, Sendable, Equatable {
    /// An HTTP error. `body` is the parsed JSON error body (nil when the
    /// response was not JSON); a non-JSON 5xx arrives as code `unavailable`.
    case server(status: Int, body: ApiErrorBody?)
    case offline
    /// Client timeout or Cloudflare's 524 (origin took longer than 100 s).
    case timeout
    /// A 2xx whose body did not decode.
    case malformed
    /// The bot check could not produce a token.
    case botCheck
    /// The connection dropped after iOS suspended the app mid-request
    /// (its background time ran out). The server may still have finished.
    case interrupted

    var code: String? {
        if case .server(let status, let body) = self {
            return body?.code ?? (status == 429 ? "rate_limited" : nil)
        }
        return nil
    }

    var retryAfterSec: Double? {
        if case .server(_, let body) = self { return body?.retryAfterSec }
        return nil
    }

    /// Whether the error box offers "Try again" (always user-initiated).
    var offersRetry: Bool {
        switch self {
        case .offline, .timeout, .malformed, .interrupted:
            return true
        case .server:
            return code == "unavailable" || code == "quota" || code == nil
        case .botCheck:
            return false
        }
    }

    /// Maps an HTTP error response.
    static func from(status: Int, body data: Data, retryAfterHeader: String?) -> APIError {
        if status == 524 { return .timeout }
        guard var body = WireDecoding.errorBody(from: data) else {
            return status >= 500 ? .server(status: status, body: ApiErrorBody(code: "unavailable")) : .server(status: status, body: nil)
        }
        if body.retryAfterSec == nil, let header = retryAfterHeader.flatMap({ Double($0.trimmingCharacters(in: .whitespaces)) }), header > 0 {
            body.retryAfterSec = header
        }
        return .server(status: status, body: body)
    }

    /// Maps a URLSession failure. Cancellation is reported separately (see
    /// `isCancellation`) and never shown.
    static func from(transport error: any Error) -> APIError {
        guard let urlError = error as? URLError else { return .offline }
        switch urlError.code {
        case .timedOut:
            return .timeout
        case .notConnectedToInternet, .networkConnectionLost, .cannotFindHost, .cannotConnectToHost,
             .dnsLookupFailed, .dataNotAllowed, .internationalRoamingOff, .callIsActive,
             .secureConnectionFailed, .resourceUnavailable:
            return .offline
        case .badServerResponse, .cannotParseResponse, .zeroByteResource, .cannotDecodeContentData, .cannotDecodeRawData:
            return .server(status: 502, body: ApiErrorBody(code: "unavailable"))
        default:
            return .offline
        }
    }

    static func isCancellation(_ error: any Error) -> Bool {
        if error is CancellationError { return true }
        return (error as? URLError)?.code == .cancelled
    }
}

/// Ports of formatWait, formatDate, tWithDate and apiErrorMessage
/// (lib/i18n.ts).
enum ErrorText {
    /// Codes that map to an `error.<code>` string (ERROR_KEY_BY_CODE).
    static let knownCodes: Set<String> = [
        "invalid", "too_short", "too_long", "not_configured", "quota", "unavailable", "rate_limited",
        "daily_cap", "captcha_failed", "signin_required", "premium_required", "no_credits", "fair_use",
        "in_progress", "bad_origin", "not_found",
    ]

    /// A wait in seconds as a whole phrase: minutes below 90, hours beyond,
    /// always rounded up. Missing or nonsense input reads as "a few minutes".
    static func formatWait(_ seconds: Double?, lang: AppLang) -> String {
        guard let seconds, seconds.isFinite, seconds > 0 else { return L10n.waitMoment(lang) }
        let minutes = Int((seconds / 60).rounded(.up))
        if minutes < 90 {
            return minutes == 1 ? L10n.waitMinute(lang) : L10n.waitMinutes(lang, n: String(minutes))
        }
        let hours = Int((seconds / 3600).rounded(.up))
        return hours == 1 ? L10n.waitHour(lang) : L10n.waitHours(lang, n: String(hours))
    }

    /// An ISO timestamp as "November 18" / "18 Kasım"; nil when unusable.
    static func formatDate(_ iso: String?, lang: AppLang, timeZone: TimeZone = .current) -> String? {
        guard let iso, !iso.isEmpty, let date = parseISO(iso) else { return nil }
        let locale = Locale(identifier: lang == .tr ? "tr_TR" : "en_US")
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.timeZone = timeZone
        formatter.setLocalizedDateFormatFromTemplate("MMMMd")
        return formatter.string(from: date)
    }

    static func parseISO(_ text: String) -> Date? {
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = withFraction.date(from: text) { return date }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: text)
    }

    /// Localized message for a failed call. A bare 429 reads as a rate limit;
    /// an unknown code falls back to the server's English text, then to the
    /// generic fallback.
    static func apiErrorMessage(_ body: ApiErrorBody?, status: Int?, lang: AppLang) -> String {
        let code = body?.code ?? (status == 429 ? "rate_limited" : nil)
        if let code, knownCodes.contains(code) {
            switch code {
            case "fair_use":
                guard let date = formatDate(body?.resetsAt, lang: lang) else { return L10n.errorFairUseSoon(lang) }
                return L10n.errorFairUse(lang, date: date)
            case "rate_limited":
                return L10n.errorRateLimited(lang, wait: formatWait(body?.retryAfterSec, lang: lang))
            case "daily_cap":
                return L10n.errorDailyCap(lang, wait: formatWait(body?.retryAfterSec, lang: lang))
            case "bad_origin":
                return L10n.appErrorBadOrigin(lang)
            default:
                if let text = L10n.text("error.\(code)", lang) { return text }
            }
        }
        if let text = body?.error, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return text }
        return L10n.errorFallback(lang)
    }

    static func message(_ error: APIError, lang: AppLang) -> String {
        switch error {
        case .server(let status, let body): return apiErrorMessage(body, status: status, lang: lang)
        case .offline: return L10n.appErrorOffline(lang)
        case .timeout: return L10n.appErrorTimeout(lang)
        case .malformed: return L10n.errorFallback(lang)
        case .botCheck: return L10n.appTurnstileError(lang)
        case .interrupted: return L10n.appErrorInterrupted(lang)
        }
    }
}
