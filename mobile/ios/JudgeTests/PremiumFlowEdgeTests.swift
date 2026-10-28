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
    func testSigningInSubmitsAsTapped() async throws {
        let container = HistoryContainer.inMemory()
        let router = StubRouter()
        try signInRoutes(router, me: "credits7")
        router.on("POST", Self.clarifyPath, try noQuestions())
        router.on("POST", Self.verdictPath, try accepted())
        router.on("GET", Self.pollPath, try ready())
        router.install()
        let app = try PremiumFixtures.app(container: container, token: nil)

        app.home.submit(app: app)
        XCTAssertTrue(app.account.isSignInPresented)
        await signIn(app)
        try await PremiumFixtures.waitUntil("the account") { app.account.entitlement != nil }
        app.account.signInDismissed()
        try await PremiumFixtures.waitUntil("the verdict") { app.home.arrived != nil }
        XCTAssertEqual(router.count("POST", Self.clarifyPath), 1)
        let body = try PremiumFixtures.body(router.sentBodies("POST", Self.verdictPath).first)
        XCTAssertEqual(body["tier"] as? String, "premium")
        withExtendedLifetime(container) {}
    }

    @MainActor
    func testSigningInWithNothingLeftOpensPricing() async throws {
        let container = HistoryContainer.inMemory()
        let router = StubRouter()
        try signInRoutes(router, me: "free")
        router.install()
        let app = try PremiumFixtures.app(container: container, token: nil)

        app.home.submit(app: app)
        await signIn(app)
        try await PremiumFixtures.waitUntil("the account") { app.account.entitlement != nil }
        app.account.signInDismissed()
        XCTAssertEqual(app.home.path, [.pricing])
        XCTAssertEqual(router.count("POST", Self.clarifyPath), 0)
        XCTAssertEqual(router.count("POST", Self.verdictPath), 0)
        XCTAssertFalse(app.home.isBusy)
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

    @MainActor
    func testAPaidVerdictIsPickedUpWithNothingLeft() async throws {
        let container = HistoryContainer.inMemory()
        let router = StubRouter()
        let down = try PremiumFixtures.json(503, ["error": "x", "code": "unavailable"])
        router.on("POST", Self.clarifyPath, try noQuestions())
        router.on("POST", Self.verdictPath, try accepted())
        router.on("GET", Self.pollPath, down, down, down, try ready())
        router.on("GET", "/api/v1/me", try me("no_credits"))
        router.install()
        let app = try PremiumFixtures.app(container: container)
        let home = app.home

        home.submit(app: app)
        try await PremiumFixtures.waitUntil("polling to give up") { home.error != nil }
        try await PremiumFixtures.waitUntil("the spent balance") { app.account.entitlement.map(Balance.init) == .empty }

        home.submit(app: app)
        try await PremiumFixtures.waitUntil("the resumed verdict") { home.arrived != nil }
        XCTAssertEqual(router.count("POST", Self.verdictPath), 1)
        XCTAssertTrue(home.path.isEmpty, "a verdict already paid for is picked up, not sent to pricing")
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

    /// The account's list on this phone: one listed verdict kept for
    /// offline reading, plus one the account doesn't have.
    @MainActor
    private func fillHistory(_ app: AppModel, user: String) throws {
        let listed = try Fixtures.sample("win_a_self")
        let phone = try Fixtures.sample("split")
        try app.history.save(VerdictSession(id: listed.id, original: listed.result, nameMap: listed.nameMap, translations: [:]))
        try app.history.save(VerdictSession(id: "phone1", original: phone.result, nameMap: phone.nameMap, translations: [:]))
        let row = HistoryItem(kind: "verdict", id: listed.id, at: "2026-10-05T00:00:00.000Z", state: "ready")
        try app.history.apply(HistoryPage(items: [row], next: nil), user: user, above: nil)
        app.historyUser = user
    }

    @MainActor
    func testSigningOutForgetsCaseNamesAndTheAccountsVerdicts() async throws {
        let container = HistoryContainer.inMemory()
        let router = StubRouter()
        router.on("POST", "/api/auth/sign-out", try PremiumFixtures.json(200, ["success": true]))
        router.install()
        let app = try PremiumFixtures.app(container: container)
        let names = [NameMapping(original: "Sam", replacement: "Party B")]
        app.caseNames.save(caseID: "c1", names)
        try fillHistory(app, user: "usr_alex001")

        await app.account.signOut()
        XCTAssertTrue(app.caseNames.names(caseID: "c1").isEmpty)
        XCTAssertNil(app.historyUser)
        XCTAssertTrue(try app.history.cached(user: "usr_alex001").isEmpty)
        XCTAssertNil(try app.history.find(id: "abc123DEF0"), "it comes back from the account on sign-in")
        XCTAssertNotNil(try app.history.find(id: "phone1"), "a verdict no account has stays")
        withExtendedLifetime(container) {}
    }

    @MainActor
    func testAnExpiredSessionKeepsCaseNamesAndTheList() throws {
        let container = HistoryContainer.inMemory()
        let app = try PremiumFixtures.app(container: container)
        app.caseNames.save(caseID: "c1", [NameMapping(original: "Sam", replacement: "Party B")])
        try fillHistory(app, user: "usr_alex001")
        app.account.sessionExpired()
        XCTAssertFalse(app.caseNames.names(caseID: "c1").isEmpty, "the same person usually signs back in")
        XCTAssertNil(app.historyUser, "unlisted until a sign-in")
        XCTAssertEqual(try app.history.cached(user: "usr_alex001").map(\.key), ["v:abc123DEF0"])
        XCTAssertNotNil(try app.history.find(id: "abc123DEF0"))
        withExtendedLifetime(container) {}
    }

    @MainActor
    func testALaunchListsTheAccountMeNamedForThisSessionOnly() throws {
        let container = HistoryContainer.inMemory()
        let config = AppConfig(apiBaseURL: AppConfig.production, shareBaseURL: AppConfig.production, version: "1", build: "1")
        let defaults = try XCTUnwrap(UserDefaults(suiteName: "judge.tests.\(UUID().uuidString)"))
        func launch(token: String) -> AppModel {
            let api = JudgeAPI(baseURL: AppConfig.production, userAgent: "Judge-iOS/test", tokenStore: MemoryTokenStore(token: token))
            return AppModel(config: config, container: container, defaults: defaults, persistsDraft: false, api: api, caseNames: MemoryCaseNamesStore())
        }
        let first = launch(token: "s3ss10n")
        XCTAssertNil(first.historyUser, "no answer from /me yet")
        first.account.onUserKnown?("usr_alex001")
        XCTAssertEqual(launch(token: "s3ss10n").historyUser, "usr_alex001")
        XCTAssertNil(launch(token: "n3wer").historyUser, "a newer session waits for /me")
        first.account.sessionExpired()
        XCTAssertNil(launch(token: "s3ss10n").historyUser)
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
