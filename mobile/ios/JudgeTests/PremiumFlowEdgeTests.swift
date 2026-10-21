import SwiftData
import XCTest
@testable import Judge

/// Edge cases of the premium and case flows: signing in midway, resuming a
/// premium verdict, refused evidence, large picks and ending a session.
final class PremiumFlowEdgeTests: XCTestCase {
    override func setUp() {
        super.setUp()
        StubURLProtocol.handler = nil
        StubURLProtocol.requests = []
    }

    override func tearDown() {
        StubURLProtocol.handler = nil
        super.tearDown()
    }

    private static let verdictPath = "/api/v1/verdict"
    private static let clarifyPath = "/api/v1/clarify"
    private static let pollPath = "/api/v1/verdicts/premium001"

    private func accepted() throws -> StubURLProtocol.Reply {
        var body = try PremiumFixtures.object("premiumVerdictResponse", "accepted")
        body["pollAfterMs"] = 10
        return try PremiumFixtures.json(202, body)
    }

    private func ready() throws -> StubURLProtocol.Reply {
        let polls = try XCTUnwrap(PremiumFixtures.section("premiumVerdictResponse")["polls"] as? [String: Any])
        return try PremiumFixtures.json(200, try XCTUnwrap(polls["ready"]))
    }

    private func noQuestions() throws -> StubURLProtocol.Reply {
        try PremiumFixtures.json(200, try PremiumFixtures.object("clarifyResponse", "none"))
    }

    private func me(_ name: String) throws -> StubURLProtocol.Reply {
        try PremiumFixtures.json(200, try PremiumFixtures.object("me", name))
    }

    /// Email-code sign-in routes answering for the fixture account `me`.
    private func signInRoutes(_ router: StubRouter, me name: String) throws {
        router.on("POST", "/api/auth/email-otp/send-verification-otp", try PremiumFixtures.json(200, ["success": true]))
        router.on("POST", "/api/auth/sign-in/email-otp", try PremiumFixtures.json(200, [
            "token": "fr3sh",
            "user": ["id": "usr_alex001", "email": "alex@example.com", "name": "Alex", "image": NSNull()] as [String: Any],
        ]))
        router.on("GET", "/api/v1/me", try me(name))
    }

    @MainActor
    private func signIn(_ app: AppModel) async {
        app.account.email = "alex@example.com"
        await app.account.sendCode(lang: .en)
        app.account.code = "123456"
        await app.account.verifyCode()
    }

    // MARK: - Signing in midway

    @MainActor
    func testSigningInThatUnlocksPremiumSendsNothing() async throws {
        let container = HistoryContainer.inMemory()
        let router = StubRouter()
        try signInRoutes(router, me: "credits7")
        router.install()
        let app = try PremiumFixtures.app(container: container, token: nil)
        app.setTierChoice(.premium)
        XCTAssertEqual(app.effectiveTier, .free, "signed out, the remembered Premium does not count")

        app.home.submit(app: app)
        XCTAssertTrue(app.account.isSignInPresented)
        await signIn(app)
        try await PremiumFixtures.waitUntil("Premium unlocked by /me") { app.effectiveTier == .premium }
        app.account.signInDismissed()
        try await Task.sleep(for: .milliseconds(100))

        XCTAssertEqual(router.count("POST", Self.verdictPath), 0, "the user tapped for Free; Premium is now shown instead")
        XCTAssertEqual(router.count("POST", Self.clarifyPath), 0)
        XCTAssertEqual(router.count("POST", "/api/v1/cases"), 0)
        XCTAssertFalse(app.home.isBusy)
        withExtendedLifetime(container) {}
    }

    @MainActor
    func testSigningInThatChangesNothingSubmitsAsTapped() async throws {
        let container = HistoryContainer.inMemory()
        let router = StubRouter()
        try signInRoutes(router, me: "free")
        let sample = try XCTUnwrap(Fixtures.verdicts()["verdictResponses"] as? [String: Any])["win_a_self"]
        router.on("POST", Self.verdictPath, try PremiumFixtures.json(200, try XCTUnwrap(sample)))
        router.install()
        let app = try PremiumFixtures.app(container: container, token: nil)

        app.home.submit(app: app)
        await signIn(app)
        try await PremiumFixtures.waitUntil("the account") { app.account.entitlement != nil }
        app.account.signInDismissed()
        try await PremiumFixtures.waitUntil("the free verdict") { app.home.arrived != nil }
        let body = try PremiumFixtures.body(router.sentBodies("POST", Self.verdictPath).first)
        XCTAssertEqual(body["tier"] as? String, "free")
        withExtendedLifetime(container) {}
    }

    // MARK: - Resuming a premium verdict

    @MainActor
    func testAResumedPremiumVerdictRetiresItsKey() async throws {
        let container = HistoryContainer.inMemory()
        let router = StubRouter()
        let down = try PremiumFixtures.json(503, ["error": "x", "code": "unavailable"])
        router.on("POST", Self.clarifyPath, try noQuestions())
        router.on("POST", Self.verdictPath, try accepted())
        router.on("GET", Self.pollPath, down, down, down, try ready())
        router.on("GET", "/api/v1/me", try me("credits7"))
        router.install()
        let app = try PremiumFixtures.app(container: container)
        app.setTierChoice(.premium)
        let home = app.home

        home.submit(app: app)
        try await PremiumFixtures.waitUntil("polling to give up") { home.error != nil }
        XCTAssertEqual(router.count("POST", Self.verdictPath), 1)

        home.submit(app: app)
        try await PremiumFixtures.waitUntil("the resumed verdict") { home.arrived != nil }
        XCTAssertEqual(router.count("POST", Self.verdictPath), 1, "the accepted verdict is polled again, not asked for twice")
        XCTAssertEqual(router.count("POST", Self.clarifyPath), 1, "resuming skips the questions")

        // The same text again is a new request with a new key.
        home.judgingFinished()
        home.submit(app: app)
        try await PremiumFixtures.waitUntil("the second post") { router.count("POST", Self.verdictPath) == 2 }
        let keys = router.sentHeaders("POST", Self.verdictPath).compactMap { $0["Idempotency-Key"] }
        XCTAssertEqual(keys.count, 2)
        XCTAssertNotEqual(keys[0], keys[1])
        home.cancel()
        withExtendedLifetime(container) {}
    }

    // MARK: - Evidence

    @MainActor
    func testRefusedEvidenceTokensMustBeAddedAgain() async throws {
        let container = HistoryContainer.inMemory()
        let router = StubRouter()
        router.on("POST", Self.clarifyPath, try noQuestions())
        router.on("POST", Self.verdictPath, try PremiumFixtures.json(400, ["error": "x", "code": "evidence_invalid"]))
        router.on("GET", "/api/v1/me", try me("credits7"))
        router.install()
        let app = try PremiumFixtures.app(container: container)
        app.setTierChoice(.premium)
        let home = app.home
        let ids = home.evidence.reserve(2)
        home.evidence.apply([
            EvidenceUploadItem(index: 0, status: "ok", token: "old-1", preview: "one"),
            EvidenceUploadItem(index: 1, status: "unreadable"),
        ], sent: ids)

        home.submit(app: app)
        try await PremiumFixtures.waitUntil("the error") { home.error != nil }
        XCTAssertEqual(home.error?.code, "evidence_invalid")
        XCTAssertEqual(home.evidence.items.map(\.status), [.failed, .unreadable])
        XCTAssertTrue(home.evidence.tokens.isEmpty)
        withExtendedLifetime(container) {}
    }

    @MainActor
    func testAHugePickIsTooLargeWithoutAnUpload() async throws {
        let router = StubRouter()
        router.install()
        let evidence = EvidenceModel(max: 3)
        let ids = evidence.reserve(1)
        let api = JudgeAPI(
            baseURL: AppConfig.production,
            userAgent: "Judge-iOS/test",
            session: JudgeAPI.makeSession(protocolClasses: [StubURLProtocol.self])
        )
        await evidence.process(ids, files: [Data(count: ImagePreparation.maxSourceBytes + 1)], api: api)
        XCTAssertEqual(evidence.items.map(\.status), [.tooLarge])
        XCTAssertEqual(router.count("POST", "/api/v1/evidence"), 0)
    }

    func testPickedFilesAreReadFromDiskAndRemoved() throws {
        let png = try PremiumFixtures.image(width: 120, height: 60, type: .png)
        let url = FileManager.default.temporaryDirectory.appending(path: "evidence-test-\(UUID().uuidString).png")
        try png.write(to: url)
        XCTAssertEqual(ImagePreparation.prepare(fileAt: url), .ready(PreparedImage(data: png, mimeType: "image/png", width: 120, height: 60)))

        let big = try PremiumFixtures.image(width: 2000, height: 1000, type: .png)
        let bigURL = FileManager.default.temporaryDirectory.appending(path: "evidence-test-\(UUID().uuidString).png")
        try big.write(to: bigURL)
        guard case .ready(let scaled) = ImagePreparation.prepare(.file(bigURL)) else { return XCTFail("expected a prepared image") }
        XCTAssertEqual(scaled.width, 1600)
        XCTAssertEqual(scaled.mimeType, "image/jpeg")
        XCTAssertFalse(FileManager.default.fileExists(atPath: bigURL.path), "the copy is removed once read")

        XCTAssertEqual(ImagePreparation.prepare(.missing), .unsupported)
        try? FileManager.default.removeItem(at: url)
    }

    // MARK: - Ending the session

    @MainActor
    func testSigningOutForgetsCaseNamesAndTheList() async throws {
        let container = HistoryContainer.inMemory()
        let router = StubRouter()
        router.on("POST", "/api/auth/sign-out", try PremiumFixtures.json(200, ["success": true]))
        router.install()
        let app = try PremiumFixtures.app(container: container)
        let names = [NameMapping(original: "Sam", replacement: "Party B")]
        app.caseNames.save(caseID: "c1", names)
        app.caseList.showForScreenshot([])
        XCTAssertNotEqual(app.caseList.state, .idle)

        await app.account.signOut()
        XCTAssertTrue(app.caseNames.names(caseID: "c1").isEmpty)
        XCTAssertEqual(app.caseList.state, .idle)
        withExtendedLifetime(container) {}
    }

    @MainActor
    func testAnExpiredSessionKeepsCaseNames() throws {
        let container = HistoryContainer.inMemory()
        let app = try PremiumFixtures.app(container: container)
        app.caseNames.save(caseID: "c1", [NameMapping(original: "Sam", replacement: "Party B")])
        app.caseList.showForScreenshot([])
        app.account.sessionExpired()
        XCTAssertFalse(app.caseNames.names(caseID: "c1").isEmpty, "the same person usually signs back in")
        XCTAssertEqual(app.caseList.state, .idle)
        withExtendedLifetime(container) {}
    }

    @MainActor
    func testAnEntitlementBeforeTheAccountLoadsIsNotStoredWithoutAUser() {
        let account = AccountModel(api: JudgeAPI(baseURL: AppConfig.production, userAgent: "t", tokenStore: MemoryTokenStore(token: "s3ss10n")))
        account.usesNetwork = false
        XCTAssertTrue(account.isSignedIn)
        account.applyEntitlement(Entitlement(canUsePremium: true, credits: 3))
        XCTAssertNil(account.info, "no account without a user")
    }
}
