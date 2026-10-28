import SwiftData
import XCTest
@testable import Judge

/// Two-sided cases: decoding every fixture view, the page's decisions, the
/// owner's actions against the stub, and creating a case from Home.
final class CaseTests: XCTestCase {
    private static let caseID = "case0000001"
    private static let casePath = "/api/v1/cases/case0000001"

    override func setUp() {
        super.setUp()
        StubURLProtocol.handler = nil
        StubURLProtocol.requests = []
    }

    override func tearDown() {
        StubURLProtocol.handler = nil
        super.tearDown()
    }

    // MARK: - Fixtures

    private func viewObject(_ name: String) throws -> [String: Any] {
        let views = try XCTUnwrap(PremiumFixtures.section("cases")["views"] as? [String: Any])
        return try XCTUnwrap(views[name] as? [String: Any], "missing case view \(name)")
    }

    private func view(_ name: String) throws -> CaseView {
        try CaseDecoding.view(viewObject(name))
    }

    private func caseReply(_ name: String, status: Int = 200) throws -> StubURLProtocol.Reply {
        try PremiumFixtures.json(status, ["case": try viewObject(name)])
    }

    private static let allViews = [
        "waiting_for_respondent", "respondent_answered", "judging", "judged", "judged_one_sided", "judged_tr",
        "appeal_judging", "appeal_upheld", "appeal_overturned", "appeal_changed", "failed", "expired", "removed",
        "waiting_free", "judged_free",
    ]

    private func api(token: String? = "s3ss10n") -> JudgeAPI {
        JudgeAPI(
            baseURL: AppConfig.production,
            userAgent: "Judge-iOS/test",
            tokenStore: MemoryTokenStore(token: token),
            session: JudgeAPI.makeSession(protocolClasses: [StubURLProtocol.self])
        )
    }

    @MainActor
    private func model(_ initial: String?, names: any CaseNamesStore = MemoryCaseNamesStore(), account: AccountModel? = nil) throws -> CaseModel {
        CaseModel(id: Self.caseID, api: api(), namesStore: names, account: account, initial: try initial.map { try view($0) })
    }

    // MARK: - Decoding and decisions

    func testEveryFixtureViewDecodes() throws {
        for name in Self.allViews {
            let decoded = try view(name)
            XCTAssertEqual(decoded.id, Self.caseID, name)
            XCTAssertNotEqual(decoded.status, .unknown, name)
            let raw = try viewObject(name)
            XCTAssertEqual(decoded.verdicts.count, (raw["verdicts"] as? [Any])?.count, name)
            XCTAssertEqual(decoded.appeals.count, (raw["appeals"] as? [Any])?.count, name)
            XCTAssertEqual(decoded.sides.count, (raw["sides"] as? [Any])?.count, name)
        }

        let waiting = try view("waiting_for_respondent")
        XCTAssertEqual(waiting.status, .awaitingRespondent)
        XCTAssertEqual(waiting.inviteUrl, "https://okjudge.com/r/Xk3pQ9vLm2Rt7YbN4cWd0A")
        XCTAssertTrue(waiting.canJudgeNow)
        XCTAssertNil(waiting.mode)
        XCTAssertEqual(waiting.names, [NameMapping(original: "I", replacement: "Party A"), NameMapping(original: "Sam", replacement: "Party B")])
        XCTAssertEqual(waiting.preset, "balanced")
        XCTAssertNil(waiting.pollAfterMs)

        let judging = try view("judging")
        XCTAssertEqual(judging.pollAfterMs, 3000)

        let judged = try view("judged")
        XCTAssertEqual(judged.mode, .twoSided)
        XCTAssertEqual(judged.current?.id, "caseverd01")
        XCTAssertTrue(judged.current?.result.result.twoSided == true)
        XCTAssertEqual(judged.display, CaseDisplay(namesVisible: true, a: "Alex", b: "Sam"))
        XCTAssertEqual(judged.sides.last?.evidence.first?.kind, "chat")

        let overturned = try view("appeal_overturned")
        XCTAssertEqual(overturned.verdicts.map(\.id), ["caseverd01", "caseverd02"])
        XCTAssertEqual(overturned.current?.result.result.appeal?.outcome, .overturned)
        XCTAssertEqual(overturned.appeals.first?.outcome, .overturned)

        let failed = try view("failed")
        XCTAssertEqual(failed.lastError, "quota")
        XCTAssertTrue(failed.canJudgeNow)

        let removed = try view("removed")
        XCTAssertEqual(removed.removed?.parties, [.a])
        XCTAssertNil(removed.names)
        XCTAssertEqual(removed.yourOriginal, "removed")

        XCTAssertEqual(try view("judged_tr").lang, .tr)

        XCTAssertEqual(judged.tier, .premium)
        XCTAssertEqual(try view("judged_free").tier, .free)
        XCTAssertEqual(try CaseDecoding.view(["id": "x"]).tier, .premium, "cases from before tiers were premium")
    }

    func testFreeCaseWordingNeverMentionsCredits() throws {
        XCTAssertNotNil(CaseLogic.heldNote(try view("waiting_for_respondent"), lang: .en))
        XCTAssertNil(CaseLogic.heldNote(try view("waiting_free"), lang: .en))

        var failed = try view("failed")
        XCTAssertEqual(CaseLogic.failedBody(failed, lang: .en), L10n.errorQuota(.en))
        failed.lastError = nil
        XCTAssertEqual(CaseLogic.failedBody(failed, lang: .en), L10n.caseFailedBody(.en))
        failed.tier = .free
        XCTAssertEqual(CaseLogic.failedBody(failed, lang: .en), L10n.caseFailedBodyFree(.en))

        var expired = try view("expired")
        XCTAssertEqual(CaseLogic.expiredBody(expired, lang: .en), L10n.caseExpiredBody(.en))
        expired.tier = .free
        XCTAssertEqual(CaseLogic.expiredBody(expired, lang: .tr), L10n.caseExpiredBodyFree(.tr))

        let waiting = CaseLogic.judgeNowConfirm(expired: false, tier: .free, lang: .en)
        XCTAssertEqual(waiting.text, L10n.caseJudgeNowConfirm(.en))
        XCTAssertEqual(waiting.yes, L10n.caseJudgeNowYes(.en))
        let premiumExpired = CaseLogic.judgeNowConfirm(expired: true, tier: .premium, lang: .en)
        XCTAssertEqual(premiumExpired.text, L10n.caseJudgeExpiredConfirm(.en))
        XCTAssertEqual(premiumExpired.yes, L10n.caseJudgeExpiredYes(.en))
        let freeExpired = CaseLogic.judgeNowConfirm(expired: true, tier: .free, lang: .en)
        XCTAssertEqual(freeExpired.text, L10n.caseJudgeExpiredConfirmFree(.en))
        XCTAssertEqual(freeExpired.yes, L10n.caseJudgeNowYes(.en))
    }

    func testAppealAreaForEveryView() throws {
        let expected: [String: CaseLogic.AppealArea] = [
            "waiting_for_respondent": .none, "respondent_answered": .none, "judging": .none,
            "judged": .form(failed: nil), "judged_one_sided": .blocked(reason: "premium_required"), "judged_tr": .form(failed: nil),
            "appeal_judging": .busy, "appeal_upheld": .used, "appeal_overturned": .used, "appeal_changed": .used,
            "failed": .none, "expired": .none, "removed": .none,
            "waiting_free": .none, "judged_free": .form(failed: nil),
        ]
        for name in Self.allViews {
            XCTAssertEqual(CaseLogic.appealArea(try view(name)), expected[name], name)
        }

        var mine = try view("appeal_judging")
        mine.appeals[0].party = .a
        XCTAssertEqual(CaseLogic.appealArea(mine), .judging, "the viewer's own context is being judged")

        var signedOut = try view("judged")
        signedOut.appeal = CaseAppealGate(allowed: false, blockedBy: "signin_required")
        XCTAssertEqual(CaseLogic.appealArea(signedOut), .upsell(signIn: true))
        var respondent = try view("judged_one_sided")
        respondent.role = .respondent
        XCTAssertEqual(CaseLogic.appealArea(respondent), .upsell(signIn: false))

        var refusedBefore = try view("judged")
        var failedAppeal = try XCTUnwrap(try view("appeal_upheld").appeals.first)
        failedAppeal.party = .a
        failedAppeal.status = .failed
        failedAppeal.error = "refused"
        refusedBefore.appeals = [failedAppeal]
        XCTAssertEqual(CaseLogic.appealArea(refusedBefore), .form(failed: "refused"))
        failedAppeal.error = "quota"
        refusedBefore.appeals = [failedAppeal]
        XCTAssertEqual(CaseLogic.appealArea(refusedBefore), .form(failed: "failed"))
    }

    func testAppealEvidenceOnlyOnPremiumCases() throws {
        let evidence = PremiumFeatures(cases: true, evidence: true)
        XCTAssertTrue(CaseLogic.appealEvidenceOn(try view("judged"), features: evidence))
        XCTAssertFalse(CaseLogic.appealEvidenceOn(try view("judged_free"), features: evidence), "the server refuses it on a free case")
        XCTAssertFalse(CaseLogic.appealEvidenceOn(try view("judged"), features: PremiumFeatures(cases: true)))
    }

    func testRemovalIsOfferedOnlyWhenNothingIsJudging() throws {
        XCTAssertTrue(CaseLogic.canRemove(try view("waiting_for_respondent")))
        XCTAssertTrue(CaseLogic.canRemove(try view("judged")))
        XCTAssertFalse(CaseLogic.canRemove(try view("judging")))
        XCTAssertFalse(CaseLogic.canRemove(try view("appeal_judging")))
        XCTAssertFalse(CaseLogic.canRemove(try view("removed")))
    }

    func testPollDelays() throws {
        XCTAssertNil(CaseLogic.nextPollDelay(nil, failures: 0))
        XCTAssertNil(CaseLogic.nextPollDelay(try view("judged"), failures: 0))
        let judging = try view("judging")
        XCTAssertEqual(CaseLogic.nextPollDelay(judging, failures: 0), 3000)
        XCTAssertEqual(CaseLogic.nextPollDelay(judging, failures: 1), 6000)
        XCTAssertEqual(CaseLogic.nextPollDelay(judging, failures: 3), 24_000)
        XCTAssertEqual(CaseLogic.nextPollDelay(judging, failures: 9), 30_000, "backs off to 30 s at most")
        var quick = judging
        quick.pollAfterMs = 200
        XCTAssertEqual(CaseLogic.nextPollDelay(quick, failures: 0), 1000, "never faster than once a second")
    }

    func testLoadFailures() {
        XCTAssertEqual(CaseLogic.loadFailure(.server(status: 404, body: ApiErrorBody(code: "not_found"))), .missing)
        XCTAssertEqual(CaseLogic.loadFailure(.server(status: 401, body: ApiErrorBody(code: "signin_required"))), .signIn)
        XCTAssertEqual(CaseLogic.loadFailure(.server(status: 503, body: ApiErrorBody(code: "unavailable"))), .error)
        XCTAssertEqual(CaseLogic.loadFailure(.offline), .error)
    }

    func testNamesAndLabels() throws {
        let a = NameMapping(original: "I", replacement: "Party A")
        let b = NameMapping(original: "Sam", replacement: "Party B")
        XCTAssertEqual(CaseNames.merge([a], [a, b, NameMapping(original: "", replacement: "Party C")]), [a, b])
        let many = (0..<80).map { NameMapping(original: "N\($0)", replacement: "Person C") }
        XCTAssertEqual(CaseNames.merge([], many).count, 60)

        let store = MemoryCaseNamesStore()
        store.save(caseID: "c1", [a])
        store.save(caseID: "c1", [a, b])
        XCTAssertEqual(store.names(caseID: "c1"), [a, b])
        store.forget(caseID: "c1")
        XCTAssertTrue(store.names(caseID: "c1").isEmpty)

        let judged = try view("judged")
        XCTAssertEqual(CaseLogic.names(judged, local: []), [a, b], "the server's copy first")
        let removed = try view("removed")
        XCTAssertEqual(CaseLogic.names(removed, local: [b]), [b], "this phone's names when the server has none")

        XCTAssertEqual(CaseLogic.localizeLabels("Party B says Party A is wrong.", lang: .tr), "Taraf B says Taraf A is wrong.")
        XCTAssertEqual(CaseLogic.localizeLabels("Taraf A ve Kişi C", lang: .en), "Party A ve Person C")
        XCTAssertEqual(CaseLogic.localizeLabels("Party C and Person A", lang: .tr), "Party C and Person A", "not labels")
        XCTAssertEqual(CaseLogic.localizeLabels("Partyx A", lang: .tr), "Partyx A")

        XCTAssertEqual(Names.firstName("Alex Smith"), "Alex")
        XCTAssertEqual(Names.firstName("Ayşe"), "Ayşe")
        XCTAssertNil(Names.firstName("I"))
        XCTAssertNil(Names.firstName("my roommate"))
        XCTAssertNil(Names.firstName(nil))
    }

    func testAppealTextLimits() {
        XCTAssertFalse(CaseLogic.appealTextFits("too short"))
        XCTAssertFalse(CaseLogic.appealTextFits("   " + String(repeating: "a", count: 19) + "   "))
        XCTAssertTrue(CaseLogic.appealTextFits(String(repeating: "a", count: 20)))
        XCTAssertTrue(CaseLogic.appealTextFits(String(repeating: "a", count: 2000)))
        XCTAssertFalse(CaseLogic.appealTextFits(String(repeating: "a", count: 2001)))
    }

    // MARK: - The page against the stub

    @MainActor
    func testLoadingEveryState() async throws {
        for name in Self.allViews {
            let router = StubRouter()
            router.on("GET", Self.casePath, try caseReply(name))
            router.install()
            let page = try model(nil)
            XCTAssertEqual(page.load, .loading)
            await page.reload()
            XCTAssertEqual(page.load, .ready, name)
            XCTAssertEqual(page.view, try view(name), name)
            XCTAssertEqual(router.sentHeaders("GET", Self.casePath).first?["Authorization"], "Bearer s3ss10n")
        }
    }

    @MainActor
    func testMissingAndSignedOutCases() async throws {
        let router = StubRouter()
        router.on("GET", Self.casePath, try PremiumFixtures.json(404, ["error": "x", "code": "not_found"]))
        router.install()
        let missing = try model(nil)
        await missing.reload()
        XCTAssertEqual(missing.load, .missing)
        XCTAssertNil(missing.view)

        router.on("GET", Self.casePath, try PremiumFixtures.apiError("signin_required"))
        let signedOut = try model(nil)
        await signedOut.reload()
        XCTAssertEqual(signedOut.load, .signIn)

        router.on("GET", Self.casePath, try PremiumFixtures.json(503, ["error": "x", "code": "unavailable"]))
        let kept = try model("judging")
        await kept.reload()
        XCTAssertEqual(kept.load, .ready, "a failed refresh keeps the last view")
        XCTAssertEqual(kept.view?.status, .judging)
        let fresh = try model(nil)
        await fresh.reload()
        XCTAssertEqual(fresh.load, .error)
    }

    @MainActor
    func testPollingMovesFromJudgingToJudged() async throws {
        let router = StubRouter()
        router.on("GET", Self.casePath, try caseReply("judging"), try caseReply("judged"))
        router.install()
        let page = try model(nil)
        await page.reload()
        XCTAssertEqual(page.view?.status, .judging)
        XCTAssertEqual(CaseLogic.nextPollDelay(page.view, failures: 0), 3000)
        await page.reload()
        XCTAssertEqual(page.view?.status, .judged)
        XCTAssertNil(CaseLogic.nextPollDelay(page.view, failures: 0))

        // Nothing judging: polling has nothing to do and returns.
        let settled = try model("judged")
        await settled.run()
        XCTAssertEqual(router.count("GET", Self.casePath), 2)
    }

    @MainActor
    func testPullToRefreshRestartsPolling() async throws {
        let router = StubRouter()
        router.on("GET", Self.casePath, try caseReply("judging"), try caseReply("judged"))
        router.install()
        let page = try model("waiting_for_respondent")
        page.pollScale = 0.001
        await page.run()
        XCTAssertEqual(router.count("GET", Self.casePath), 0, "nothing judging: no polling")

        let before = page.generation
        await page.refresh()
        XCTAssertEqual(page.view?.status, .judging)
        XCTAssertGreaterThan(page.generation, before, "the screen restarts polling")
        XCTAssertNotNil(CaseLogic.nextPollDelay(page.view, failures: 0))

        // The restarted poll carries on until the verdict is in.
        await page.run()
        XCTAssertEqual(page.view?.status, .judged)
        XCTAssertEqual(router.count("GET", Self.casePath), 2)
    }

    @MainActor
    func testRefreshAfterSigningInLeavesTheSignInState() async throws {
        let router = StubRouter()
        router.on("GET", Self.casePath, try PremiumFixtures.json(401, ["error": "x", "code": "signin_required"]), try caseReply("judged"))
        router.install()
        let page = try model(nil)
        await page.refresh()
        XCTAssertEqual(page.load, .signIn)
        await page.refresh()
        XCTAssertEqual(page.load, .ready)
        XCTAssertEqual(page.view?.status, .judged)
    }

    @MainActor
    func testInviteReset() async throws {
        let router = StubRouter()
        router.on("POST", Self.casePath + "/invite", try PremiumFixtures.json(200, ["inviteUrl": "https://okjudge.com/r/NEWNEWNEWNEWNEWNEWNEW1"]))
        router.install()
        let page = try model("waiting_for_respondent")
        await page.resetInvite()
        XCTAssertEqual(page.view?.inviteUrl, "https://okjudge.com/r/NEWNEWNEWNEWNEWNEWNEW1")
        XCTAssertTrue(page.resetDone)
        XCTAssertNil(page.actionError)
        XCTAssertEqual(router.count("POST", Self.casePath + "/invite"), 1)
    }

    @MainActor
    func testJudgeNowAndRetry() async throws {
        let router = StubRouter()
        router.on("POST", Self.casePath + "/judge", try caseReply("judging", status: 202))
        router.install()
        let page = try model("waiting_for_respondent")
        let before = page.generation
        await page.judge(onlyMine: true)
        XCTAssertEqual(page.view?.status, .judging)
        XCTAssertGreaterThan(page.generation, before, "a new view restarts polling")
        let first = try PremiumFixtures.body(router.sentBodies("POST", Self.casePath + "/judge").first)
        XCTAssertEqual(first as? [String: String], ["mode": "only_mine"])

        let failed = try model("failed")
        await failed.judge(onlyMine: false)
        let second = try PremiumFixtures.body(router.sentBodies("POST", Self.casePath + "/judge").last)
        XCTAssertTrue(second.isEmpty, "a retry sends {}")
        XCTAssertEqual(failed.view?.status, .judging)
    }

    @MainActor
    func testActionErrorsAreShown() async throws {
        let router = StubRouter()
        router.on("POST", Self.casePath + "/judge", try PremiumFixtures.apiError("case_closed"))
        router.install()
        let page = try model("waiting_for_respondent")
        await page.judge(onlyMine: true)
        XCTAssertEqual(page.actionError?.code, "case_closed")
        XCTAssertEqual(ErrorText.message(try XCTUnwrap(page.actionError), lang: .en), L10n.errorCaseClosed(.en))
        XCTAssertEqual(page.view?.status, .awaitingRespondent)
        XCTAssertFalse(page.busy)
    }

    @MainActor
    func testRemoval() async throws {
        let router = StubRouter()
        router.on("POST", Self.casePath + "/removal", try PremiumFixtures.json(200, [
            "removed": true, "removedAt": "2026-10-21T08:00:00.000Z", "case": try viewObject("removed"),
        ]))
        router.install()
        let names = MemoryCaseNamesStore()
        names.save(caseID: Self.caseID, [NameMapping(original: "Sam", replacement: "Party B")])
        let page = try model("judged", names: names)
        XCTAssertFalse(page.localNames.isEmpty)
        await page.remove()
        XCTAssertNotNil(page.view?.removed)
        XCTAssertTrue(page.removedNow)
        XCTAssertTrue(names.names(caseID: Self.caseID).isEmpty, "the names go with the case")
        let body = try PremiumFixtures.body(router.sentBodies("POST", Self.casePath + "/removal").first)
        XCTAssertEqual(body["confirm"] as? String, "remove")
    }

    @MainActor
    func testDisplayNameAndNamesSwitch() async throws {
        let router = StubRouter()
        router.on("PATCH", Self.casePath + "/display", try caseReply("judged"))
        router.install()
        let page = try model("judged")
        page.displayNameDraft = "  Alexandra "
        await page.saveDisplayName()
        XCTAssertTrue(page.displaySaved)
        XCTAssertNil(page.displayNameDraft)
        var body = try PremiumFixtures.body(router.sentBodies("PATCH", Self.casePath + "/display").last)
        XCTAssertEqual(body["displayName"] as? String, "Alexandra")
        XCTAssertNil(body["namesVisible"])

        page.displayNameDraft = "   "
        await page.saveDisplayName()
        body = try PremiumFixtures.body(router.sentBodies("PATCH", Self.casePath + "/display").last)
        XCTAssertTrue(body["displayName"] is NSNull, "an empty name clears it")

        await page.setNamesVisible(false)
        body = try PremiumFixtures.body(router.sentBodies("PATCH", Self.casePath + "/display").last)
        XCTAssertEqual(body["namesVisible"] as? Bool, false)
        XCTAssertNil(body["displayName"])

        router.on("PATCH", Self.casePath + "/display", try PremiumFixtures.json(400, ["error": "x", "code": "invalid"]))
        page.displayNameDraft = "Party A"
        await page.saveDisplayName()
        XCTAssertEqual(page.displayFailure, .invalid)
        XCTAssertEqual(page.displayFailure?.message(.en), L10n.namesInvalid(.en))

        router.on("PATCH", Self.casePath + "/display", try PremiumFixtures.json(503, ["error": "x", "code": "names_unavailable"]))
        await page.saveDisplayName()
        XCTAssertEqual(page.displayFailure?.message(.en), L10n.errorNamesUnavailable(.en))
    }

    @MainActor
    func testAppealGatingSubmitAndKey() async throws {
        let router = StubRouter()
        let appealPath = Self.casePath + "/appeals"
        let answer = try PremiumFixtures.json(202, try PremiumFixtures.section("cases")["appealResponse"] as Any)
        router.on("POST", appealPath, try PremiumFixtures.json(503, ["error": "x", "code": "anonymize_failed"]), answer)
        router.install()
        let names = MemoryCaseNamesStore()
        let page = try model("judged", names: names)

        page.appealText = "Too short."
        XCTAssertFalse(page.appealCanSubmit)
        page.appealText = "  The judges missed that Sam agreed to the menu test last week.  "
        XCTAssertTrue(page.appealCanSubmit)
        let ids = page.appealEvidence.reserve(1)
        XCTAssertFalse(page.appealCanSubmit, "an image still being read holds the submit")
        page.appealEvidence.apply([EvidenceUploadItem(index: 0, status: "ok", token: "ev-tok", preview: "x")], sent: ids)
        XCTAssertTrue(page.appealCanSubmit)

        await page.submitAppeal()
        XCTAssertEqual(page.appealError?.code, "anonymize_failed")
        XCTAssertEqual(ErrorText.message(try XCTUnwrap(page.appealError), lang: .en), L10n.errorAnonymizeFailed(.en))
        XCTAssertFalse(page.appealText.isEmpty, "the text stays for another try")

        await page.submitAppeal()
        XCTAssertNil(page.appealError)
        XCTAssertTrue(page.appealText.isEmpty)
        XCTAssertTrue(page.appealEvidence.items.isEmpty)
        XCTAssertTrue(page.view?.appealJudging == true, "the case is re-judging")
        XCTAssertFalse(names.names(caseID: Self.caseID).isEmpty, "the answer's names are kept")

        let keys = router.sentHeaders("POST", appealPath).compactMap { $0["Idempotency-Key"] }
        XCTAssertEqual(keys.count, 2)
        XCTAssertEqual(keys[0], keys[1], "a retry of the same context keeps its key")
        let body = try PremiumFixtures.body(router.sentBodies("POST", appealPath).last)
        XCTAssertEqual(body["text"] as? String, "The judges missed that Sam agreed to the menu test last week.")
        XCTAssertEqual(body["evidence"] as? [String], ["ev-tok"])
    }

    @MainActor
    func testAppealUsedAndPaymentErrors() async throws {
        let container = HistoryContainer.inMemory()
        let router = StubRouter()
        let appealPath = Self.casePath + "/appeals"
        router.on("POST", appealPath, try PremiumFixtures.apiError("appeal_used"))
        router.on("GET", "/api/v1/me", try PremiumFixtures.json(200, try PremiumFixtures.object("me", "no_credits")))
        router.install()
        let app = try PremiumFixtures.app(container: container)
        let page = try model("judged", account: app.account)
        page.appealText = "The judges missed that Sam agreed to the menu test last week."
        await page.submitAppeal()
        XCTAssertEqual(ErrorText.message(try XCTUnwrap(page.appealError), lang: .tr), L10n.errorAppealUsed(.tr))

        router.on("POST", appealPath, try PremiumFixtures.apiError("no_credits"))
        await page.submitAppeal()
        XCTAssertEqual(page.appealError?.code, "no_credits")
        try await PremiumFixtures.waitUntil("the account refresh") { router.count("GET", "/api/v1/me") >= 1 }
        withExtendedLifetime(container) {}
    }

    func testCaseList() async throws {
        let router = StubRouter()
        router.on("GET", "/api/v1/cases", try PremiumFixtures.json(200, try PremiumFixtures.section("cases")["list"] as Any))
        router.install()
        let cases = try await api().listCases()
        XCTAssertEqual(cases.map(\.id), ["case0000001", "case0000002", "case0000003"])
        XCTAssertEqual(StubURLProtocol.requests.last?.url?.query, "limit=20")
        XCTAssertEqual(cases[0].status, .awaitingRespondent)
        XCTAssertEqual(cases[1].verdict, .sideA)
        XCTAssertTrue(cases[2].removed)

        XCTAssertEqual(CaseLogic.listTitle(cases[1], lang: .en), "Party A's menu test settles it", "the headline first")
        XCTAssertEqual(CaseLogic.listTitle(cases[0], lang: .en), cases[0].excerpt, "then the side's first words")
        var untitled = cases[0]
        untitled.excerpt = nil
        let date = try XCTUnwrap(ErrorText.formatDate(untitled.createdAt, lang: .en))
        XCTAssertEqual(CaseLogic.listTitle(untitled, lang: .en), L10n.caseListUntitled(.en, date: date))
        XCTAssertEqual(CaseLogic.statusText(.awaitingRespondent, lang: .tr), L10n.caseStatusAwaiting(.tr))
    }

    // MARK: - Creating a case on Home

    @MainActor
    func testCreatingACaseOpensItsPage() async throws {
        let container = HistoryContainer.inMemory()
        let router = StubRouter()
        let created = try PremiumFixtures.json(201, try PremiumFixtures.section("cases")["createResponse"] as Any)
        router.on("POST", "/api/v1/cases", created)
        router.install()
        let app = try PremiumFixtures.app(container: container)
        XCTAssertTrue(app.casesOn)
        let home = app.home
        home.mode = .both
        XCTAssertEqual(home.shownCaseName(app), "Alex", "prefilled from the account's first name")

        home.submit(app: app)
        XCTAssertTrue(home.isCreatingCase)
        try await PremiumFixtures.waitUntil("the case page") { home.path.last == .caseDetail(id: Self.caseID) }
        XCTAssertFalse(home.isCreatingCase)
        XCTAssertEqual(router.count("POST", "/api/v1/clarify"), 0, "no clarifying step for a case")
        XCTAssertEqual(router.count("POST", "/api/v1/verdict"), 0)

        let headers = try XCTUnwrap(router.sentHeaders("POST", "/api/v1/cases").first)
        XCTAssertFalse((headers["Idempotency-Key"] ?? "").isEmpty)
        let body = try PremiumFixtures.body(router.sentBodies("POST", "/api/v1/cases").first)
        XCTAssertEqual(body["text"] as? String, "My friend Sam says a hot dog is a sandwich. I say it is not.")
        XCTAssertEqual((body["framework"] as? [String: Any])?["preset"] as? String, home.preset)
        XCTAssertEqual(body["lang"] as? String, app.lang.rawValue)
        XCTAssertEqual(body["displayName"] as? String, "Alex")
        XCTAssertEqual(body["tier"] as? String, "premium")
        XCTAssertNil(body["evidence"])

        XCTAssertEqual(app.caseNames.names(caseID: Self.caseID).count, 2, "the name map is kept on the phone")
        XCTAssertEqual(app.account.entitlement?.subscription?.used, 13)
        XCTAssertEqual(app.makeCaseModel(id: Self.caseID).view?.status, .awaitingRespondent, "the page opens on the created view")
        XCTAssertTrue(home.argument.isEmpty)
        withExtendedLifetime(container) {}
    }

    @MainActor
    func testCreateErrorsStayOnTheForm() async throws {
        let container = HistoryContainer.inMemory()
        let router = StubRouter()
        router.on("POST", "/api/v1/cases", try PremiumFixtures.apiError("no_credits"))
        router.on("GET", "/api/v1/me", try PremiumFixtures.json(200, try PremiumFixtures.object("me", "no_credits")))
        router.install()
        let app = try PremiumFixtures.app(container: container)
        app.home.mode = .both
        app.home.caseName = ""

        app.home.submit(app: app)
        try await PremiumFixtures.waitUntil("the error") { app.home.error != nil }
        XCTAssertEqual(app.home.error?.code, "no_credits")
        XCTAssertEqual(app.home.path, [.pricing], "out of verdicts opens pricing over the form")
        XCTAssertFalse(app.home.argument.isEmpty)
        let body = try PremiumFixtures.body(router.sentBodies("POST", "/api/v1/cases").first)
        XCTAssertNil(body["displayName"], "an empty name is left out")
        try await PremiumFixtures.waitUntil("the account refresh") { router.count("GET", "/api/v1/me") >= 1 }
        withExtendedLifetime(container) {}
    }

    @MainActor
    func testJustMeStillJudgesAtOnce() throws {
        let container = HistoryContainer.inMemory()
        let app = try PremiumFixtures.app(container: container)
        XCTAssertEqual(app.home.mode, .now, "Just me by default")
        XCTAssertFalse(app.home.isTwoSided(app))
        app.home.mode = .both
        XCTAssertTrue(app.home.isTwoSided(app))
        withExtendedLifetime(container) {}
    }

    @MainActor
    func testSendingALinkWithNothingLeftOpensPricing() async throws {
        let container = HistoryContainer.inMemory()
        let router = StubRouter()
        router.install()
        let app = try PremiumFixtures.app(container: container, me: "no_credits")

        app.home.sendLink(app: app)
        XCTAssertEqual(app.home.path, [.pricing])
        XCTAssertFalse(app.home.isCreatingCase)
        try await Task.sleep(for: .milliseconds(50))
        XCTAssertEqual(router.count("POST", "/api/v1/cases"), 0)
        withExtendedLifetime(container) {}
    }

    func testCaseBodyIsPremium() {
        let body = JudgeAPI.createCaseBody(text: "t", preset: "balanced", lang: .en, evidence: ["ev1"], displayName: nil)
        XCTAssertEqual(body["tier"] as? String, "premium")
        XCTAssertEqual(body["evidence"] as? [String], ["ev1"])
        XCTAssertNil(JudgeAPI.createCaseBody(text: "t", preset: "balanced", lang: .en, evidence: [], displayName: nil)["evidence"])
    }

    @MainActor
    func testSignedOutHidesTheModeSwitch() throws {
        let container = HistoryContainer.inMemory()
        let app = try PremiumFixtures.app(container: container, token: nil)
        XCTAssertFalse(app.casesOn, "signing in comes first; submit still opens sign-in")
        app.home.mode = .both
        XCTAssertFalse(app.home.isTwoSided(app))
        XCTAssertTrue(app.caseListOffered)
        withExtendedLifetime(container) {}
    }

    // MARK: - Links

    @MainActor
    func testLinks() throws {
        let base = AppConfig.production
        XCTAssertEqual(AppLink.parse(URL(string: "https://okjudge.com/r/Xk3pQ9vLm2Rt7YbN4cWd0A")!, site: base), .invite(URL(string: "https://okjudge.com/r/Xk3pQ9vLm2Rt7YbN4cWd0A")!))
        XCTAssertEqual(AppLink.parse(URL(string: "https://okjudge.com/c/case0000001")!, site: base), .caseDetail(id: "case0000001"))
        XCTAssertNil(AppLink.parse(URL(string: "https://example.com/c/case0000001")!, site: base), "other sites are not ours")
        XCTAssertNil(AppLink.parse(URL(string: "https://okjudge.com/v/abc")!, site: base))
        XCTAssertNil(AppLink.parse(URL(string: "https://okjudge.com/c/")!, site: base))
    }
}
