import XCTest
@testable import Judge

/// The age rules alone.
final class AgeCheckTests: XCTestCase {
    private let unconfirmed = AgeStatus(confirmed: false, blocked: false)
    private let confirmed = AgeStatus(confirmed: true, blocked: false)
    private let blocked = AgeStatus(confirmed: false, blocked: true)

    func testDeclaredRanges() {
        // One gate at 18: the range below it, or 18 and up.
        XCTAssertEqual(AgeCheck.fromRange(lower: nil, upper: 17), .minor)
        XCTAssertEqual(AgeCheck.fromRange(lower: 13, upper: 17), .minor)
        XCTAssertEqual(AgeCheck.fromRange(lower: 18, upper: nil), .adult)
        XCTAssertEqual(AgeCheck.fromRange(lower: nil, upper: nil), .unknown)
        // The system may move the gates for local rules.
        XCTAssertEqual(AgeCheck.fromRange(lower: 16, upper: nil), .unknown)
    }

    func testReports() {
        XCTAssertEqual(AgeCheck.report(platform: .minor, age: unconfirmed, ticked: true), AgeCheck.Report(adult: false, source: "platform"))
        XCTAssertEqual(AgeCheck.report(platform: .minor, age: confirmed, ticked: false), AgeCheck.Report(adult: false, source: "platform"))
        XCTAssertNil(AgeCheck.report(platform: .minor, age: blocked, ticked: false))
        XCTAssertEqual(AgeCheck.report(platform: .adult, age: unconfirmed, ticked: true), AgeCheck.Report(adult: true, source: "platform"))
        XCTAssertNil(AgeCheck.report(platform: .adult, age: confirmed, ticked: false))
        XCTAssertEqual(AgeCheck.report(platform: .unknown, age: unconfirmed, ticked: true), AgeCheck.Report(adult: true, source: "checkbox"))
        XCTAssertEqual(AgeCheck.report(platform: nil, age: unconfirmed, ticked: true), AgeCheck.Report(adult: true, source: "checkbox"))
        XCTAssertNil(AgeCheck.report(platform: .unknown, age: unconfirmed, ticked: false))
        // A server without the age check never hears about it.
        XCTAssertNil(AgeCheck.report(platform: .minor, age: nil, ticked: true))
    }

    func testGate() {
        XCTAssertEqual(AgeCheck.gate(platform: .minor, signedIn: false, age: nil, posting: false), .blocked)
        XCTAssertEqual(AgeCheck.gate(platform: .adult, signedIn: true, age: blocked, posting: false), .blocked)
        XCTAssertEqual(AgeCheck.gate(platform: .unknown, signedIn: true, age: unconfirmed, posting: false), .confirm)
        XCTAssertEqual(AgeCheck.gate(platform: nil, signedIn: true, age: unconfirmed, posting: false), .none)
        XCTAssertEqual(AgeCheck.gate(platform: .adult, signedIn: true, age: unconfirmed, posting: true), .none)
        XCTAssertEqual(AgeCheck.gate(platform: .unknown, signedIn: true, age: confirmed, posting: false), .none)
        XCTAssertEqual(AgeCheck.gate(platform: .unknown, signedIn: true, age: nil, posting: false), .none)
        XCTAssertFalse(AgeCheck.needsCheckbox(platform: .adult))
        XCTAssertTrue(AgeCheck.needsCheckbox(platform: .unknown))
        XCTAssertTrue(AgeCheck.needsCheckbox(platform: nil))
    }

    func testServerErrorsAsCodeOrBareError() {
        let bare = APIError.from(status: 403, body: Data(#"{"error":"age_blocked"}"#.utf8), retryAfterHeader: nil)
        XCTAssertEqual(bare.code, "age_blocked")
        let coded = APIError.from(status: 403, body: Data(#"{"error":"Confirm first","code":"age_unconfirmed"}"#.utf8), retryAfterHeader: nil)
        XCTAssertEqual(coded.code, "age_unconfirmed")
        let other = APIError.from(status: 403, body: Data(#"{"error":"No","code":"not_party"}"#.utf8), retryAfterHeader: nil)
        XCTAssertEqual(other.code, "not_party")
        XCTAssertEqual(ErrorText.message(bare, lang: .en), L10n.appAgeBlockedTitle(.en))
        XCTAssertEqual(ErrorText.message(coded, lang: .en), L10n.appAgeRequired(.en))
    }
}

@MainActor
private final class FakeAgeRange: AgeRangeAsking {
    var answer: PlatformAge
    /// Never answers in time, like a prompt left open.
    var hangs = false
    private(set) var calls = 0

    init(_ answer: PlatformAge) {
        self.answer = answer
    }

    func ask() async -> PlatformAge {
        calls += 1
        if hangs { try? await Task.sleep(for: .seconds(30)) }
        return answer
    }
}

/// The account's side: what it reports, and the gate it shows.
final class AccountAgeTests: XCTestCase {
    private var router: StubRouter!

    override func setUp() {
        super.setUp()
        StubURLProtocol.requests = []
        router = StubRouter()
        router.install()
    }

    override func tearDown() {
        StubURLProtocol.handler = nil
        super.tearDown()
    }

    private func me(_ age: [String: Any]?) throws -> StubURLProtocol.Reply {
        var body: [String: Any] = [
            "user": ["id": "u1", "email": "ann@example.com", "name": "Ann", "image": NSNull()] as [String: Any],
            "entitlement": ["canUsePremium": false, "credits": 0] as [String: Any],
        ]
        if let age { body["age"] = age }
        return try PremiumFixtures.json(200, body)
    }

    /// Signed in from the start, wired as in AppModel.
    @MainActor
    private func makeAccount(_ phone: PlatformAge, token: String? = "t0k") -> (AccountModel, JudgeAPI, FakeAgeRange) {
        let (stream, sink) = AsyncStream.makeStream(of: String.self)
        let api = JudgeAPI(
            baseURL: AppConfig.production,
            userAgent: "Judge-iOS/test",
            tokenStore: MemoryTokenStore(token: token),
            session: JudgeAPI.makeSession(protocolClasses: [StubURLProtocol.self]),
            ageGate: sink
        )
        let fake = FakeAgeRange(phone)
        let account = AccountModel(api: api, ageRange: fake)
        account.listen(toAgeGates: stream)
        return (account, api, fake)
    }

    private func sent(_ index: Int = 0) throws -> [String: Any] {
        let body = try XCTUnwrap(router.sentBodies("POST", "/api/v1/me/age")[safe: index])
        return try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
    }

    @MainActor
    func testUnder18OnThePhoneIsReportedAndBlocks() async throws {
        router.on("GET", "/api/v1/me", try me(["confirmed": true, "blocked": false]))
        router.on("POST", "/api/v1/me/age", try PremiumFixtures.json(200, ["confirmed": false, "blocked": true]))
        let (account, _, _) = makeAccount(.minor)
        await account.refresh()
        // Confirmed accounts are not asked; the sign-in sheet would ask.
        XCTAssertFalse(account.needsPlatformAge(onSignIn: false))
        await account.checkPlatformAge()
        XCTAssertEqual(try sent()["adult"] as? Bool, false)
        XCTAssertEqual(try sent()["source"] as? String, "platform")
        XCTAssertEqual(account.info?.age?.blocked, true)
        XCTAssertEqual(account.ageGate, .blocked)
    }

    @MainActor
    func test18PlusOnThePhoneConfirmsWithoutTheCheckbox() async throws {
        router.on("GET", "/api/v1/me", try me(["confirmed": false, "blocked": false]))
        router.on("POST", "/api/v1/me/age", try PremiumFixtures.json(200, ["age": ["confirmed": true, "blocked": false]]))
        let (account, _, _) = makeAccount(.adult)
        await account.refresh()
        XCTAssertTrue(account.needsPlatformAge(onSignIn: false))
        await account.checkPlatformAge()
        XCTAssertFalse(account.needsAgeCheckbox)
        XCTAssertEqual(try sent()["adult"] as? Bool, true)
        XCTAssertEqual(try sent()["source"] as? String, "platform")
        XCTAssertEqual(account.ageGate, .none)
    }

    @MainActor
    func testUnknownPhoneShowsTheSheetUntilTheBoxIsTicked() async throws {
        router.on("GET", "/api/v1/me", try me(["confirmed": false, "blocked": false]))
        router.on("POST", "/api/v1/me/age", try PremiumFixtures.json(200, ["confirmed": true, "blocked": false]))
        let (account, _, fake) = makeAccount(.unknown)
        await account.refresh()
        await account.checkPlatformAge()
        XCTAssertEqual(account.ageGate, .confirm)
        XCTAssertEqual(router.count("POST", "/api/v1/me/age"), 0)

        await account.confirmAge()
        XCTAssertEqual(router.count("POST", "/api/v1/me/age"), 0, "nothing is sent before the box is ticked")
        account.setAgeTicked(true)
        await account.confirmAge()
        XCTAssertEqual(try sent()["source"] as? String, "checkbox")
        XCTAssertEqual(account.ageGate, .none)
        await account.checkPlatformAge()
        XCTAssertEqual(fake.calls, 1, "the phone is asked once per run")
    }

    @MainActor
    func testTickedBeforeSignInIsSentOnceTheAccountIsKnown() async throws {
        router.on("GET", "/api/v1/me", try me(["confirmed": false, "blocked": false]))
        router.on("POST", "/api/v1/me/age", try PremiumFixtures.json(200, ["confirmed": true, "blocked": false]))
        let (account, _, _) = makeAccount(.unknown)
        account.setAgeTicked(true)
        await account.refresh()
        XCTAssertEqual(try sent()["source"] as? String, "checkbox")
        XCTAssertEqual(account.info?.age?.confirmed, true)
    }

    @MainActor
    func testAServerWithoutTheAgeCheckChangesNothing() async throws {
        router.on("GET", "/api/v1/me", try me(nil))
        let (account, _, _) = makeAccount(.minor)
        account.setAgeTicked(true)
        await account.refresh()
        XCTAssertEqual(router.count("POST", "/api/v1/me/age"), 0)
        XCTAssertFalse(account.needsPlatformAge(onSignIn: false))
        XCTAssertEqual(account.ageGate, .none)
    }

    @MainActor
    func testAFailedReportShowsWhyOnTheSheet() async throws {
        router.on("GET", "/api/v1/me", try me(["confirmed": false, "blocked": false]))
        let (account, _, _) = makeAccount(.unknown)
        await account.refresh()
        await account.checkPlatformAge()
        account.setAgeTicked(true)
        await account.confirmAge()
        XCTAssertEqual(account.ageError, .offline)
        XCTAssertEqual(account.ageGate, .confirm)
    }

    @MainActor
    func testABlocked403FromAnyCallOpensTheBlockedPage() async throws {
        router.on("GET", "/api/v1/me", try me(["confirmed": true, "blocked": false]))
        router.on("GET", "/api/v1/verdicts/abc", try PremiumFixtures.json(403, ["error": "age_blocked"]))
        let (account, api, _) = makeAccount(.unknown)
        await account.refresh()
        do {
            _ = try await api.storedVerdict(id: "abc")
            XCTFail("expected a 403")
        } catch let error as APIError {
            XCTAssertEqual(ErrorText.message(error, lang: .en), L10n.appAgeBlockedTitle(.en))
        }
        try await PremiumFixtures.waitUntil("the blocked page") { account.ageGate == .blocked }
    }

    @MainActor
    func testAnUnconfirmed403OpensTheSheet() async throws {
        router.on("GET", "/api/v1/me", try me(["confirmed": true, "blocked": false]))
        router.on("GET", "/api/v1/verdicts/abc", try PremiumFixtures.json(403, ["error": "Confirm first", "code": "age_unconfirmed"]))
        let (account, api, _) = makeAccount(.unknown)
        await account.refresh()
        await account.checkPlatformAge()
        _ = try? await api.storedVerdict(id: "abc")
        try await PremiumFixtures.waitUntil("the age sheet") { account.ageGate == .confirm }
    }

    /// Email-code sign-in answering for an account that hasn't confirmed yet.
    private func signInRoutes(age: StubURLProtocol.Reply) throws {
        router.on("POST", "/api/auth/email-otp/send-verification-otp", try PremiumFixtures.json(200, ["success": true]))
        router.on("POST", "/api/auth/sign-in/email-otp", try PremiumFixtures.json(200, [
            "token": "fr3sh",
            "user": ["id": "u1", "email": "ann@example.com", "name": "Ann", "image": NSNull()] as [String: Any],
        ]))
        router.on("GET", "/api/v1/me", try me(["confirmed": false, "blocked": false]))
        router.on("POST", "/api/v1/me/age", age)
    }

    @MainActor
    private func signIn(_ account: AccountModel) async {
        account.email = "ann@example.com"
        account.setAgeTicked(true)
        await account.sendCode(lang: .en)
        account.code = "123456"
        await account.verifyCode()
    }

    @MainActor
    func testTickSignInThenThePendingVerdictRunsAfterTheAgeIsOnRecord() async throws {
        try signInRoutes(age: try PremiumFixtures.json(200, ["confirmed": true, "blocked": false]))
        let (account, _, _) = makeAccount(.unknown, token: nil)
        await account.checkPlatformAge()
        var ran = 0
        account.requireSignIn { ran += 1 }
        XCTAssertTrue(account.isSignInPresented)
        await signIn(account)
        XCTAssertTrue(account.isSignedIn)
        XCTAssertFalse(account.isSignInPresented)
        XCTAssertEqual(router.count("POST", "/api/v1/me/age"), 1, "reported before the sheet closed")
        XCTAssertEqual(try sent()["source"] as? String, "checkbox")
        XCTAssertTrue(account.ageCleared)
        account.signInDismissed()
        XCTAssertEqual(ran, 1)
    }

    @MainActor
    func testTickSignInWithAFailedReportHoldsThePendingVerdictForTheSheet() async throws {
        try signInRoutes(age: try PremiumFixtures.json(503, ["error": "down", "code": "unavailable"]))
        let (account, _, _) = makeAccount(.unknown, token: nil)
        await account.checkPlatformAge()
        var ran = 0
        account.requireSignIn { ran += 1 }
        await signIn(account)
        account.signInDismissed()
        XCTAssertEqual(ran, 0, "the verdict would be refused as unconfirmed")
        XCTAssertEqual(account.ageGate, .confirm)
        XCTAssertNotNil(account.ageError)

        router.on("POST", "/api/v1/me/age", try PremiumFixtures.json(200, ["confirmed": true, "blocked": false]))
        await account.confirmAge()
        XCTAssertEqual(account.ageGate, .none)
        XCTAssertEqual(ran, 1, "confirming lets it go")
    }

    @MainActor
    func testAHeldActionRunsWhenARefreshFindsTheAgeConfirmed() async throws {
        try signInRoutes(age: try PremiumFixtures.json(503, ["error": "down", "code": "unavailable"]))
        let (account, _, _) = makeAccount(.unknown, token: nil)
        await account.checkPlatformAge()
        var ran = 0
        account.requireSignIn { ran += 1 }
        await signIn(account)
        account.signInDismissed()
        XCTAssertEqual(ran, 0)
        // Confirmed meanwhile on another device.
        router.on("GET", "/api/v1/me", try me(["confirmed": true, "blocked": false]))
        await account.refresh()
        XCTAssertEqual(ran, 1)
    }

    @MainActor
    func testAPhoneThatNeverAnswersTimesOutIntoTheSheet() async throws {
        router.on("GET", "/api/v1/me", try me(["confirmed": false, "blocked": false]))
        // A late "unknown" changes nothing once the wait gave up.
        let (account, _, fake) = makeAccount(.unknown)
        fake.hangs = true
        account.platformTimeout = .milliseconds(50)
        await account.refresh()
        XCTAssertEqual(account.ageRefusal, AgeCheck.unconfirmedCode)
        Task { await account.checkPlatformAge() }
        try await PremiumFixtures.waitUntil("the timeout") { account.platformAge == .unknown }
        XCTAssertEqual(account.ageGate, .confirm)
    }

    @MainActor
    func testSignInWaitsForTheBox() async throws {
        let api = JudgeAPI(
            baseURL: AppConfig.production,
            userAgent: "Judge-iOS/test",
            tokenStore: MemoryTokenStore(),
            session: JudgeAPI.makeSession(protocolClasses: [StubURLProtocol.self])
        )
        let account = AccountModel(api: api, ageRange: FakeAgeRange(.unknown))
        account.email = "ann@example.com"
        XCTAssertFalse(account.canSendCode)
        await account.sendCode(lang: .en)
        XCTAssertEqual(router.count("POST", "/api/auth/email-otp/send-verification-otp"), 0)
        account.setAgeTicked(true)
        XCTAssertTrue(account.canSendCode)
    }
}

private extension Array {
    subscript(safe index: Int) -> Element? { indices.contains(index) ? self[index] : nil }
}
