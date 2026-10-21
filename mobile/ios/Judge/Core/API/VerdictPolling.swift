import Foundation

/// How POST /api/v1/verdict was answered.
enum VerdictStart: Sendable, Equatable {
    /// 200: judged within the request (a server that ignored the preference).
    case ready(VerdictPayload)
    /// 202: judged in the background; poll for it.
    case accepted(VerdictAccepted)
}

/// Polling ended without a verdict. `resumable` is false when the server
/// settled the verdict (failed, not found or removed): polling the same id
/// again would only repeat that. After network trouble, server hiccups or
/// the deadline the verdict may still arrive, so the id is worth keeping.
struct VerdictPollError: Error, Sendable, Equatable {
    let error: APIError
    let resumable: Bool
}

/// Port of POLL_POLICY and nextPollDelay (lib/verdict-poll.ts), plus a limit
/// on failed polls in a row. Times are in milliseconds, like the server's
/// `pollAfterMs`.
struct PollPolicy: Sendable, Equatable {
    /// The `Prefer` token that asks for a 202 instead of waiting (RFC 7240).
    static let respondAsync = "respond-async"
    static let standard = PollPolicy()

    /// The first wait when the 202 names none, and the base of the backoff.
    var firstMs: Double = 2000
    var factor: Double = 1.5
    /// Longest wait while the server answers "judging".
    var maxMs: Double = 5000
    /// Longest wait after failed polls.
    var errorMaxMs: Double = 15_000
    /// No wait is ever longer, whatever the server suggests.
    var capMs: Double = 60_000
    /// Give up after this long. The server fails a verdict still judging
    /// after 10 minutes, so the app normally hears "failed" first.
    var deadlineMs: Double = 11 * 60_000
    /// One poll; a dead connection must not stall polling.
    var requestTimeout: TimeInterval = 20
    /// Failed polls in a row (offline, 5xx, 429, unreadable) before giving up.
    var maxConsecutiveErrors = 5

    /// Milliseconds to wait before poll number `attempt` after `errors`
    /// failed polls in a row: grows 1.5x per poll up to `maxMs`, doubles per
    /// error up to `errorMaxMs`; a larger server hint always wins.
    func delayMs(attempt: Int, errors: Int = 0, hintMs: Double? = nil) -> Double {
        let steady = min(maxMs, firstMs * pow(factor, Double(max(0, attempt))))
        let backoff = errors > 0 ? min(errorMaxMs, firstMs * pow(2, Double(errors))) : 0
        let hint = hintMs.flatMap { $0.isFinite ? $0 : nil } ?? 0
        return min(capMs, max(steady, backoff, hint)).rounded()
    }

    /// The wait before the first poll: the 202's `pollAfterMs` as given.
    func firstDelayMs(hintMs: Double?) -> Double {
        let hint = hintMs.flatMap { $0.isFinite ? $0 : nil } ?? firstMs
        return min(capMs, max(0, hint))
    }
}

extension JudgeAPI {
    private enum PollStep: Sendable {
        case judging(hintMs: Double?)
        case ready(VerdictPayload)
        case settled(APIError)
        case transient(APIError, hintMs: Double?)
    }

    /// Polls GET /api/v1/verdicts/{id} until the accepted verdict is ready
    /// and returns it merged with the 202's name map and owner token. A
    /// failed verdict maps to the same `APIError` its synchronous 502 did.
    /// Throws `CancellationError` when the task is cancelled, otherwise a
    /// `VerdictPollError`.
    func awaitVerdict(_ accepted: VerdictAccepted) async throws -> VerdictPayload {
        let policy = pollPolicy
        let clock = ContinuousClock()
        let deadline = clock.now.advanced(by: Duration.milliseconds(policy.deadlineMs))
        let url = endpoint("verdicts").appending(component: accepted.id)
        var request = makeRequest(url: url, method: "GET", timeout: policy.requestTimeout)
        if let token = accepted.ownerToken {
            request.setValue(token, forHTTPHeaderField: "X-Owner-Token")
        }

        var attempt = 0
        var errors = 0
        var wait = policy.firstDelayMs(hintMs: accepted.pollAfterMs)
        while true {
            let remaining = clock.now.duration(to: deadline)
            guard remaining > .zero else { throw VerdictPollError(error: .timeout, resumable: true) }
            try await Task.sleep(for: min(Duration.milliseconds(wait), remaining), clock: clock)
            guard clock.now < deadline else { throw VerdictPollError(error: .timeout, resumable: true) }

            switch try await poll(request, accepted: accepted) {
            case .ready(let payload):
                return payload
            case .settled(let failure):
                throw VerdictPollError(error: failure, resumable: false)
            case .judging(let hint):
                errors = 0
                attempt += 1
                wait = policy.delayMs(attempt: attempt, hintMs: hint)
            case .transient(let failure, let hint):
                errors += 1
                if errors >= policy.maxConsecutiveErrors {
                    throw VerdictPollError(error: failure, resumable: true)
                }
                wait = policy.delayMs(attempt: attempt, errors: errors, hintMs: hint)
            }
        }
    }

    /// One poll. Only a ready, failed, 404 or 410 answer settles anything;
    /// everything else is worth another try.
    private func poll(_ request: URLRequest, accepted: VerdictAccepted) async throws -> PollStep {
        let received: (Data, URLResponse)
        do {
            received = try await session.data(for: request)
        } catch {
            if APIError.isCancellation(error) || Task.isCancelled { throw CancellationError() }
            return .transient(APIError.from(transport: error), hintMs: nil)
        }
        try Task.checkCancellation()
        let (data, response) = received
        guard let http = response as? HTTPURLResponse else { return .transient(.malformed, hintMs: nil) }
        let retryAfter = http.value(forHTTPHeaderField: "Retry-After")
        let retryAfterMs = retryAfter
            .flatMap { Double($0.trimmingCharacters(in: .whitespaces)) }
            .flatMap { $0.isFinite && $0 >= 0 ? $0 * 1000 : nil }

        switch http.statusCode {
        case 200:
            guard let answer = try? WireDecoding.pollAnswer(from: data) else {
                return .transient(.malformed, hintMs: retryAfterMs)
            }
            switch answer {
            case .judging(let hint):
                return .judging(hintMs: hint ?? retryAfterMs)
            case .failed(let code, let message):
                return .settled(.server(status: 502, body: ApiErrorBody(error: message, code: code)))
            case .ready(let result):
                return .ready(VerdictPayload(
                    id: accepted.id,
                    result: result,
                    nameMap: accepted.nameMap,
                    ownerToken: accepted.ownerToken
                ))
            }
        case 404, 410:
            var body = WireDecoding.errorBody(from: data) ?? ApiErrorBody()
            if body.code == nil { body.code = http.statusCode == 410 ? "removed" : "not_found" }
            return .settled(.server(status: http.statusCode, body: body))
        default:
            let failure = APIError.from(status: http.statusCode, body: data, retryAfterHeader: retryAfter)
            return .transient(failure, hintMs: retryAfterMs)
        }
    }
}
