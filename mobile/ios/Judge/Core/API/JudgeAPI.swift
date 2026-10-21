import Foundation

/// Where a signed-in session token lives: the Keychain in the app
/// (`KeychainTokenStore`), memory in tests and screenshot states.
protocol TokenStore: Sendable {
    func token() -> String?
    func setToken(_ token: String)
    func clear()
}

struct NoTokenStore: TokenStore {
    func token() -> String? { nil }
    func setToken(_ token: String) {}
    func clear() {}
}

/// Client for the `/api/v1` JSON API. A value type holding only Sendable
/// state, so calls run off the main actor and can be made from anywhere.
/// The verdict POST is never retried automatically: a retry would cost the
/// user's rate limit and a second verdict. It asks to be answered at once
/// (`Prefer: respond-async`) and then polls for the verdict, because a
/// proxy ends a request held open for minutes.
struct JudgeAPI: Sendable {
    enum Timeout {
        /// Server-side work can take about 285 s (judges, escalation, trial).
        static let verdict: TimeInterval = 310
        static let translate: TimeInterval = 90
        static let get: TimeInterval = 20
    }

    let baseURL: URL
    let session: URLSession
    let tokenStore: any TokenStore
    let userAgent: String
    let pollPolicy: PollPolicy

    init(
        baseURL: URL,
        userAgent: String,
        tokenStore: any TokenStore = NoTokenStore(),
        session: URLSession = JudgeAPI.makeSession(),
        pollPolicy: PollPolicy = .standard
    ) {
        self.baseURL = baseURL
        self.userAgent = userAgent
        self.tokenStore = tokenStore
        self.session = session
        self.pollPolicy = pollPolicy
    }

    /// No cookies, no cache; the long verdict timeout as the session default
    /// so a per-request value can only shorten it.
    static func makeSession(protocolClasses: [AnyClass]? = nil) -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = Timeout.verdict
        configuration.timeoutIntervalForResource = Timeout.verdict + 30
        configuration.httpShouldSetCookies = false
        configuration.httpCookieAcceptPolicy = .never
        configuration.urlCache = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.waitsForConnectivity = false
        if let protocolClasses { configuration.protocolClasses = protocolClasses }
        return URLSession(configuration: configuration)
    }

    // MARK: - Calls

    /// A verdict, start to finish: the POST, then polling when it was
    /// accepted. Throws `CancellationError` or an `APIError`.
    func verdict(_ body: VerdictRequest) async throws -> VerdictPayload {
        switch try await startVerdict(body) {
        case .ready(let payload):
            return payload
        case .accepted(let accepted):
            do {
                return try await awaitVerdict(accepted)
            } catch let failure as VerdictPollError {
                throw failure.error
            }
        }
    }

    /// The verdict POST alone. A server that ignores the preference (or an
    /// older one) still answers 200 with the verdict, so the long timeout stays.
    func startVerdict(_ body: VerdictRequest) async throws -> VerdictStart {
        var request = makeRequest(url: endpoint("verdict"), method: "POST", timeout: Timeout.verdict)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(PollPolicy.respondAsync, forHTTPHeaderField: "Prefer")
        request.httpBody = try JSONEncoder().encode(body)
        let (data, response) = try await exchange(request)
        do {
            if response.statusCode == 202 {
                return .accepted(try WireDecoding.acceptedPayload(from: data))
            }
            return .ready(try WireDecoding.verdictPayload(from: data))
        } catch {
            throw APIError.malformed
        }
    }

    func translate(id: String, to lang: AppLang) async throws -> TranslatePayload {
        let url = endpoint("verdicts").appending(component: id).appending(path: "translate")
            .appending(queryItems: [URLQueryItem(name: "lang", value: lang.rawValue)])
        let request = makeRequest(url: url, method: "POST", timeout: Timeout.translate)
        let data = try await send(request)
        do {
            return try WireDecoding.translatePayload(from: data)
        } catch {
            throw APIError.malformed
        }
    }

    func storedVerdict(id: String) async throws -> StoredPayload {
        let url = endpoint("verdicts").appending(component: id)
        let request = makeRequest(url: url, method: "GET", timeout: Timeout.get)
        let data = try await send(request)
        do {
            return try WireDecoding.storedPayload(from: data)
        } catch {
            throw APIError.malformed
        }
    }

    // MARK: - Plumbing

    func endpoint(_ path: String) -> URL {
        baseURL.appending(path: "api/v1").appending(path: path)
    }

    func makeRequest(url: URL, method: String, timeout: TimeInterval) -> URLRequest {
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: timeout)
        request.httpMethod = method
        request.httpShouldHandleCookies = false
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue(userAgent, forHTTPHeaderField: "User-Agent")
        if let token = tokenStore.token(), !token.isEmpty {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        return request
    }

    /// Sends once. Throws `CancellationError` when cancelled, otherwise an `APIError`.
    func send(_ request: URLRequest) async throws -> Data {
        try await exchange(request).data
    }

    /// `send`, keeping the response for callers that branch on the status.
    func exchange(_ request: URLRequest) async throws -> (data: Data, response: HTTPURLResponse) {
        let received: (Data, URLResponse)
        do {
            received = try await session.data(for: request)
        } catch {
            if APIError.isCancellation(error) { throw CancellationError() }
            throw APIError.from(transport: error)
        }
        let (data, response) = received
        guard let http = response as? HTTPURLResponse else { throw APIError.malformed }
        guard (200..<300).contains(http.statusCode) else {
            let failure = APIError.from(
                status: http.statusCode,
                body: data,
                retryAfterHeader: http.value(forHTTPHeaderField: "Retry-After")
            )
            if http.statusCode == 401, failure.code == "signin_required",
               let sent = request.value(forHTTPHeaderField: "Authorization"),
               let current = tokenStore.token(), sent == "Bearer \(current)" {
                // The session expired; AccountModel signs out on this code.
                // A token that replaced the one sent (a new sign-in) stays.
                tokenStore.clear()
            }
            throw failure
        }
        return (data, http)
    }
}
