import XCTest
@testable import Judge

/// Three- and four-sided cases from the owner's side: the New page, the case
/// view with one link per side, and the calls that go with them.
final class ManySidedFlowTests: XCTestCase {
    override func setUp() {
        super.setUp()
        StubURLProtocol.handler = nil
        StubURLProtocol.requests = []
    }

    private func api() -> JudgeAPI {
        JudgeAPI(
            baseURL: AppConfig.production,
            userAgent: "Judge-iOS/test",
            tokenStore: MemoryTokenStore(token: "s3ss10n"),
            session: JudgeAPI.makeSession(protocolClasses: [StubURLProtocol.self])
        )
    }

    private static let owner: [String: Any] = [
        "id": "caseMany01", "role": "owner", "yourParty": "a", "status": "awaiting_respondent",
        "createdAt": "2026-11-10T12:00:00.000Z", "expiresAt": "2026-11-17T12:00:00.000Z",
        "parties": ["a", "b", "c"],
        "inviteUrl": "https://okjudge.com/r/BBBBBBBBBBBBBBBBBBBBB1",
        "invites": [
            ["party": "b", "status": "waiting", "inviteUrl": "https://okjudge.com/r/BBBBBBBBBBBBBBBBBBBBB1", "answeredAt": NSNull()] as [String: Any],
            ["party": "c", "status": "answered", "inviteUrl": NSNull(), "answeredAt": "2026-11-10T13:00:00.000Z"] as [String: Any],
        ] as [[String: Any]],
        "canJudgeNow": true, "canJudgeAnswered": true,
        "display": ["namesVisible": true, "a": NSNull(), "b": NSNull(), "c": "Cem"] as [String: Any],
    ]

    func testTheOwnersViewOfAThreeSidedCase() throws {
        let view = try CaseDecoding.view(Self.owner)
        XCTAssertEqual(view.parties, [.a, .b, .c])
        XCTAssertTrue(view.isMany)
        XCTAssertEqual(view.sideCount, 3)
        XCTAssertEqual(view.invites?.map(\.party), [.b, .c])
        XCTAssertEqual(view.invites?.map(\.status), [.waiting, .answered])
        XCTAssertEqual(view.invites?.first?.inviteUrl, "https://okjudge.com/r/BBBBBBBBBBBBBBBBBBBBB1")
        XCTAssertNil(view.invites?.last?.inviteUrl)
        XCTAssertTrue(view.canJudgeAnswered)
        XCTAssertEqual(view.display.name(.c), "Cem")
        XCTAssertNil(view.display.name(.d))
    }

    func testATwoSidedCaseCarriesNoneOfIt() throws {
        var object = Self.owner
        for key in ["parties", "invites", "canJudgeAnswered"] { object[key] = nil }
        let view = try CaseDecoding.view(object)
        XCTAssertNil(view.parties)
        XCTAssertNil(view.invites)
        XCTAssertFalse(view.canJudgeAnswered)
        XCTAssertEqual(view.sideCount, 2)
    }

    func testAViewerOnSideCKeepsTheirLetter() throws {
        var object = Self.owner
        object["role"] = "respondent"
        object["yourParty"] = "c"
        let view = try CaseDecoding.view(object)
        XCTAssertEqual(view.yourParty, .c)
        XCTAssertEqual(Sides(you: view.yourParty).you, .c)
    }

    func testTheViewersOwnSideIsGreen() {
        let green = Sides(you: .a).a
        XCTAssertEqual(Sides(you: .b).b, green)
        XCTAssertEqual(Sides(you: .c).c, green)
        XCTAssertEqual(Sides(you: .d).d, green)
        XCTAssertEqual(Sides(you: .c).a, Sides(you: nil).c, "A takes the colour C had")
        XCTAssertEqual(Sides(you: .d).a, Sides(you: nil).d)
        XCTAssertNotEqual(Sides(you: nil).c, Sides(you: nil).d)
        XCTAssertNotEqual(Sides(you: nil).c, green)
    }

    func testCreatingACaseWithMoreSides() {
        XCTAssertNil(JudgeAPI.createCaseBody(text: "t", lang: .en, evidence: [], displayName: nil)["sides"])
        XCTAssertNil(JudgeAPI.createCaseBody(text: "t", lang: .en, evidence: [], displayName: nil, sides: 2)["sides"])
        XCTAssertEqual(JudgeAPI.createCaseBody(text: "t", lang: .en, evidence: [], displayName: nil, sides: 3)["sides"] as? Int, 3)
        XCTAssertEqual(JudgeAPI.createCaseBody(text: nil, lang: .en, evidence: [], displayName: nil, sides: 4)["sides"] as? Int, 4)
    }

    func testJudgingTheSidesThatAnsweredAndANewLinkForOneSide() async throws {
        let reply = try JSONSerialization.data(withJSONObject: ["case": Self.owner])
        let link = try JSONSerialization.data(withJSONObject: ["inviteUrl": "https://okjudge.com/r/CCCCCCCCCCCCCCCCCCCCC1", "party": "c"])
        StubURLProtocol.handler = { request in
            request.url?.path.hasSuffix("/invite") == true
                ? StubURLProtocol.Reply(body: link)
                : StubURLProtocol.Reply(status: 202, body: reply)
        }
        _ = try await api().judgeAnswered(id: "caseMany01")
        let judge = try XCTUnwrap(StubURLProtocol.requests.first)
        XCTAssertEqual(judge.url?.path, "/api/v1/cases/caseMany01/judge")
        XCTAssertEqual(judge.value(forHTTPHeaderField: "Judge-Sides"), "4")
        XCTAssertEqual(try JSONSerialization.jsonObject(with: XCTUnwrap(judge.httpBody)) as? [String: String], ["mode": "answered"])

        let url = try await api().rotateInvite(id: "caseMany01", party: .c)
        XCTAssertEqual(url, "https://okjudge.com/r/CCCCCCCCCCCCCCCCCCCCC1")
        let rotate = try XCTUnwrap(StubURLProtocol.requests.last)
        XCTAssertEqual(try JSONSerialization.jsonObject(with: XCTUnwrap(rotate.httpBody)) as? [String: String], ["party": "c"])

        _ = try await api().rotateInvite(id: "caseMany01")
        XCTAssertNil(StubURLProtocol.requests.last?.httpBody, "side B's link is asked for as before")
    }

    func testAHistoryRowOfAManySidedCase() throws {
        let json = #"{"kind":"case","id":"c1","at":"2026-11-10T12:00:00.000Z","state":"ready","role":"respondent","party":"c","verdict":"too_close","parties":["a","b","c"],"winner":"c"}"#
        let item = try JSONDecoder().decode(HistoryItem.self, from: Data(json.utf8))
        XCTAssertTrue(item.isMany)
        XCTAssertEqual(HistoryLabels.tone(item, now: .now), .yours, "the viewer is C and C won")
        XCTAssertEqual(HistoryLabels.status(item, lang: .en, now: .now), L10n.verdictWinSelf(.en))

        var other = item
        other.party = "a"
        XCTAssertEqual(HistoryLabels.tone(other, now: .now), .theirs)
        XCTAssertEqual(HistoryLabels.status(other, lang: .en, now: .now), L10n.verdictWin(.en, name: L10n.partyC(.en)))

        var tie = item
        tie.winner = nil
        XCTAssertEqual(HistoryLabels.tone(tie, now: .now), .neutral)
        XCTAssertEqual(HistoryLabels.status(tie, lang: .en, now: .now), L10n.verdictTooClose(.en))

        let plain = #"{"kind":"case","id":"c2","at":"2026-11-10T12:00:00.000Z","state":"ready","party":"b","verdict":"side_b"}"#
        let two = try JSONDecoder().decode(HistoryItem.self, from: Data(plain.utf8))
        XCTAssertFalse(two.isMany)
        XCTAssertEqual(HistoryLabels.tone(two, now: .now), .yours)
    }

    @MainActor
    func testTheNewPageTakesUpToFourSides() throws {
        let container = HistoryContainer.inMemory()
        let app = try PremiumFixtures.app(container: container)
        let home = app.home
        home.argument = String(repeating: "a", count: 30)
        XCTAssertEqual(home.openSides, [.a])
        XCTAssertFalse(home.canAddSide(app), "the second card comes first")

        home.addTheirSide()
        XCTAssertEqual(home.openSides, [.a, .b])
        XCTAssertTrue(home.canAddSide(app), "invites are still an option while nobody else has written")
        home.otherSide = String(repeating: "b", count: 30)
        XCTAssertTrue(home.canAddSide(app))

        home.addSide()
        home.addSide()
        home.addSide()
        XCTAssertEqual(home.more.count, 2, "four sides at most")
        XCTAssertEqual(home.openSides, [.a, .b, .c, .d])
        XCTAssertFalse(home.canAddSide(app))

        home.removeLastSide()
        XCTAssertEqual(home.openSides, [.a, .b, .c])
        home.removeTheirSide()
        XCTAssertTrue(home.more.isEmpty)
        XCTAssertEqual(home.openSides, [.a])
        withExtendedLifetime(container) {}
    }

    @MainActor
    func testEveryWrittenSideNeedsTwentyCharacters() throws {
        let container = HistoryContainer.inMemory()
        let app = try PremiumFixtures.app(container: container)
        let home = app.home
        home.argument = String(repeating: "a", count: 30)
        home.addTheirSide()
        home.otherSide = String(repeating: "b", count: 30)
        XCTAssertTrue(home.canSubmit(app))
        home.addSide()
        home.more[0].text = "too short"
        XCTAssertFalse(home.canSubmit(app), "a side with a few words is not worth judging")
        home.more[0].text = String(repeating: "c", count: 20)
        XCTAssertTrue(home.canSubmit(app))
        withExtendedLifetime(container) {}
    }

    @MainActor
    func testTheRequestCarriesEverySide() throws {
        let container = HistoryContainer.inMemory()
        let app = try PremiumFixtures.app(container: container)
        let home = app.home
        home.caseName = "Ann"
        home.argument = "I did the dishes on Monday."
        home.addTheirSide()
        home.otherName = "Deniz"
        home.otherSide = "The rota was never agreed."
        XCTAssertNil(home.typedSides(app), "two sides go as one text")

        home.addSide()
        home.more[0].text = " It was agreed in March. "
        home.addSide()
        home.more[1].name = "Mina"
        home.more[1].text = "Nobody asked me."

        let sides = try XCTUnwrap(home.typedSides(app))
        XCTAssertEqual(sides.map(\.text), ["I did the dishes on Monday.", "The rota was never agreed.", "It was agreed in March.", "Nobody asked me."])
        XCTAssertEqual(sides.map(\.name), ["Ann", "Deniz", nil, "Mina"])

        let joined = home.outgoing(app)
        XCTAssertEqual(
            joined,
            "Ann says: I did the dishes on Monday.\n\nDeniz says: The rota was never agreed.\n\n\(L10n.partyC(.en)): It was agreed in March.\n\nMina says: Nobody asked me."
        )

        let body = VerdictRequest(argument: joined, lang: .en, sides: sides)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(body)) as? [String: Any])
        let sent = try XCTUnwrap(object["sides"] as? [[String: Any]])
        XCTAssertEqual(sent.count, 4)
        XCTAssertNil(sent[2]["name"])
        XCTAssertNil(try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(VerdictRequest(argument: "x", lang: .en))) as? [String: Any])["sides"])

        let tiles = HomeModel.sides(mine: "a", theirs: "b", myName: "", theirName: "", more: home.more)
        XCTAssertEqual(tiles.map(\.party), [.a, .b, .c, .d])
        withExtendedLifetime(container) {}
    }

    @MainActor
    func testTheLinkComesBackOnceASideIsAddedAndNobodyHasWritten() throws {
        let container = HistoryContainer.inMemory()
        let app = try PremiumFixtures.app(container: container)
        let home = app.home
        home.argument = String(repeating: "a", count: 30)
        home.addTheirSide()
        XCTAssertFalse(home.canSendLink(app), "with the second card open they write both")
        home.addSide()
        XCTAssertTrue(home.canSendLink(app))
        home.more[0].text = String(repeating: "c", count: 30)
        XCTAssertFalse(home.canSendLink(app), "a written side is a verdict to get now")
        withExtendedLifetime(container) {}
    }
}
