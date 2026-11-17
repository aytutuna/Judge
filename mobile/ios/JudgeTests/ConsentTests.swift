import XCTest
@testable import Judge

private func stubReply(_ body: String, status: Int = 200) -> StubURLProtocol.Reply {
    StubURLProtocol.Reply(status: status, body: Data(body.utf8))
}

@MainActor
final class ConsentTests: XCTestCase {
    override func setUp() {
        super.setUp()
        StubURLProtocol.requests = []
    }

    override func tearDown() {
        StubURLProtocol.handler = nil
        super.tearDown()
    }

    private func api() -> JudgeAPI {
        JudgeAPI(
            baseURL: AppConfig.production,
            userAgent: "Judge-iOS/1.0.0 (1)",
            session: JudgeAPI.makeSession(protocolClasses: [StubURLProtocol.self])
        )
    }

    private func sentBody(_ request: URLRequest) throws -> [String: Any] {
        let data = try XCTUnwrap(request.httpBody)
        return try XCTUnwrap(try JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    func testCardShowsOnlyWhenTheServerAsks() async throws {
        StubURLProtocol.handler = { _ in stubReply(#"{"state":"not_asked","updatedAt":null,"policyVersion":"2026-11-14","ask":true,"sensitiveAgreed":true}"#) }
        let model = ConsentModel(api: api())
        XCTAssertFalse(model.showCard)
        await model.load()
        XCTAssertTrue(model.showCard)
        XCTAssertFalse(model.on)
    }

    func testCardStaysHiddenBeforeTheSecondVerdict() async throws {
        StubURLProtocol.handler = { _ in stubReply(#"{"state":"not_asked","updatedAt":null,"policyVersion":"2026-11-14","ask":false,"sensitiveAgreed":false}"#) }
        let model = ConsentModel(api: api())
        await model.load()
        XCTAssertEqual(model.state, .notAsked)
        XCTAssertFalse(model.showCard)
    }

    func testCardAnswerIsSentAndNeverAsksAgain() async throws {
        StubURLProtocol.handler = { request in
            request.httpMethod == "POST"
                ? stubReply(#"{"state":"on","updatedAt":"2026-11-14T10:00:00.000Z","policyVersion":"2026-11-14"}"#)
                : stubReply(#"{"state":"not_asked","updatedAt":null,"policyVersion":"2026-11-14","ask":true}"#)
        }
        let model = ConsentModel(api: api())
        await model.load()
        await model.answerCard(true, lang: .tr)
        XCTAssertTrue(model.on)
        XCTAssertFalse(model.showCard)
        let body = try sentBody(StubURLProtocol.requests.last!)
        XCTAssertEqual(body["choice"] as? String, "on")
        XCTAssertEqual(body["source"] as? String, "card")
        XCTAssertEqual(body["wordingKey"] as? String, "consent.cardBody")
        XCTAssertEqual(body["lang"] as? String, "tr")
        XCTAssertEqual(body["platform"] as? String, "ios")
    }

    func testFailedAnswerKeepsTheCard() async throws {
        StubURLProtocol.handler = { request in
            request.httpMethod == "POST"
                ? stubReply(#"{"error":"down","code":"unavailable"}"#, status: 503)
                : stubReply(#"{"state":"not_asked","updatedAt":null,"policyVersion":"2026-11-14","ask":true}"#)
        }
        let model = ConsentModel(api: api())
        await model.load()
        await model.answerCard(false, lang: .en)
        XCTAssertTrue(model.showCard)
    }

    func testSwitchSendsItsOwnSource() async throws {
        StubURLProtocol.handler = { _ in stubReply(#"{"state":"off","updatedAt":null,"policyVersion":"2026-11-14"}"#) }
        let model = ConsentModel(api: api())
        await model.setSwitch(false, lang: .en)
        XCTAssertEqual(model.state, .off)
        let body = try sentBody(StubURLProtocol.requests.last!)
        XCTAssertEqual(body["source"] as? String, "switch")
        XCTAssertEqual(body["wordingKey"] as? String, "consent.switchDetail")
    }

    func testAgreementIsPostedWithLanguageAndPlatform() async throws {
        StubURLProtocol.handler = { _ in stubReply(#"{"agreed":true,"at":"2026-11-15T10:00:00.000Z"}"#) }
        try await api().agreeToSensitive(lang: .tr)
        let request = try XCTUnwrap(StubURLProtocol.requests.last)
        XCTAssertEqual(request.url?.path, "/api/v1/me/agreement")
        let body = try sentBody(request)
        XCTAssertEqual(body["lang"] as? String, "tr")
        XCTAssertEqual(body["platform"] as? String, "ios")
    }

    func testRefusedRequestIsSentAgainAfterAgreeing() async throws {
        let seen = Counter()
        StubURLProtocol.handler = { _ in
            seen.next() == 1
                ? stubReply(#"{"error":"Agree first.","code":"agreement_required"}"#, status: 403)
                : stubReply(#"{"state":"on","updatedAt":null,"policyVersion":"2026-11-14"}"#)
        }
        let asked = Counter()
        let agreeing = JudgeAPI(
            baseURL: AppConfig.production,
            userAgent: "Judge-iOS/1.0.0 (1)",
            tokenStore: HeldToken(),
            session: JudgeAPI.makeSession(protocolClasses: [StubURLProtocol.self]),
            askAgreement: { asked.next() > 0 }
        )
        let state = try await agreeing.setConsent(on: true, source: .card, wordingKey: "consent.cardBody", lang: .en)
        XCTAssertEqual(state, .on)
        XCTAssertEqual(StubURLProtocol.requests.count, 2)
        XCTAssertEqual(asked.next(), 2)
    }

    func testDeclinedAgreementKeepsTheRefusal() async throws {
        StubURLProtocol.handler = { _ in stubReply(#"{"error":"Agree first.","code":"agreement_required"}"#, status: 403) }
        let declining = JudgeAPI(
            baseURL: AppConfig.production,
            userAgent: "Judge-iOS/1.0.0 (1)",
            tokenStore: HeldToken(),
            session: JudgeAPI.makeSession(protocolClasses: [StubURLProtocol.self]),
            askAgreement: { false }
        )
        do {
            _ = try await declining.setConsent(on: true, source: .card, wordingKey: "consent.cardBody", lang: .en)
            XCTFail("expected a refusal")
        } catch let error as APIError {
            XCTAssertEqual(error.code, "agreement_required")
        }
        XCTAssertEqual(StubURLProtocol.requests.count, 1)
    }

    func testAgreementModelAnswersTheWaitingRequest() async throws {
        let model = AgreementModel()
        model.send = { _ in }
        let waiting = Task { await model.ask() }
        while !model.asking { await Task.yield() }
        await model.confirm(lang: .en)
        let agreed = await waiting.value
        XCTAssertTrue(agreed)
        XCTAssertFalse(model.asking)
    }

    func testAgreementModelCancelAndFailure() async throws {
        let model = AgreementModel()
        model.send = { _ in throw APIError.offline }
        let waiting = Task { await model.ask() }
        while !model.asking { await Task.yield() }
        await model.confirm(lang: .en)
        XCTAssertTrue(model.failed)
        XCTAssertTrue(model.asking)
        model.cancel()
        let agreed = await waiting.value
        XCTAssertFalse(agreed)
    }

    func testRatingRoundTrip() async throws {
        StubURLProtocol.handler = { request in
            request.httpMethod == "PUT"
                ? stubReply(#"{"rating":null}"#)
                : stubReply(#"{"id":"v1","rating":"down"}"#)
        }
        let rating = try await api().rating(id: "v1")
        XCTAssertEqual(rating, .down)
        try await api().setRating(id: "v1", nil)
        let put = try XCTUnwrap(StubURLProtocol.requests.last)
        XCTAssertEqual(put.url?.path, "/api/v1/verdicts/v1/rating")
        XCTAssertTrue(try sentBody(put)["rating"] is NSNull)
        try await api().setRating(id: "v1", .up)
        XCTAssertEqual(try sentBody(StubURLProtocol.requests.last!)["rating"] as? String, "up")
    }
}

private struct HeldToken: TokenStore {
    func token() -> String? { "t0ken" }
    func setToken(_ token: String) {}
    func clear() {}
}

private final class Counter: @unchecked Sendable {
    private let lock = NSLock()
    private var value = 0

    func next() -> Int {
        lock.lock()
        defer { lock.unlock() }
        value += 1
        return value
    }
}
