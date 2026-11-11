import XCTest
@testable import Judge

/// Where each invited side stands (the owner's `live`), the menu row's label
/// and the New page handing the case's one link to the share sheet.
final class CaseLiveTests: XCTestCase {
    private static let caseID = "case0000001"

    override func setUp() {
        super.setUp()
        StubURLProtocol.handler = nil
        StubURLProtocol.requests = []
    }

    override func tearDown() {
        StubURLProtocol.handler = nil
        super.tearDown()
    }

    private func api() -> JudgeAPI {
        JudgeAPI(
            baseURL: AppConfig.production,
            userAgent: "Judge-iOS/test",
            tokenStore: MemoryTokenStore(token: "s3ss10n"),
            session: JudgeAPI.makeSession(protocolClasses: [StubURLProtocol.self])
        )
    }

    private func viewObject() throws -> [String: Any] {
        let views = try XCTUnwrap(PremiumFixtures.section("cases")["views"] as? [String: Any])
        return try XCTUnwrap(views["waiting_for_respondent"] as? [String: Any])
    }

    func testLiveSidesDecodeAndAnUnknownStateDoesNotBreakTheView() throws {
        var object = try viewObject()
        object["live"] = [
            ["party": "b", "state": "typing"],
            ["party": "c", "state": "answered"],
            ["party": "d", "state": "daydreaming"],
        ]
        let view = try CaseDecoding.view(object)
        XCTAssertEqual(view.live?.map(\.party), [.b, .c, .d])
        XCTAssertEqual(view.live?.map(\.state), [.typing, .answered, .unknown])
        XCTAssertEqual(view.status, .awaitingRespondent)
    }

    func testAViewWithoutLiveHasNone() throws {
        var object = try viewObject()
        object["live"] = nil
        XCTAssertNil(try CaseDecoding.view(object).live)
        object["live"] = "nope"
        XCTAssertNil(try CaseDecoding.view(object).live, "a malformed list is left out, not fatal")
    }

    func testTheMenuRowShowsTypingBeforeOpened() {
        let waiting = CaseLiveSide(party: .b, state: .waiting)
        let opened = CaseLiveSide(party: .c, state: .opened)
        let typing = CaseLiveSide(party: .d, state: .typing)
        XCTAssertEqual(CaseLogic.liveLabel([waiting, opened, typing], lang: .en), L10n.caseSideTyping(.en))
        XCTAssertEqual(CaseLogic.liveLabel([waiting, opened], lang: .en), L10n.caseSideOpened(.en))
        XCTAssertNil(CaseLogic.liveLabel([waiting, CaseLiveSide(party: .c, state: .answered)], lang: .en), "the row keeps its own label")
        XCTAssertNil(CaseLogic.liveLabel([], lang: .en))
        XCTAssertEqual(CaseLogic.answeredCount([waiting, CaseLiveSide(party: .c, state: .answered), typing]), 1)
    }

    func testEachStateHasItsOwnWords() {
        XCTAssertEqual(CaseLogic.liveText(.waiting, lang: .en), L10n.caseSideWaiting(.en))
        XCTAssertEqual(CaseLogic.liveText(.opened, lang: .en), L10n.caseSideOpened(.en))
        XCTAssertEqual(CaseLogic.liveText(.typing, lang: .en), L10n.caseSideTyping(.en))
        XCTAssertEqual(CaseLogic.liveText(.answered, lang: .en), L10n.caseSideAnswered(.en))
        XCTAssertEqual(CaseLogic.liveText(.unknown, lang: .en), L10n.caseSideWaiting(.en))
    }

    func testTheLiveListOfWaitingCases() async throws {
        let body = try JSONSerialization.data(withJSONObject: [
            "cases": [
                ["id": "c1", "sides": [["party": "b", "state": "opened"], ["party": "c", "state": "mystery"]]],
                ["id": "c2", "sides": [["party": "b", "state": "answered"]]],
            ],
        ])
        StubURLProtocol.handler = { _ in StubURLProtocol.Reply(body: body) }
        let cases = try await api().liveCases()
        XCTAssertEqual(StubURLProtocol.requests.first?.url?.path, "/api/v1/cases/live")
        XCTAssertEqual(StubURLProtocol.requests.first?.httpMethod, "GET")
        XCTAssertEqual(cases.map(\.id), ["c1", "c2"])
        XCTAssertEqual(cases[0].sides.map(\.state), [.opened, .unknown])
    }

    @MainActor
    func testTheLinkGoesToTheShareSheetAndTheNewPageStays() async throws {
        let container = HistoryContainer.inMemory()
        let router = StubRouter()
        router.on("POST", "/api/v1/cases", try PremiumFixtures.json(201, try PremiumFixtures.section("cases")["createResponse"] as Any))
        router.install()
        let app = try PremiumFixtures.app(container: container)
        let home = app.home
        XCTAssertFalse(home.argument.isEmpty)
        XCTAssertNil(home.shareLink)

        home.sendLink(app: app)
        try await PremiumFixtures.waitUntil("the link to share") { home.shareLink != nil }

        XCTAssertEqual(home.shareLink?.url.absoluteString, "https://okjudge.com/r/Xk3pQ9vLm2Rt7YbN4cWd0A")
        XCTAssertEqual(home.path, [], "no case page opens")
        XCTAssertEqual(home.argument, "")
        XCTAssertNil(home.caseName)
        XCTAssertFalse(home.theirsOpen)
        XCTAssertEqual(home.mode, .now)
        XCTAssertFalse(home.isCreatingCase)
        XCTAssertEqual(router.count("POST", "/api/v1/cases"), 1)

        home.shareLink = nil
        XCTAssertNil(home.shareLink, "the sheet shows once")
        withExtendedLifetime(container) {}
    }
}
