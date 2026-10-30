import SwiftData
import XCTest
@testable import Judge

/// Scripted answers for one verdict: the POST reply, then the poll replies in
/// order; the last poll reply repeats once the script runs out.
private final class ScriptedServer: @unchecked Sendable {
    private let lock = NSLock()
    private let post: StubURLProtocol.Reply
    private var polls: [StubURLProtocol.Reply]
    private var answered = 0

    /// Polls answered so far (read under the lock, unlike the stub's log).
    var pollCount: Int {
        lock.lock()
        defer { lock.unlock() }
        return answered
    }

    init(post: StubURLProtocol.Reply, polls: [StubURLProtocol.Reply] = []) {
        self.post = post
        self.polls = polls
    }

    func reply(to request: URLRequest) -> StubURLProtocol.Reply {
        lock.lock()
        defer { lock.unlock() }
        if request.httpMethod == "POST" { return post }
        answered += 1
        guard let first = polls.first else { return StubURLProtocol.Reply(error: URLError(.unknown)) }
        if polls.count > 1 { polls.removeFirst() }
        return first
    }
}

/// Async verdicts (202, then GET /api/v1/verdicts/{id}), with bodies built
/// from the shared verdict fixtures.
final class VerdictPollingTests: XCTestCase {
    private static let ownerToken = "own3r-t0ken"

    override func setUp() {
        super.setUp()
        StubURLProtocol.handler = nil
        StubURLProtocol.requests = []
    }

    override func tearDown() {
        StubURLProtocol.handler = nil
        super.tearDown()
    }

    // MARK: - Helpers

    private static let fastPolicy = PollPolicy(
        firstMs: 10, factor: 1.5, maxMs: 20, errorMaxMs: 40, capMs: 100,
        deadlineMs: 10_000, requestTimeout: 5, maxConsecutiveErrors: 3
    )

    private func api(policy: PollPolicy = VerdictPollingTests.fastPolicy) -> JudgeAPI {
        JudgeAPI(
            baseURL: AppConfig.production,
            userAgent: "Judge-iOS/1.0.0 (1)",
            session: JudgeAPI.makeSession(protocolClasses: [StubURLProtocol.self]),
            pollPolicy: policy
        )
    }

    private func request() -> VerdictRequest {
        VerdictRequest(argument: "Alex says Jordan should pay for the broken lamp.", lang: .en)
    }

    private func fixture(_ name: String) throws -> [String: Any] {
        let responses = try XCTUnwrap(Fixtures.verdicts()["verdictResponses"] as? [String: Any])
        return try XCTUnwrap(responses[name] as? [String: Any], "missing sample \(name)")
    }

    private func json(_ status: Int, _ object: [String: Any], headers: [String: String] = [:]) throws -> StubURLProtocol.Reply {
        var all = ["Content-Type": "application/json"]
        all.merge(headers) { _, new in new }
        return StubURLProtocol.Reply(status: status, headers: all, body: try JSONSerialization.data(withJSONObject: object))
    }

    /// The 202 the server sends for a signed-out writer (lib/free-async.ts).
    private func acceptedReply(_ sample: [String: Any], pollAfterMs: Int = 10) throws -> StubURLProtocol.Reply {
        let id = try XCTUnwrap(sample["id"] as? String)
        return try json(202, [
            "id": id,
            "status": "judging",
            "pollAfterMs": pollAfterMs,
            "poll": "/api/v1/verdicts/\(id)",
            "name_map": sample["name_map"] ?? [Any](),
            "owner_token": Self.ownerToken,
            "suggested_display_a": NSNull(),
        ], headers: ["Retry-After": "2", "Preference-Applied": "respond-async"])
    }

    private func judging(_ sample: [String: Any]) throws -> StubURLProtocol.Reply {
        try json(200, ["id": try XCTUnwrap(sample["id"] as? String), "status": "judging", "pollAfterMs": 10])
    }

    /// A ready poll: the stored verdict, without name_map or owner_token.
    private func ready(_ sample: [String: Any]) throws -> StubURLProtocol.Reply {
        try json(200, [
            "id": try XCTUnwrap(sample["id"] as? String),
            "result": try XCTUnwrap(sample["result"]),
            "createdAt": "2026-10-20T10:00:00.000Z",
            "display": ["a": NSNull(), "b": NSNull()],
            "status": "ready",
            "owner": ["originals_stored": true, "display": ["namesVisible": false]] as [String: Any],
        ])
    }

    private func failed(_ sample: [String: Any], code: String, error: String) throws -> StubURLProtocol.Reply {
        try json(200, ["id": try XCTUnwrap(sample["id"] as? String), "status": "failed", "code": code, "error": error])
    }

    private var polls: [URLRequest] { StubURLProtocol.requests.filter { $0.httpMethod == "GET" } }

    private func acceptedValue(_ sample: [String: Any]) throws -> VerdictAccepted {
        VerdictAccepted(
            id: try XCTUnwrap(sample["id"] as? String),
            nameMap: Fixtures.nameMap(sample["name_map"]),
            ownerToken: Self.ownerToken,
            pollAfterMs: 10
        )
    }

    // MARK: - Flows

    func testAcceptedThenJudgingTwiceThenReadyKeepsNameMapAndOwnerToken() async throws {
        let sample = try fixture("win_b_named")
        let server = ScriptedServer(post: try acceptedReply(sample), polls: [try judging(sample), try judging(sample), try ready(sample)])
        StubURLProtocol.handler = { server.reply(to: $0) }

        let payload = try await api().verdict(request())

        let direct = try Fixtures.sample("win_b_named")
        XCTAssertFalse(direct.nameMap.isEmpty)
        XCTAssertEqual(payload.id, direct.id)
        XCTAssertEqual(payload.result, direct.result)
        XCTAssertEqual(payload.nameMap, direct.nameMap)
        XCTAssertEqual(payload.ownerToken, Self.ownerToken)

        let sent = StubURLProtocol.requests
        XCTAssertEqual(sent.count, 4)
        XCTAssertEqual(sent.first?.httpMethod, "POST")
        XCTAssertEqual(sent.first?.value(forHTTPHeaderField: "Prefer"), "respond-async")
        XCTAssertEqual(polls.count, 3)
        for poll in polls {
            XCTAssertEqual(poll.url?.absoluteString, "https://okjudge.com/api/v1/verdicts/\(direct.id)")
            XCTAssertEqual(poll.value(forHTTPHeaderField: "X-Owner-Token"), Self.ownerToken)
            XCTAssertEqual(poll.value(forHTTPHeaderField: "Accept"), "application/json")
            XCTAssertEqual(poll.value(forHTTPHeaderField: "User-Agent"), "Judge-iOS/1.0.0 (1)")
            XCTAssertEqual(poll.timeoutInterval, 5)
        }
    }

    func testAcceptedThenFailedQuotaMapsLikeTheSynchronousError() async throws {
        let sample = try fixture("win_a_self")
        let message = "The judge hit its AI quota for now — try again in a few minutes."
        let server = ScriptedServer(post: try acceptedReply(sample), polls: [try judging(sample), try failed(sample, code: "quota", error: message)])
        StubURLProtocol.handler = { server.reply(to: $0) }

        let start = try await api().startVerdict(request())
        guard case .accepted(let accepted) = start else { return XCTFail("expected a 202, got \(start)") }
        do {
            _ = try await api().awaitVerdict(accepted)
            XCTFail("expected a failed verdict")
        } catch let failure as VerdictPollError {
            XCTAssertFalse(failure.resumable)
            XCTAssertEqual(failure.error, .server(status: 502, body: ApiErrorBody(error: message, code: "quota")))
            XCTAssertEqual(failure.error.code, "quota")
            XCTAssertTrue(failure.error.offersRetry)
            XCTAssertEqual(ErrorText.message(failure.error, lang: .en), L10n.errorQuota(.en))
        }
        XCTAssertEqual(polls.count, 2)

        // verdict() reports the same failure as a plain APIError.
        StubURLProtocol.requests = []
        let again = ScriptedServer(post: try acceptedReply(sample), polls: [try failed(sample, code: "quota", error: message)])
        StubURLProtocol.handler = { again.reply(to: $0) }
        do {
            _ = try await api().verdict(request())
            XCTFail("expected quota")
        } catch let error as APIError {
            XCTAssertEqual(error.code, "quota")
        }
    }

    func testFailedUnavailableAndRefused() async throws {
        let sample = try fixture("win_a_self")
        for (code, retry, message) in [("unavailable", true, L10n.errorUnavailable(.tr)), ("refused", false, L10n.refusedNote(.tr))] {
            StubURLProtocol.requests = []
            let server = ScriptedServer(post: try acceptedReply(sample), polls: [try failed(sample, code: code, error: "x")])
            StubURLProtocol.handler = { server.reply(to: $0) }
            do {
                _ = try await api().verdict(request())
                XCTFail("expected \(code)")
            } catch let error as APIError {
                XCTAssertEqual(error.code, code)
                XCTAssertEqual(error.offersRetry, retry, code)
                XCTAssertEqual(ErrorText.message(error, lang: .tr), message, code)
            }
        }
    }

    func testTransientPollErrorsKeepPollingUntilReady() async throws {
        let sample = try fixture("win_b_named")
        let html = StubURLProtocol.Reply(status: 503, headers: ["Content-Type": "text/html"], body: Data("<html>".utf8))
        let server = ScriptedServer(post: try acceptedReply(sample), polls: [
            StubURLProtocol.Reply(error: URLError(.notConnectedToInternet)),
            html,
            try judging(sample),
            StubURLProtocol.Reply(error: URLError(.timedOut)),
            try json(429, ["error": "slow", "code": "rate_limited"], headers: ["Retry-After": "0"]),
            try ready(sample),
        ])
        StubURLProtocol.handler = { server.reply(to: $0) }

        let payload = try await api().verdict(request())

        let direct = try Fixtures.sample("win_b_named")
        XCTAssertEqual(payload.id, direct.id)
        XCTAssertEqual(payload.result, direct.result)
        XCTAssertEqual(payload.nameMap, direct.nameMap)
        XCTAssertEqual(payload.ownerToken, Self.ownerToken)
        XCTAssertEqual(polls.count, 6)
    }

    func testTooManyFailedPollsInARowStopResumably() async throws {
        let sample = try fixture("win_a_self")
        let server = ScriptedServer(post: try acceptedReply(sample), polls: [try json(503, ["error": "x", "code": "unavailable"])])
        StubURLProtocol.handler = { server.reply(to: $0) }
        let accepted = try acceptedValue(sample)
        do {
            _ = try await api().awaitVerdict(accepted)
            XCTFail("expected the polls to give up")
        } catch let failure as VerdictPollError {
            XCTAssertTrue(failure.resumable)
            XCTAssertEqual(failure.error.code, "unavailable")
        }
        XCTAssertEqual(polls.count, Self.fastPolicy.maxConsecutiveErrors)
        XCTAssertTrue(polls.allSatisfy { $0.url?.lastPathComponent == accepted.id })
    }

    func testDeadlineEndsPollingAsAResumableTimeout() async throws {
        let sample = try fixture("win_a_self")
        let server = ScriptedServer(post: try acceptedReply(sample), polls: [try judging(sample)])
        StubURLProtocol.handler = { server.reply(to: $0) }
        var policy = Self.fastPolicy
        policy.deadlineMs = 150
        do {
            _ = try await api(policy: policy).awaitVerdict(try acceptedValue(sample))
            XCTFail("expected a timeout")
        } catch let failure as VerdictPollError {
            XCTAssertEqual(failure, VerdictPollError(error: .timeout, resumable: true))
        }
        XCTAssertGreaterThan(polls.count, 1)
    }

    func testMissingAndRemovedVerdictsSettle() async throws {
        let sample = try fixture("win_a_self")
        let cases: [(StubURLProtocol.Reply, String)] = [
            (try json(404, ["error": "No verdict with that id.", "code": "not_found"]), "not_found"),
            (StubURLProtocol.Reply(status: 410, headers: ["Content-Type": "text/html"], body: Data("gone".utf8)), "removed"),
        ]
        for (reply, code) in cases {
            StubURLProtocol.requests = []
            let server = ScriptedServer(post: try acceptedReply(sample), polls: [reply])
            StubURLProtocol.handler = { server.reply(to: $0) }
            do {
                _ = try await api().awaitVerdict(try acceptedValue(sample))
                XCTFail("expected \(code)")
            } catch let failure as VerdictPollError {
                XCTAssertFalse(failure.resumable)
                XCTAssertEqual(failure.error.code, code)
            }
            XCTAssertEqual(polls.count, 1)
        }
    }

    func testDirect200StillWorksWithoutPolling() async throws {
        let sample = try fixture("win_b_named")
        let server = ScriptedServer(post: try json(200, sample))
        StubURLProtocol.handler = { server.reply(to: $0) }

        let start = try await api().startVerdict(request())
        let direct = try Fixtures.sample("win_b_named")
        XCTAssertEqual(start, .ready(direct))

        let payload = try await api().verdict(request())
        XCTAssertEqual(payload, direct)
        XCTAssertNil(payload.ownerToken)
        XCTAssertEqual(StubURLProtocol.requests.count, 2)
        XCTAssertTrue(StubURLProtocol.requests.allSatisfy { $0.httpMethod == "POST" })
        XCTAssertEqual(StubURLProtocol.requests.last?.value(forHTTPHeaderField: "Prefer"), "respond-async")
        XCTAssertEqual(StubURLProtocol.requests.last?.timeoutInterval, 310)
    }

    func testDirect200CarriesTheOwnerToken() async throws {
        var sample = try fixture("win_a_self")
        sample["owner_token"] = Self.ownerToken
        let server = ScriptedServer(post: try json(200, sample))
        StubURLProtocol.handler = { server.reply(to: $0) }
        let payload = try await api().verdict(request())
        XCTAssertEqual(payload.ownerToken, Self.ownerToken)
    }

    func testMalformedAcceptedBody() async throws {
        let server = ScriptedServer(post: try json(202, ["status": "judging"]))
        StubURLProtocol.handler = { server.reply(to: $0) }
        do {
            _ = try await api().verdict(request())
            XCTFail("expected malformed")
        } catch let error as APIError {
            XCTAssertEqual(error, .malformed)
        }
        XCTAssertEqual(StubURLProtocol.requests.count, 1)
    }

    func testCancellationStopsPolling() async throws {
        let sample = try fixture("win_a_self")
        let server = ScriptedServer(post: try acceptedReply(sample), polls: [try judging(sample)])
        StubURLProtocol.handler = { server.reply(to: $0) }
        let client = api()
        let accepted = try acceptedValue(sample)

        let task = Task { try await client.awaitVerdict(accepted) }
        var waited = 0
        while server.pollCount < 2, waited < 200 {
            try await Task.sleep(for: .milliseconds(10))
            waited += 1
        }
        XCTAssertGreaterThanOrEqual(server.pollCount, 2)
        task.cancel()

        switch await task.result {
        case .success:
            XCTFail("a cancelled poll must not deliver")
        case .failure(let error):
            XCTAssertTrue(error is CancellationError, "got \(error)")
        }
        let stopped = server.pollCount
        try await Task.sleep(for: .milliseconds(200))
        XCTAssertEqual(server.pollCount, stopped)
    }

    // MARK: - Pieces

    func testPollDelaysMatchTheWebsitePolicy() {
        let policy = PollPolicy.standard
        XCTAssertEqual(policy.delayMs(attempt: 0), 2000)
        XCTAssertEqual(policy.delayMs(attempt: 1), 3000)
        XCTAssertEqual(policy.delayMs(attempt: 2), 4500)
        XCTAssertEqual(policy.delayMs(attempt: 3), 5000)
        XCTAssertEqual(policy.delayMs(attempt: 40), 5000)
        XCTAssertEqual(policy.delayMs(attempt: 0, errors: 1), 4000)
        XCTAssertEqual(policy.delayMs(attempt: 0, errors: 2), 8000)
        XCTAssertEqual(policy.delayMs(attempt: 0, errors: 3), 15_000)
        XCTAssertEqual(policy.delayMs(attempt: 1, hintMs: 9000), 9000)
        XCTAssertEqual(policy.delayMs(attempt: 1, hintMs: 1000), 3000)
        XCTAssertEqual(policy.delayMs(attempt: 1, hintMs: 600_000), 60_000)
        XCTAssertEqual(policy.firstDelayMs(hintMs: nil), 2000)
        XCTAssertEqual(policy.firstDelayMs(hintMs: 2500), 2500)
        XCTAssertEqual(policy.firstDelayMs(hintMs: -5), 0)
        XCTAssertEqual(policy.deadlineMs, 11 * 60_000)
    }

    func testPollAnswerDecoding() throws {
        let sample = try fixture("win_a_self")
        let judging = try WireDecoding.pollAnswer(from: Data(#"{"id":"x","status":"judging","pollAfterMs":2000}"#.utf8))
        XCTAssertEqual(judging, .judging(pollAfterMs: 2000))
        let failed = try WireDecoding.pollAnswer(from: Data(#"{"id":"x","status":"failed"}"#.utf8))
        XCTAssertEqual(failed, .failed(code: "unavailable", error: nil))

        // A server from before async verdicts: no status, just the verdict.
        let old = try JSONSerialization.data(withJSONObject: ["id": "abc123DEF0", "result": try XCTUnwrap(sample["result"]), "createdAt": ""] as [String: Any])
        guard case .ready(let raw) = try WireDecoding.pollAnswer(from: old) else { return XCTFail("expected ready") }
        XCTAssertEqual(raw, try Fixtures.sample("win_a_self").result)

        XCTAssertThrowsError(try WireDecoding.pollAnswer(from: Data(#"{"status":"ready","id":"x"}"#.utf8)))
        XCTAssertThrowsError(try WireDecoding.pollAnswer(from: Data("<html>".utf8)))
    }

    func testAcceptedDecoding() throws {
        let body = Data(#"{"id":"j0b","status":"judging","pollAfterMs":2000,"poll":"/api/v1/verdicts/j0b","name_map":[{"original":"Sam","replacement":"Party B"}],"owner_token":"t"}"#.utf8)
        let accepted = try WireDecoding.acceptedPayload(from: body)
        XCTAssertEqual(accepted, VerdictAccepted(id: "j0b", nameMap: [NameMapping(original: "Sam", replacement: "Party B")], ownerToken: "t", pollAfterMs: 2000))
        let bare = try WireDecoding.acceptedPayload(from: Data(#"{"id":"j0b","status":"judging","name_map":[]}"#.utf8))
        XCTAssertNil(bare.ownerToken)
        XCTAssertNil(bare.pollAfterMs)
    }
}

/// HomeModel's request flow against the stub: a verdict the server already
/// accepted is picked up again by "Try again", never asked for twice.
final class HomeResumeTests: XCTestCase {
    private static let text = "Alex says Jordan should pay for the broken lamp because Jordan knocked it over."

    override func setUp() {
        super.setUp()
        StubURLProtocol.handler = nil
        StubURLProtocol.requests = []
    }

    override func tearDown() {
        StubURLProtocol.handler = nil
        super.tearDown()
    }

    /// Verdict POSTs only: every verdict asks POST /api/v1/clarify first.
    private var posts: Int { StubURLProtocol.requests.filter { $0.httpMethod == "POST" && $0.url?.path == "/api/v1/verdict" }.count }

    /// Verdicts need an account, so the app starts signed in unless told otherwise.
    @MainActor
    private func makeApp(container: ModelContainer, token: String? = "s3ss10n") throws -> AppModel {
        let config = AppConfig(apiBaseURL: AppConfig.production, shareBaseURL: AppConfig.production, version: "1", build: "1")
        let defaults = try XCTUnwrap(UserDefaults(suiteName: "judge.tests.\(UUID().uuidString)"))
        let api = JudgeAPI(
            baseURL: AppConfig.production,
            userAgent: "Judge-iOS/test",
            tokenStore: MemoryTokenStore(token: token),
            session: JudgeAPI.makeSession(protocolClasses: [StubURLProtocol.self]),
            pollPolicy: PollPolicy(
                firstMs: 10, factor: 1.5, maxMs: 20, errorMaxMs: 40, capMs: 100,
                deadlineMs: 10_000, requestTimeout: 5, maxConsecutiveErrors: 3
            )
        )
        let app = AppModel(config: config, container: container, defaults: defaults, persistsDraft: false, api: api)
        app.account.usesNetwork = false
        app.home.argument = Self.text
        return app
    }

    @MainActor
    private func waitUntil(_ what: String, _ condition: () -> Bool) async throws {
        var waited = 0
        while !condition(), waited < 500 {
            try await Task.sleep(for: .milliseconds(10))
            waited += 1
        }
        XCTAssertTrue(condition(), "timed out waiting for \(what)")
    }

    private func namedSample() throws -> [String: Any] {
        let responses = try XCTUnwrap(Fixtures.verdicts()["verdictResponses"] as? [String: Any])
        return try XCTUnwrap(responses["win_b_named"] as? [String: Any])
    }

    private func reply(_ status: Int, _ object: [String: Any]) throws -> StubURLProtocol.Reply {
        StubURLProtocol.Reply(status: status, headers: ["Content-Type": "application/json"], body: try JSONSerialization.data(withJSONObject: object))
    }

    private func accepted(_ sample: [String: Any]) throws -> StubURLProtocol.Reply {
        try reply(202, [
            "id": try XCTUnwrap(sample["id"] as? String),
            "status": "judging",
            "pollAfterMs": 10,
            "name_map": sample["name_map"] ?? [Any](),
            "owner_token": "own3r",
        ])
    }

    private func ready(_ sample: [String: Any]) throws -> StubURLProtocol.Reply {
        try reply(200, [
            "id": try XCTUnwrap(sample["id"] as? String),
            "result": try XCTUnwrap(sample["result"]),
            "createdAt": "2026-10-20T10:00:00.000Z",
            "status": "ready",
        ])
    }

    @MainActor
    func testTryAgainAfterFailedPollsResumesWithoutASecondPost() async throws {
        let container = HistoryContainer.inMemory()
        let app = try makeApp(container: container)
        let home = app.home
        let sample = try namedSample()
        let id = try XCTUnwrap(sample["id"] as? String)

        let flaky = ScriptedServer(post: try accepted(sample), polls: [try reply(503, ["error": "x", "code": "unavailable"])])
        StubURLProtocol.handler = { flaky.reply(to: $0) }
        home.submit(app: app)
        try await waitUntil("the poll failure") { home.error != nil }
        XCTAssertEqual(home.error?.code, "unavailable")
        XCTAssertFalse(home.isJudging)
        XCTAssertEqual(posts, 1)

        let healthy = ScriptedServer(post: try accepted(sample), polls: [try reply(200, ["id": id, "status": "judging", "pollAfterMs": 10]), try ready(sample)])
        StubURLProtocol.handler = { healthy.reply(to: $0) }
        home.submit(app: app)
        try await waitUntil("the verdict") { home.arrived != nil }
        XCTAssertNil(home.error)
        XCTAssertEqual(posts, 1, "Try again must poll the accepted verdict, not ask for a new one")
        XCTAssertEqual(home.session(id)?.nameMap, Fixtures.nameMap(sample["name_map"]))
        XCTAssertEqual(try app.history.all().map(\.id), [id])
        withExtendedLifetime(container) {}
    }

    @MainActor
    func testClosingTheCoverKeepsTheAcceptedVerdict() async throws {
        let container = HistoryContainer.inMemory()
        let app = try makeApp(container: container)
        let home = app.home
        let sample = try namedSample()
        let id = try XCTUnwrap(sample["id"] as? String)

        let slow = ScriptedServer(post: try accepted(sample), polls: [try reply(200, ["id": id, "status": "judging", "pollAfterMs": 10])])
        StubURLProtocol.handler = { slow.reply(to: $0) }
        home.submit(app: app)
        try await waitUntil("polling") { slow.pollCount >= 1 }
        home.cancel()
        XCTAssertFalse(home.isJudging)

        let healthy = ScriptedServer(post: try accepted(sample), polls: [try ready(sample)])
        StubURLProtocol.handler = { healthy.reply(to: $0) }
        home.submit(app: app)
        try await waitUntil("the verdict") { home.arrived != nil }
        XCTAssertEqual(posts, 1)
        XCTAssertNotNil(home.session(id))
        withExtendedLifetime(container) {}
    }

    @MainActor
    func testASettledFailureAsksForANewVerdict() async throws {
        let container = HistoryContainer.inMemory()
        let app = try makeApp(container: container)
        let home = app.home
        let sample = try namedSample()
        let id = try XCTUnwrap(sample["id"] as? String)

        let quota = ScriptedServer(post: try accepted(sample), polls: [try reply(200, ["id": id, "status": "failed", "code": "quota", "error": "x"])])
        StubURLProtocol.handler = { quota.reply(to: $0) }
        home.submit(app: app)
        try await waitUntil("the failed verdict") { home.error != nil }
        XCTAssertEqual(home.error?.code, "quota")
        XCTAssertEqual(posts, 1)

        let healthy = ScriptedServer(post: try accepted(sample), polls: [try ready(sample)])
        StubURLProtocol.handler = { healthy.reply(to: $0) }
        home.submit(app: app)
        try await waitUntil("the verdict") { home.arrived != nil }
        XCTAssertEqual(posts, 2)
        withExtendedLifetime(container) {}
    }

    @MainActor
    func testSignedOutSubmitOpensSignInAndSubmitsAfterSigningIn() async throws {
        let container = HistoryContainer.inMemory()
        let app = try makeApp(container: container, token: nil)
        let home = app.home
        let sample = try namedSample()
        let server = ScriptedServer(post: try accepted(sample), polls: [try ready(sample)])
        let sent = try reply(200, ["success": true])
        let signedIn = try reply(200, ["token": "fr3sh", "user": ["id": "u1", "email": "sam@example.com", "name": "Sam", "image": NSNull()] as [String: Any]])
        StubURLProtocol.handler = { request in
            let path = request.url?.path ?? ""
            if path.hasSuffix("/email-otp/send-verification-otp") { return sent }
            if path.hasSuffix("/sign-in/email-otp") { return signedIn }
            return server.reply(to: request)
        }
        var verdictPosts: Int {
            StubURLProtocol.requests.filter { $0.httpMethod == "POST" && $0.url?.path == "/api/v1/verdict" }.count
        }

        home.submit(app: app)
        XCTAssertTrue(app.account.isSignInPresented, "signed out, Get the verdict opens sign-in")
        XCTAssertFalse(home.isJudging)
        XCTAssertTrue(StubURLProtocol.requests.isEmpty, "no verdict request while signed out")

        // Swiping the sheet away does not submit.
        app.account.isSignInPresented = false
        app.account.signInDismissed()
        XCTAssertTrue(StubURLProtocol.requests.isEmpty)

        home.submit(app: app)
        XCTAssertTrue(app.account.isSignInPresented)
        app.account.email = "sam@example.com"
        app.account.setAgeTicked(true)
        await app.account.sendCode(lang: .en)
        app.account.code = "123456"
        await app.account.verifyCode()
        XCTAssertTrue(app.account.isSignedIn)
        XCTAssertFalse(app.account.isSignInPresented, "signing in closes the sheet")
        XCTAssertEqual(verdictPosts, 0, "the verdict waits for the sheet to close")
        app.account.signInDismissed()
        try await waitUntil("the verdict") { home.arrived != nil }
        XCTAssertEqual(verdictPosts, 1)
        let verdictRequest = StubURLProtocol.requests.first { $0.url?.path == "/api/v1/verdict" }
        XCTAssertEqual(verdictRequest?.value(forHTTPHeaderField: "Authorization"), "Bearer fr3sh")
        withExtendedLifetime(container) {}
    }

    @MainActor
    func testVerdict401SignsOutWithoutAnErrorBox() async throws {
        let container = HistoryContainer.inMemory()
        let app = try makeApp(container: container)
        let home = app.home
        let refused = ScriptedServer(post: try reply(401, ["error": "Sign in first.", "code": "signin_required"]))
        StubURLProtocol.handler = { refused.reply(to: $0) }

        home.submit(app: app)
        try await waitUntil("the sign-out") { !app.account.isSignedIn }
        XCTAssertNil(app.api.tokenStore.token())
        XCTAssertEqual(app.account.notice, .sessionExpired)
        XCTAssertNil(home.error)
        XCTAssertFalse(home.isJudging)
        try await waitUntil("the sign-in sheet") { app.account.isSignInPresented }
        withExtendedLifetime(container) {}
    }
}
