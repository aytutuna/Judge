import SwiftData
import XCTest
@testable import Judge

/// "Add context" on the writer's one-sided verdict, against the stub.
final class VerdictAppealTests: XCTestCase {
    private static let id = "abc123DEF0"
    private static let verdictPath = "/api/v1/verdicts/abc123DEF0"
    private static let appealPath = "/api/v1/verdicts/abc123DEF0/appeals"
    private static let roundPath = "/api/v1/verdicts/r1"
    private static let context = "Party B paid me back the next week, so the debt is settled."

    override func setUp() {
        super.setUp()
        StubURLProtocol.handler = nil
        StubURLProtocol.requests = []
    }

    override func tearDown() {
        StubURLProtocol.handler = nil
        super.tearDown()
    }

    /// The verdict the screen shows; a round's verdict replaces it.
    @MainActor
    private final class Shown {
        var session: VerdictSession

        init(_ session: VerdictSession) {
            self.session = session
        }
    }

    private func api() -> JudgeAPI {
        JudgeAPI(
            baseURL: AppConfig.production,
            userAgent: "Judge-iOS/test",
            tokenStore: MemoryTokenStore(token: "s3ss10n"),
            session: JudgeAPI.makeSession(protocolClasses: [StubURLProtocol.self]),
            pollPolicy: PremiumFixtures.fastPolicy
        )
    }

    /// The writer's saved verdict and a model wired to it as the screen does.
    @MainActor
    private func model(_ app: AppModel) throws -> (VerdictAppealModel, Shown) {
        let payload = try Fixtures.sample("win_a_self")
        let session = VerdictSession(id: payload.id, original: payload.result, nameMap: payload.nameMap, translations: [:])
        try app.history.save(session, preset: "balanced")
        let shown = Shown(session)
        let history = app.history
        let model = VerdictAppealModel(id: Self.id, api: api(), account: app.account, shown: { shown.session }) { next in
            shown.session = next
            try? history.saveRuling(next)
        }
        return (model, shown)
    }

    private func gate(_ allowed: Bool, _ blockedBy: String? = nil) -> [String: Any] {
        ["allowed": allowed, "blockedBy": blockedBy ?? NSNull()]
    }

    private func round(_ status: String, error: String? = nil) -> [String: Any] {
        [
            "id": "r1", "status": status, "error": error ?? NSNull(),
            "outcome": status == "judged" ? "overturned" : NSNull(),
            "baseId": Self.id, "createdAt": "2026-10-21T10:00:00.000Z", "text": Self.context,
        ]
    }

    /// A ready GET of the verdict; `gate` is the writer's `owner.appeal`, nil for anyone else.
    private func verdict(appeals: [[String: Any]] = [], gate: [String: Any]?) throws -> StubURLProtocol.Reply {
        let sample = try XCTUnwrap(Fixtures.verdicts()["verdictResponses"] as? [String: Any])
        let result = try XCTUnwrap((sample["win_a_self"] as? [String: Any])?["result"])
        var body: [String: Any] = [
            "id": Self.id, "status": "ready", "createdAt": "2026-10-20T10:00:00.000Z", "result": result, "appeals": appeals,
        ]
        if let gate {
            body["owner"] = [
                "originals_stored": true,
                "display": ["a": NSNull(), "b": NSNull(), "others": [String: String](), "namesVisible": false],
                "appeal": gate,
            ]
        }
        return try PremiumFixtures.json(200, body)
    }

    /// The round's verdict: a case fixture's verdict made by an appeal.
    private func roundResult() throws -> [String: Any] {
        let views = try XCTUnwrap(PremiumFixtures.section("cases")["views"] as? [String: Any])
        let verdicts = try XCTUnwrap((views["appeal_overturned"] as? [String: Any])?["verdicts"] as? [[String: Any]])
        return try XCTUnwrap(verdicts.last?["result"] as? [String: Any])
    }

    private func roundReady() throws -> StubURLProtocol.Reply {
        try PremiumFixtures.json(200, ["id": "r1", "status": "ready", "createdAt": "2026-10-21T10:00:05.000Z", "result": try roundResult()])
    }

    private func accepted() throws -> StubURLProtocol.Reply {
        try PremiumFixtures.json(202, [
            "appeal": round("judging"),
            "appeals": [round("judging")],
            "poll": Self.roundPath,
            "pollAfterMs": 1,
            "name_map": [["original": "Sam", "replacement": "Party B"], ["original": "Kim", "replacement": "Person C"]],
            "entitlement": ["canUsePremium": true, "blockedReason": NSNull(), "credits": 2],
        ])
    }

    @MainActor
    func testNotTheWriterIsOfferedNothing() async throws {
        let router = StubRouter()
        router.on("GET", Self.verdictPath, try verdict(gate: nil))
        router.install()
        let container = HistoryContainer.inMemory()
        let (appeal, _) = try model(try PremiumFixtures.app(container: container))
        await appeal.load()
        XCTAssertNotNil(appeal.rounds)
        XCTAssertNil(appeal.rounds?.gate)
        XCTAssertEqual(appeal.area, .none)
        XCTAssertFalse(appeal.offered)
        XCTAssertFalse(appeal.panel)
        XCTAssertEqual(router.count("POST", Self.appealPath), 0)
        withExtendedLifetime(container) {}
    }

    @MainActor
    func testTheWriterIsOfferedTheForm() async throws {
        let router = StubRouter()
        router.on("GET", Self.verdictPath, try verdict(gate: gate(true)))
        router.install()
        let container = HistoryContainer.inMemory()
        let (appeal, _) = try model(try PremiumFixtures.app(container: container))
        await appeal.load()
        XCTAssertTrue(appeal.offered)
        XCTAssertEqual(appeal.area, .form(failed: nil))
        XCTAssertFalse(appeal.panel, "the form waits for the card's action")
        appeal.openForm()
        XCTAssertTrue(appeal.panel)
        withExtendedLifetime(container) {}
    }

    @MainActor
    func testBlockedStatesReadLikeTheCaseScreen() async throws {
        let router = StubRouter()
        router.install()
        let container = HistoryContainer.inMemory()
        let app = try PremiumFixtures.app(container: container)
        let expected: [(String, CaseLogic.AppealArea)] = [
            ("premium_required", .blocked(reason: "premium_required")),
            ("no_credits", .blocked(reason: "no_credits")),
            ("appeal_limit", .limit),
            ("busy", .busy),
            ("signin_required", .upsell(signIn: true)),
            ("claim_required", .none),
        ]
        for (blockedBy, area) in expected {
            router.on("GET", Self.verdictPath, try verdict(gate: gate(false, blockedBy)))
            let (appeal, _) = try model(app)
            await appeal.load()
            XCTAssertEqual(appeal.area, area, blockedBy)
            XCTAssertEqual(appeal.offered, area != .none, blockedBy)
        }
        XCTAssertEqual(
            ErrorText.message(.server(status: 409, body: ApiErrorBody(error: "x", code: "appeal_limit")), lang: .en),
            L10n.errorAppealLimit(.en)
        )
        withExtendedLifetime(container) {}
    }

    @MainActor
    func testSubmitSendsTheContextPollsTheRoundAndSavesItsVerdict() async throws {
        let router = StubRouter()
        router.on("GET", Self.verdictPath, try verdict(gate: gate(true)), try verdict(appeals: [round("judged")], gate: gate(true)))
        router.on("POST", Self.appealPath, try accepted())
        router.on("GET", Self.roundPath, try PremiumFixtures.json(200, ["id": "r1", "status": "judging", "pollAfterMs": 1]), try roundReady())
        router.install()
        let container = HistoryContainer.inMemory()
        let app = try PremiumFixtures.app(container: container)
        let (appeal, shown) = try model(app)
        let first = shown.session

        await appeal.load()
        appeal.openForm()
        appeal.appealText = "  \(Self.context)  "
        XCTAssertTrue(appeal.appealCanSubmit)
        await appeal.submitAppeal()
        XCTAssertNil(appeal.appealError)
        XCTAssertEqual(appeal.judgingID, "r1", "the screen follows the new round")
        XCTAssertEqual(appeal.area, .judging)
        XCTAssertTrue(appeal.appealText.isEmpty)
        XCTAssertEqual(app.account.entitlement?.credits, 2)

        await appeal.follow("r1")
        XCTAssertTrue(appeal.finished)
        XCTAssertFalse(appeal.open)
        XCTAssertEqual(router.count("GET", Self.roundPath), 2, "the round is polled until ready")
        XCTAssertNil(appeal.judgingID)

        let headers = router.sentHeaders("POST", Self.appealPath)
        XCTAssertEqual(headers.count, 1)
        XCTAssertNotNil(headers.first?["Idempotency-Key"])
        let body = try PremiumFixtures.body(router.sentBodies("POST", Self.appealPath).last)
        XCTAssertEqual(body["text"] as? String, Self.context)
        XCTAssertNil(body["evidence"], "no screenshot, no evidence key")

        XCTAssertEqual(shown.session.rulingID, "r1")
        XCTAssertEqual(shown.session.original.result.appeal?.outcome, .overturned)
        let row = try XCTUnwrap(try app.history.find(id: Self.id))
        XCTAssertEqual(row.rulingID, "r1")
        XCTAssertEqual(row.headline, "On appeal, Party B's dictionary wins")
        XCTAssertEqual(row.preset, "balanced")
        let saved = try XCTUnwrap(row.session())
        XCTAssertEqual(saved.currentID, "r1")
        XCTAssertEqual(saved.nameMap, first.nameMap + [NameMapping(original: "Kim", replacement: "Person C")], "the round's new names join the writer's")
        withExtendedLifetime(container) {}
    }

    @MainActor
    func testAFailedSendKeepsTheKeyForTheSameText() async throws {
        let router = StubRouter()
        router.on("GET", Self.verdictPath, try verdict(gate: gate(true)))
        router.on("POST", Self.appealPath, try PremiumFixtures.json(503, ["error": "down", "code": "unavailable"]))
        router.install()
        let container = HistoryContainer.inMemory()
        let (appeal, _) = try model(try PremiumFixtures.app(container: container))
        await appeal.load()
        appeal.appealText = Self.context
        await appeal.submitAppeal()
        XCTAssertEqual(appeal.appealError?.code, "unavailable")
        XCTAssertEqual(appeal.appealText, Self.context, "the text stays for another try")
        await appeal.submitAppeal()
        appeal.appealText = Self.context + " Really."
        await appeal.submitAppeal()
        let keys = router.sentHeaders("POST", Self.appealPath).compactMap { $0["Idempotency-Key"] }
        XCTAssertEqual(keys.count, 3)
        XCTAssertEqual(keys[0], keys[1], "a retry of the same context keeps its key")
        XCTAssertNotEqual(keys[1], keys[2])
        withExtendedLifetime(container) {}
    }

    @MainActor
    func testTheLimitAnswerReadsTheGateAgain() async throws {
        let router = StubRouter()
        router.on(
            "GET", Self.verdictPath,
            try verdict(gate: gate(true)),
            try verdict(appeals: [round("judged"), round("judged")], gate: gate(false, "appeal_limit"))
        )
        router.on("POST", Self.appealPath, try PremiumFixtures.json(409, ["error": "This verdict already took context twice.", "code": "appeal_limit"]))
        router.on("GET", Self.roundPath, try roundReady())
        router.install()
        let container = HistoryContainer.inMemory()
        let (appeal, _) = try model(try PremiumFixtures.app(container: container))
        await appeal.load()
        XCTAssertEqual(appeal.area, .form(failed: nil))
        appeal.appealText = Self.context
        await appeal.submitAppeal()
        XCTAssertEqual(appeal.appealError?.code, "appeal_limit")
        XCTAssertEqual(appeal.area, .limit)
        withExtendedLifetime(container) {}
    }

    @MainActor
    func testARoundStillJudgingIsFollowedAndAFailedOneOpensTheForm() async throws {
        let router = StubRouter()
        router.on(
            "GET", Self.verdictPath,
            try verdict(appeals: [round("judging")], gate: gate(false, "busy")),
            try verdict(appeals: [round("failed", error: "unavailable")], gate: gate(true))
        )
        router.on(
            "GET", Self.roundPath,
            try PremiumFixtures.json(200, ["id": "r1", "status": "judging", "pollAfterMs": 1]),
            try PremiumFixtures.json(200, ["id": "r1", "status": "failed", "code": "unavailable", "error": "down"])
        )
        router.install()
        let container = HistoryContainer.inMemory()
        let app = try PremiumFixtures.app(container: container)
        let (appeal, shown) = try model(app)
        await appeal.load()
        XCTAssertEqual(appeal.area, .judging)
        XCTAssertTrue(appeal.panel, "the judging note shows without a tap")
        XCTAssertEqual(appeal.judgingID, "r1")

        await appeal.follow("r1")
        XCTAssertTrue(appeal.open)
        XCTAssertEqual(appeal.area, .form(failed: "failed"))
        XCTAssertFalse(appeal.finished)
        XCTAssertNil(shown.session.rulingID)
        XCTAssertNil(try app.history.find(id: Self.id)?.rulingID)
        withExtendedLifetime(container) {}
    }

    @MainActor
    func testARoundFinishedElsewhereIsCaughtUp() async throws {
        let router = StubRouter()
        router.on("GET", Self.verdictPath, try verdict(appeals: [round("judged")], gate: gate(true)))
        router.on("GET", Self.roundPath, try roundReady())
        router.install()
        let container = HistoryContainer.inMemory()
        let app = try PremiumFixtures.app(container: container)
        let (appeal, shown) = try model(app)
        await appeal.load()
        XCTAssertEqual(shown.session.rulingID, "r1")
        XCTAssertEqual(try app.history.find(id: Self.id)?.rulingID, "r1")
        XCTAssertEqual(shown.session.original.result.appeal?.outcome, .overturned)

        await appeal.load()
        XCTAssertEqual(router.count("GET", Self.roundPath), 1, "a ruling already shown is not fetched again")
        withExtendedLifetime(container) {}
    }

    @MainActor
    func testALaterRulingIsTranslatedUnderItsOwnID() async throws {
        let router = StubRouter()
        let translated = try PremiumFixtures.json(200, try XCTUnwrap(Fixtures.verdicts()["translateResponse"]))
        router.on("POST", Self.verdictPath + "/translate", translated)
        router.on("POST", Self.roundPath + "/translate", translated)
        router.install()
        let payload = try Fixtures.sample("win_a_self")
        let session = VerdictSession(id: payload.id, original: payload.result, nameMap: payload.nameMap, translations: [:])
        let screen = VerdictModel(session: session, api: api()) { _, _, _ in }
        screen.ensure(.tr)
        try await PremiumFixtures.waitUntil("the first translation") { router.count("POST", Self.verdictPath + "/translate") == 1 }

        let later = try Fixtures.sample("win_b_named")
        screen.show(session.withRuling(VerdictPayload(id: "r1", result: later.result, nameMap: [])), lang: .tr)
        try await PremiumFixtures.waitUntil("the round's translation") { router.count("POST", Self.roundPath + "/translate") == 1 }
        XCTAssertEqual(screen.session.currentID, "r1")
    }
}
