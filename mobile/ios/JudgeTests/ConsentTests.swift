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

    private func defaults() throws -> UserDefaults {
        try XCTUnwrap(UserDefaults(suiteName: "judge.tests.\(UUID().uuidString)"))
    }

    private func sentBody(_ request: URLRequest) throws -> [String: Any] {
        let data = try XCTUnwrap(request.httpBody)
        return try XCTUnwrap(try JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    func testCardShowsOnlyWhileNotAsked() async throws {
        StubURLProtocol.handler = { _ in stubReply(#"{"state":"not_asked","updatedAt":null,"policyVersion":"2026-11-14"}"#) }
        let model = ConsentModel(api: api(), defaults: try defaults())
        XCTAssertFalse(model.showCard)
        await model.load()
        XCTAssertTrue(model.showCard)
        XCTAssertFalse(model.on)
    }

    func testCardAnswerIsSentAndNeverAsksAgain() async throws {
        let store = try defaults()
        StubURLProtocol.handler = { request in
            request.httpMethod == "POST"
                ? stubReply(#"{"state":"on","updatedAt":"2026-11-14T10:00:00.000Z","policyVersion":"2026-11-14"}"#)
                : stubReply(#"{"state":"not_asked","updatedAt":null,"policyVersion":"2026-11-14"}"#)
        }
        let model = ConsentModel(api: api(), defaults: store)
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

        // A new run on the same device does not ask again, even if the server forgot.
        StubURLProtocol.handler = { _ in stubReply(#"{"state":"not_asked","updatedAt":null,"policyVersion":"2026-11-14"}"#) }
        let later = ConsentModel(api: api(), defaults: store)
        await later.load()
        XCTAssertFalse(later.showCard)
    }

    func testFailedAnswerKeepsTheCard() async throws {
        StubURLProtocol.handler = { request in
            request.httpMethod == "POST"
                ? stubReply(#"{"error":"down","code":"unavailable"}"#, status: 503)
                : stubReply(#"{"state":"not_asked","updatedAt":null,"policyVersion":"2026-11-14"}"#)
        }
        let model = ConsentModel(api: api(), defaults: try defaults())
        await model.load()
        await model.answerCard(false, lang: .en)
        XCTAssertTrue(model.showCard)
    }

    func testSwitchSendsItsOwnSource() async throws {
        StubURLProtocol.handler = { _ in stubReply(#"{"state":"off","updatedAt":null,"policyVersion":"2026-11-14"}"#) }
        let model = ConsentModel(api: api(), defaults: try defaults())
        await model.setSwitch(false, lang: .en)
        XCTAssertEqual(model.state, .off)
        let body = try sentBody(StubURLProtocol.requests.last!)
        XCTAssertEqual(body["source"] as? String, "switch")
        XCTAssertEqual(body["wordingKey"] as? String, "consent.switchDetail")
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
