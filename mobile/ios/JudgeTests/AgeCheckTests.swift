import XCTest
@testable import Judge

/// The age rules alone.
final class AgeCheckTests: XCTestCase {
    private let none = AgeStatus()
    private let needsDob = AgeStatus(needsDob: true)
    private let done = AgeStatus(confirmed: true)
    private let oldBlock = AgeStatus(blocked: true, needsDob: true)
    private let finalBlock = AgeStatus(blocked: true)

    private func utc(_ y: Int, _ m: Int, _ d: Int, _ h: Int = 0, _ min: Int = 0) -> Date {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        return calendar.date(from: DateComponents(year: y, month: m, day: d, hour: h, minute: min))!
    }

    func testDeclaredRanges() {
        XCTAssertEqual(AgeCheck.fromRange(lower: nil, upper: 12), .under13)
        XCTAssertEqual(AgeCheck.fromRange(lower: nil, upper: 17), .minor)
        XCTAssertEqual(AgeCheck.fromRange(lower: 13, upper: 17), .minor)
        XCTAssertEqual(AgeCheck.fromRange(lower: 18, upper: nil), .adult)
        XCTAssertEqual(AgeCheck.fromRange(lower: nil, upper: nil), .unknown)
        // A range across 18 says nothing, and so does a moved gate.
        XCTAssertEqual(AgeCheck.fromRange(lower: 13, upper: nil), .unknown)
        XCTAssertEqual(AgeCheck.fromRange(lower: 16, upper: nil), .unknown)
    }

    func testReports() {
        XCTAssertEqual(AgeCheck.report(platform: .adult, age: done), AgeCheck.Report(adult: true))
        XCTAssertEqual(AgeCheck.report(platform: .minor, age: done), AgeCheck.Report(adult: false))
        XCTAssertEqual(AgeCheck.report(platform: .under13, age: done), AgeCheck.Report(adult: false, under13: true))
        XCTAssertEqual(AgeCheck.report(platform: .adult, age: needsDob), AgeCheck.Report(adult: true))
        XCTAssertEqual(AgeCheck.report(platform: .minor, age: oldBlock), AgeCheck.Report(adult: false))
        XCTAssertNil(AgeCheck.report(platform: .unknown, age: done))
        XCTAssertNil(AgeCheck.report(platform: nil, age: done))
        XCTAssertNil(AgeCheck.report(platform: .minor, age: finalBlock))
        // A server without the age check never hears about it.
        XCTAssertNil(AgeCheck.report(platform: .minor, age: nil))
    }

    func testGate() {
        XCTAssertEqual(AgeCheck.gate(signedIn: true, age: finalBlock), .blocked)
        XCTAssertEqual(AgeCheck.gate(signedIn: true, age: oldBlock), .date)
        XCTAssertEqual(AgeCheck.gate(signedIn: true, age: needsDob), .date)
        XCTAssertEqual(AgeCheck.gate(signedIn: true, age: done), .none)
        XCTAssertEqual(AgeCheck.gate(signedIn: true, age: none), .none)
        XCTAssertEqual(AgeCheck.gate(signedIn: true, age: nil), .none)
        XCTAssertEqual(AgeCheck.gate(signedIn: false, age: needsDob), .none)
    }

    func testStatusDecoding() throws {
        let full = try JSONDecoder().decode(AgeStatus.self, from: Data(#"{"confirmed":true,"blocked":false,"teen":true,"needsDob":true}"#.utf8))
        XCTAssertEqual(full, AgeStatus(confirmed: true, blocked: false, teen: true, needsDob: true))
        let old = try JSONDecoder().decode(AgeStatus.self, from: Data(#"{"confirmed":true,"blocked":false}"#.utf8))
        XCTAssertEqual(old, AgeStatus(confirmed: true))
        let info = try JSONDecoder().decode(AccountInfo.self, from: Data(#"{"user":null,"entitlement":null,"age":{"confirmed":false,"blocked":true,"teen":false,"needsDob":false}}"#.utf8))
        XCTAssertEqual(info.age, finalBlock)
    }

    func testUnderThirteenRule() {
        let now = utc(2026, 11, 25, 12)
        // UTC+14 is already the 26th, so a 13th birthday on the 26th counts.
        XCTAssertFalse(AgeCheck.underThirteen(dob: "2013-11-26", now: now))
        XCTAssertTrue(AgeCheck.underThirteen(dob: "2013-11-27", now: now))
        XCTAssertFalse(AgeCheck.underThirteen(dob: "2000-01-01", now: now))
        // Ten o'clock UTC is midnight in UTC+14: the cut-off moves one day.
        XCTAssertTrue(AgeCheck.underThirteen(dob: "2013-11-26", now: utc(2026, 11, 25, 9, 59)))
        XCTAssertFalse(AgeCheck.underThirteen(dob: "2013-11-26", now: utc(2026, 11, 25, 10, 0)))
    }

    func testUnderThirteenOnLeapDay() {
        let leap = utc(2028, 2, 29, 0)
        XCTAssertEqual(AgeCheck.yearsBefore(leap, years: 13), "2015-02-28")
        XCTAssertFalse(AgeCheck.underThirteen(dob: "2015-02-28", now: leap))
        XCTAssertTrue(AgeCheck.underThirteen(dob: "2015-03-01", now: leap))
        XCTAssertEqual(AgeCheck.yearsBefore(utc(2029, 2, 28, 0), years: 13), "2016-02-28")
    }

    func testLatestDateIsTodayInTheFirstTimeZone() {
        XCTAssertEqual(AgeCheck.latestDob(now: utc(2026, 11, 25, 9, 59)), "2026-11-25")
        XCTAssertEqual(AgeCheck.latestDob(now: utc(2026, 11, 25, 10, 0)), "2026-11-26")
        XCTAssertEqual(AgeCheck.latestDob(now: utc(2026, 12, 31, 12)), "2027-01-01")
    }

    func testPickedDayIsSentAsAPlainDate() throws {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = try XCTUnwrap(TimeZone(identifier: "America/Toronto"))
        let late = try XCTUnwrap(calendar.date(from: DateComponents(year: 2000, month: 2, day: 29, hour: 23, minute: 30)))
        XCTAssertEqual(AgeCheck.dobString(from: late, calendar: calendar), "2000-02-29")
        let range = AgeCheck.dobRange(now: utc(2026, 11, 25, 12), calendar: calendar)
        XCTAssertEqual(AgeCheck.dobString(from: range.lowerBound, calendar: calendar), "1900-01-01")
        XCTAssertEqual(AgeCheck.dobString(from: range.upperBound, calendar: calendar), "2026-11-26")
    }

    func testDatesStayGregorianOnOtherCalendars() throws {
        let range = AgeCheck.dobRange(now: utc(2026, 11, 25, 12))
        XCTAssertEqual(AgeCheck.dobString(from: range.lowerBound, calendar: AgeCheck.gregorian), "1900-01-01")
        XCTAssertEqual(AgeCheck.dobString(from: range.upperBound, calendar: AgeCheck.gregorian), "2026-11-26")
        // The same day on a Buddhist or a Persian phone reads as other years.
        let buddhist = Calendar(identifier: .buddhist)
        XCTAssertEqual(buddhist.component(.year, from: range.lowerBound), 2443)
        let persian = Calendar(identifier: .persian)
        XCTAssertEqual(persian.component(.year, from: range.upperBound), 1405)
        let picked = try XCTUnwrap(AgeCheck.gregorian.date(from: DateComponents(year: 1990, month: 3, day: 9, hour: 12)))
        XCTAssertEqual(AgeCheck.dobString(from: picked, calendar: AgeCheck.gregorian), "1990-03-09")
        XCTAssertNotEqual(AgeCheck.dobString(from: picked, calendar: buddhist), "1990-03-09")
        XCTAssertNotEqual(AgeCheck.dobString(from: picked, calendar: persian), "1990-03-09")
    }

    func testLongDateFollowsTheLanguage() {
        XCTAssertEqual(AgeCheck.longDate("2013-11-26", lang: .en), "November 26, 2013")
        XCTAssertNotEqual(AgeCheck.longDate("2013-11-26", lang: .tr), AgeCheck.longDate("2013-11-26", lang: .en))
    }

    func testServerErrorsAsCodeOrBareError() {
        let bare = APIError.from(status: 403, body: Data(#"{"error":"age_blocked"}"#.utf8), retryAfterHeader: nil)
        XCTAssertEqual(bare.code, "age_blocked")
        let coded = APIError.from(status: 403, body: Data(#"{"error":"Confirm first","code":"age_unconfirmed"}"#.utf8), retryAfterHeader: nil)
        XCTAssertEqual(coded.code, "age_unconfirmed")
        let other = APIError.from(status: 403, body: Data(#"{"error":"No","code":"not_party"}"#.utf8), retryAfterHeader: nil)
        XCTAssertEqual(other.code, "not_party")
        XCTAssertEqual(ErrorText.message(bare, lang: .en), L10n.errorAgeBlocked(.en))
        XCTAssertEqual(ErrorText.message(coded, lang: .en), L10n.errorAgeUnconfirmed(.en))
        let teens = APIError.from(status: 403, body: Data(#"{"error":"x","code":"not_for_teens"}"#.utf8), retryAfterHeader: nil)
        XCTAssertEqual(ErrorText.message(teens, lang: .en), L10n.errorNotForTeens(.en))
    }

    @MainActor
    func testTheConsentCardNeverShowsForAnAccountUnder18() async throws {
        StubURLProtocol.handler = { _ in StubURLProtocol.Reply(status: 200, body: Data(#"{"state":"not_asked","updatedAt":null,"policyVersion":"2026-11-14","ask":true,"sensitiveAgreed":true}"#.utf8)) }
        defer { StubURLProtocol.handler = nil }
        let api = JudgeAPI(baseURL: AppConfig.production, userAgent: "Judge-iOS/test", session: JudgeAPI.makeSession(protocolClasses: [StubURLProtocol.self]))
        let model = ConsentModel(api: api)
        await model.load()
        XCTAssertTrue(model.shows(underEighteen: false))
        XCTAssertFalse(model.shows(underEighteen: true))
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

/// The account's side: what it reports, and the step it shows.
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

    private func state(confirmed: Bool = false, blocked: Bool = false, teen: Bool = false, needsDob: Bool = false) -> [String: Any] {
        ["confirmed": confirmed, "blocked": blocked, "teen": teen, "needsDob": needsDob]
    }

    private func makeAPI(token: String?) -> (JudgeAPI, AsyncStream<String>) {
        let (stream, sink) = AsyncStream.makeStream(of: String.self)
        let api = JudgeAPI(
            baseURL: AppConfig.production,
            userAgent: "Judge-iOS/test",
            tokenStore: MemoryTokenStore(token: token),
            session: JudgeAPI.makeSession(protocolClasses: [StubURLProtocol.self]),
            ageGate: sink
        )
        return (api, stream)
    }

    /// Signed in from the start, wired as in AppModel.
    @MainActor
    private func makeAccount(_ phone: PlatformAge, token: String? = "t0k") -> (AccountModel, JudgeAPI, FakeAgeRange) {
        let (api, stream) = makeAPI(token: token)
        let fake = FakeAgeRange(phone)
        let account = AccountModel(api: api, ageRange: fake)
        account.listen(toAgeGates: stream)
        return (account, api, fake)
    }

    private func sent(_ index: Int = 0) throws -> [String: Any] {
        let body = try XCTUnwrap(router.sentBodies("POST", "/api/v1/me/age")[safe: index])
        return try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
    }

    private func day(_ year: Int, _ month: Int, _ day: Int) throws -> Date {
        try XCTUnwrap(AgeCheck.gregorian.date(from: DateComponents(year: year, month: month, day: day, hour: 12)))
    }

    @MainActor
    func testTheDateStepFollowsTheServersState() async throws {
        router.on("GET", "/api/v1/me", try me(state(needsDob: true)))
        let (account, _, _) = makeAccount(.unknown)
        await account.refresh()
        XCTAssertEqual(account.ageGate, .date)
        XCTAssertEqual(account.ageRefusal, AgeCheck.unconfirmedCode)

        router.on("GET", "/api/v1/me", try me(state(blocked: true, needsDob: true)))
        await account.refresh()
        XCTAssertEqual(account.ageGate, .date, "an old 18+ block asks for a date")

        router.on("GET", "/api/v1/me", try me(state(blocked: true)))
        await account.refresh()
        XCTAssertEqual(account.ageGate, .blocked)

        router.on("GET", "/api/v1/me", try me(state(confirmed: true)))
        await account.refresh()
        XCTAssertEqual(account.ageGate, .none)
    }

    @MainActor
    func testAConfirmedAccountStillReportsAnAdultPhone() async throws {
        router.on("GET", "/api/v1/me", try me(state(confirmed: true, teen: true)))
        router.on("POST", "/api/v1/me/age", try PremiumFixtures.json(200, state(confirmed: true)))
        let (account, _, fake) = makeAccount(.adult)
        await account.refresh()
        XCTAssertTrue(account.needsPlatformAge(onSignIn: false))
        await account.checkPlatformAge()
        XCTAssertEqual(try sent()["adult"] as? Bool, true)
        XCTAssertEqual(try sent()["source"] as? String, "platform")
        XCTAssertNil(try sent()["under13"])
        XCTAssertEqual(account.info?.age?.teen, false)
        XCTAssertEqual(account.ageGate, .none)
        await account.refresh()
        await account.checkPlatformAge()
        XCTAssertEqual(fake.calls, 1, "the phone is asked once per run")
        XCTAssertEqual(router.count("POST", "/api/v1/me/age"), 1, "and told once")
    }

    @MainActor
    func testAMinorPhoneIsOnlyReportedNeverBlockedLocally() async throws {
        router.on("GET", "/api/v1/me", try me(state(confirmed: true)))
        router.on("POST", "/api/v1/me/age", try PremiumFixtures.json(200, state(confirmed: true, teen: true)))
        let (account, _, _) = makeAccount(.minor)
        await account.refresh()
        await account.checkPlatformAge()
        XCTAssertEqual(try sent()["adult"] as? Bool, false)
        XCTAssertNil(try sent()["under13"])
        XCTAssertEqual(account.platformAge, .minor)
        XCTAssertEqual(account.ageGate, .none)
        XCTAssertTrue(account.ageCleared)
        XCTAssertTrue(account.underEighteen)
    }

    @MainActor
    func testUnder13OnThePhoneIsReportedAsSuch() async throws {
        router.on("GET", "/api/v1/me", try me(state(confirmed: true)))
        router.on("POST", "/api/v1/me/age", try PremiumFixtures.json(200, state(blocked: true)))
        let (account, _, _) = makeAccount(.under13)
        await account.refresh()
        await account.checkPlatformAge()
        XCTAssertEqual(try sent()["adult"] as? Bool, false)
        XCTAssertEqual(try sent()["under13"] as? Bool, true)
        XCTAssertEqual(account.ageGate, .blocked, "the server's answer decides")
    }

    @MainActor
    func testNothingIsSentForAnUnknownPhoneOrAFinalBlock() async throws {
        router.on("GET", "/api/v1/me", try me(state(confirmed: true)))
        let (unknown, _, _) = makeAccount(.unknown)
        await unknown.refresh()
        await unknown.checkPlatformAge()
        XCTAssertEqual(router.count("POST", "/api/v1/me/age"), 0)

        router.on("GET", "/api/v1/me", try me(state(blocked: true)))
        let (blocked, _, _) = makeAccount(.adult)
        await blocked.refresh()
        XCTAssertFalse(blocked.needsPlatformAge(onSignIn: false))
        XCTAssertEqual(router.count("POST", "/api/v1/me/age"), 0)
    }

    @MainActor
    func testAServerWithoutTheAgeCheckChangesNothing() async throws {
        router.on("GET", "/api/v1/me", try me(nil))
        let (account, _, _) = makeAccount(.minor)
        await account.refresh()
        XCTAssertEqual(router.count("POST", "/api/v1/me/age"), 0)
        XCTAssertFalse(account.needsPlatformAge(onSignIn: false))
        XCTAssertEqual(account.ageGate, .none)
    }

    @MainActor
    func testContinueWaitsUntilADayIsPicked() async throws {
        router.on("GET", "/api/v1/me", try me(state(needsDob: true)))
        let (account, _, _) = makeAccount(.unknown)
        await account.refresh()
        XCTAssertFalse(account.dobPicked)
        await account.submitDob()
        XCTAssertEqual(router.count("POST", "/api/v1/me/age"), 0)
        XCTAssertFalse(account.dobConfirming)
    }

    @MainActor
    func testAnAdultDateIsSentAsAPlainDate() async throws {
        router.on("GET", "/api/v1/me", try me(state(needsDob: true)))
        router.on("POST", "/api/v1/me/age", try PremiumFixtures.json(200, state(confirmed: true)))
        let (account, _, _) = makeAccount(.unknown)
        await account.refresh()
        account.pickDob(try day(1990, 3, 9))
        await account.submitDob()
        XCTAssertEqual(try sent()["dob"] as? String, "1990-03-09")
        XCTAssertEqual(try sent().count, 1)
        XCTAssertEqual(account.ageGate, .none)
        XCTAssertFalse(account.dobConfirming)
    }

    @MainActor
    func testATeenDateMakesATeen() async throws {
        router.on("GET", "/api/v1/me", try me(state(needsDob: true)))
        router.on("POST", "/api/v1/me/age", try PremiumFixtures.json(200, state(confirmed: true, teen: true)))
        let (account, _, _) = makeAccount(.unknown)
        await account.refresh()
        var reported: [Bool] = []
        account.onUnderEighteen = { reported.append($0) }
        account.pickDob(AgeCheck.gregorian.date(byAdding: .year, value: -15, to: Date())!)
        await account.submitDob()
        XCTAssertEqual(account.ageGate, .none)
        XCTAssertTrue(account.underEighteen)
        XCTAssertEqual(reported, [true])
    }

    @MainActor
    func testAnUnder13DateWaitsForASecondLook() async throws {
        router.on("GET", "/api/v1/me", try me(state(needsDob: true)))
        router.on("POST", "/api/v1/me/age", try PremiumFixtures.json(200, state(blocked: true)))
        let (account, _, _) = makeAccount(.unknown)
        await account.refresh()
        account.pickDob(AgeCheck.gregorian.date(byAdding: .year, value: -8, to: Date())!)
        let picked = account.dob
        await account.submitDob()
        XCTAssertTrue(account.dobConfirming)
        XCTAssertEqual(router.count("POST", "/api/v1/me/age"), 0)
        XCTAssertEqual(account.ageGate, .date)

        account.changeDob()
        XCTAssertFalse(account.dobConfirming)
        XCTAssertEqual(account.dob, picked, "the date is kept")
        await account.submitDob()
        XCTAssertTrue(account.dobConfirming)
        await account.submitDob()
        XCTAssertEqual(try sent()["dob"] as? String, picked)
        XCTAssertEqual(account.ageGate, .blocked)
        XCTAssertFalse(account.dobConfirming)
    }

    @MainActor
    func testAnOldBlockIsLiftedByADateOf13OrMore() async throws {
        router.on("GET", "/api/v1/me", try me(state(blocked: true, needsDob: true)))
        router.on("POST", "/api/v1/me/age", try PremiumFixtures.json(200, state(confirmed: true)))
        let (account, _, _) = makeAccount(.unknown)
        await account.refresh()
        XCTAssertEqual(account.ageGate, .date)
        account.pickDob(try day(1985, 6, 1))
        await account.submitDob()
        XCTAssertEqual(account.ageGate, .none)
        XCTAssertTrue(account.ageCleared)
    }

    @MainActor
    func testADateGivenElsewhereRefetchesTheAccount() async throws {
        router.on("GET", "/api/v1/me", try me(state(needsDob: true)), try me(state(confirmed: true)))
        router.on("POST", "/api/v1/me/age", try PremiumFixtures.json(409, ["error": "set", "code": "age_set"]))
        let (account, _, _) = makeAccount(.unknown)
        await account.refresh()
        account.pickDob(try day(1990, 3, 9))
        await account.submitDob()
        XCTAssertEqual(router.count("GET", "/api/v1/me"), 2)
        XCTAssertEqual(account.ageGate, .none)
        XCTAssertNil(account.ageError)
    }

    @MainActor
    func testABlockedAnswerToTheDateShowsTheRefusal() async throws {
        router.on("GET", "/api/v1/me", try me(state(needsDob: true)), try me(state(blocked: true)))
        router.on("POST", "/api/v1/me/age", try PremiumFixtures.json(403, ["error": "closed", "code": "age_blocked"]))
        let (account, _, _) = makeAccount(.unknown)
        await account.refresh()
        account.pickDob(try day(1990, 3, 9))
        await account.submitDob()
        try await PremiumFixtures.waitUntil("the refusal") { account.ageGate == .blocked }
    }

    @MainActor
    func testAFailedDateStaysOnTheStepWithTheDateKept() async throws {
        router.on("GET", "/api/v1/me", try me(state(needsDob: true)))
        let (account, _, _) = makeAccount(.unknown)
        await account.refresh()
        account.pickDob(try day(1990, 3, 9))
        await account.submitDob()
        XCTAssertEqual(account.ageError, .offline)
        XCTAssertEqual(account.ageGate, .date)
        XCTAssertEqual(account.dob, "1990-03-09")
        XCTAssertFalse(account.agePosting)
    }

    @MainActor
    func testAnUnconfirmed403OpensTheDateStep() async throws {
        router.on("GET", "/api/v1/me", try me(state(confirmed: true)), try me(state(needsDob: true)))
        router.on("GET", "/api/v1/verdicts/abc", try PremiumFixtures.json(403, ["error": "Confirm first", "code": "age_unconfirmed"]))
        let (account, api, _) = makeAccount(.unknown)
        await account.refresh()
        _ = try? await api.storedVerdict(id: "abc")
        try await PremiumFixtures.waitUntil("the date step") { account.ageGate == .date }
    }

    @MainActor
    func testABlocked403FromAnyCallOpensTheRefusal() async throws {
        router.on("GET", "/api/v1/me", try me(state(confirmed: true)), try me(state(blocked: true)))
        router.on("GET", "/api/v1/verdicts/abc", try PremiumFixtures.json(403, ["error": "age_blocked"]))
        let (account, api, _) = makeAccount(.unknown)
        await account.refresh()
        do {
            _ = try await api.storedVerdict(id: "abc")
            XCTFail("expected a 403")
        } catch let error as APIError {
            XCTAssertEqual(ErrorText.message(error, lang: .en), L10n.errorAgeBlocked(.en))
        }
        try await PremiumFixtures.waitUntil("the refusal") { account.ageGate == .blocked }
    }

    @MainActor
    func testAPhoneThatNeverAnswersTimesOutAndChangesNothing() async throws {
        router.on("GET", "/api/v1/me", try me(state(confirmed: true)))
        let (account, _, fake) = makeAccount(.adult)
        fake.hangs = true
        account.platformTimeout = .milliseconds(50)
        await account.refresh()
        XCTAssertTrue(account.ageCleared, "a waiting phone prompt holds nothing back")
        Task { await account.checkPlatformAge() }
        try await PremiumFixtures.waitUntil("the timeout") { account.platformAge == .unknown }
        XCTAssertEqual(account.ageGate, .none)
    }

    /// Email-code sign-in answering for an account that hasn't given a date.
    private func signInRoutes(me reply: StubURLProtocol.Reply) throws {
        router.on("POST", "/api/auth/email-otp/send-verification-otp", try PremiumFixtures.json(200, ["success": true]))
        router.on("POST", "/api/auth/sign-in/email-otp", try PremiumFixtures.json(200, [
            "token": "fr3sh",
            "user": ["id": "u1", "email": "ann@example.com", "name": "Ann", "image": NSNull()] as [String: Any],
        ]))
        router.on("GET", "/api/v1/me", reply)
    }

    @MainActor
    private func signIn(_ account: AccountModel) async {
        account.email = "ann@example.com"
        await account.sendCode(lang: .en)
        account.code = "123456"
        await account.verifyCode()
    }

    @MainActor
    func testThePendingVerdictWaitsForTheDate() async throws {
        try signInRoutes(me: try me(state(needsDob: true)))
        router.on("POST", "/api/v1/me/age", try PremiumFixtures.json(200, state(confirmed: true)))
        let (account, _, _) = makeAccount(.unknown, token: nil)
        var ran = 0
        account.requireSignIn { ran += 1 }
        await signIn(account)
        XCTAssertTrue(account.isSignedIn)
        account.signInDismissed()
        XCTAssertEqual(ran, 0, "the verdict would be refused as unconfirmed")
        XCTAssertEqual(account.ageGate, .date)

        account.pickDob(try day(1990, 3, 9))
        await account.submitDob()
        XCTAssertEqual(account.ageGate, .none)
        XCTAssertEqual(ran, 1, "the date lets it go")
    }

    @MainActor
    func testAnAdultPhoneIsReportedRightAfterSignIn() async throws {
        try signInRoutes(me: try me(state(needsDob: true)))
        router.on("POST", "/api/v1/me/age", try PremiumFixtures.json(200, state(needsDob: true)))
        let (account, _, _) = makeAccount(.adult, token: nil)
        await account.checkPlatformAge()
        await signIn(account)
        XCTAssertEqual(try sent()["adult"] as? Bool, true)
        XCTAssertEqual(account.ageGate, .date, "a store signal never replaces the date")
    }

    @MainActor
    func testVerdictsWaitWhileThePhoneIsBeingAsked() async throws {
        router.on("GET", "/api/v1/me", try me(state(confirmed: true)))
        let (account, _, fake) = makeAccount(.minor)
        fake.hangs = true
        account.platformTimeout = .milliseconds(200)
        await account.refresh()
        XCTAssertTrue(account.ageCleared)
        Task { await account.checkPlatformAge() }
        try await PremiumFixtures.waitUntil("the prompt") { account.platformPrompting }
        XCTAssertEqual(account.ageRefusal, AgeCheck.unconfirmedCode)
        try await PremiumFixtures.waitUntil("the timeout") { account.platformAge == .unknown }
        XCTAssertFalse(account.platformPrompting, "a prompt that never answers lets go")
        XCTAssertTrue(account.ageCleared)
    }

    @MainActor
    func testAPhoneSignalIsSentAgainOnceADateLiftsTheBlock() async throws {
        router.on("GET", "/api/v1/me", try me(state(blocked: true, needsDob: true)))
        router.on("POST", "/api/v1/me/age",
            try PremiumFixtures.json(200, state(blocked: true, needsDob: true)),
            try PremiumFixtures.json(200, state(confirmed: true)),
            try PremiumFixtures.json(200, state(confirmed: true, teen: true)))
        let (account, _, _) = makeAccount(.minor)
        await account.refresh()
        await account.checkPlatformAge()
        XCTAssertEqual(router.count("POST", "/api/v1/me/age"), 1)
        account.pickDob(try day(1990, 3, 9))
        await account.submitDob()
        XCTAssertEqual(try sent(1)["dob"] as? String, "1990-03-09")
        XCTAssertEqual(try sent(2)["adult"] as? Bool, false)
        XCTAssertTrue(account.underEighteen)
    }

    @MainActor
    func testNoUsageEventsWhileTheAgeIsUnknownOrHeldFromTheLastLaunch() async throws {
        router.on("GET", "/api/v1/me", try me(state(needsDob: true)))
        let (api, stream) = makeAPI(token: "t0k")
        let config = AppConfig(apiBaseURL: AppConfig.production, shareBaseURL: AppConfig.production, version: "1", build: "1")
        let defaults = try XCTUnwrap(UserDefaults(suiteName: "judge.tests.\(UUID().uuidString)"))
        defaults.set(true, forKey: AccountModel.statsLockedKey)
        let app = AppModel(config: config, container: HistoryContainer.inMemory(), defaults: defaults, persistsDraft: false, api: api, caseNames: MemoryCaseNamesStore())
        app.account.listen(toAgeGates: stream)
        XCTAssertFalse(app.analytics.allowed, "held until /me has answered")
        await app.account.refresh()
        XCTAssertFalse(app.analytics.allowed, "and while the date is owed")
        XCTAssertTrue(app.usageStats)
    }

    @MainActor
    func testATapDuringTheHoldRunsByItselfWhenItEnds() async throws {
        router.on("GET", "/api/v1/me", try me(state(confirmed: true)))
        let (account, _, fake) = makeAccount(.adult)
        fake.hangs = true
        account.platformTimeout = .milliseconds(200)
        await account.refresh()
        Task { await account.checkPlatformAge() }
        try await PremiumFixtures.waitUntil("the prompt") { account.platformPrompting }
        XCTAssertTrue(account.ageHolding)
        XCTAssertEqual(PurchaseModel.refusal(account.ageRefusal, holding: account.ageHolding), .checking)
        let purchases = PurchaseModel(gateway: FakePurchaseGateway(), account: account)
        await purchases.buy("pack_10")
        XCTAssertEqual(purchases.message, .checking)
        var ran = 0
        account.afterAgeClears { ran += 1 }
        XCTAssertEqual(ran, 0)
        try await PremiumFixtures.waitUntil("the hold to end") { ran == 1 }
        XCTAssertNil(purchases.message, "the note goes with the hold")
        XCTAssertFalse(account.ageHolding)
    }

    @MainActor
    func testAnUnconfirmedAccountStillHearsToConfirm() {
        XCTAssertEqual(PurchaseModel.refusal(AgeCheck.unconfirmedCode, holding: false), .ageRequired)
        XCTAssertEqual(PurchaseModel.refusal(AgeCheck.blockedCode, holding: true), .ageBlocked)
    }

    @MainActor
    func testTheSignalIsSentAgainWhenARefreshFindsTheBlockLifted() async throws {
        router.on("GET", "/api/v1/me", try me(state(blocked: true, needsDob: true)))
        router.on("POST", "/api/v1/me/age", try PremiumFixtures.json(200, state(blocked: true, needsDob: true)))
        let (account, _, _) = makeAccount(.minor)
        await account.refresh()
        await account.checkPlatformAge()
        XCTAssertEqual(router.count("POST", "/api/v1/me/age"), 1)
        // Lifted from another device.
        router.on("GET", "/api/v1/me", try me(state(confirmed: true)))
        router.on("POST", "/api/v1/me/age", try PremiumFixtures.json(200, state(confirmed: true, teen: true)))
        await account.refresh()
        XCTAssertEqual(router.count("POST", "/api/v1/me/age"), 2)
        XCTAssertTrue(account.underEighteen)
    }

    @MainActor
    func testTheDateAlreadySetElsewhereReleasesAHeldAction() async throws {
        router.on("GET", "/api/v1/me", try me(state(needsDob: true)), try me(state(confirmed: true)))
        router.on("POST", "/api/v1/me/age", try PremiumFixtures.json(409, ["error": "set", "code": "age_set"]))
        let (account, _, _) = makeAccount(.unknown)
        await account.refresh()
        var ran = 0
        account.afterAgeClears { ran += 1 }
        account.pickDob(try day(1990, 3, 9))
        await account.submitDob()
        XCTAssertEqual(ran, 1)
    }

    @MainActor
    func testTheConfirmStepStartsWithoutTheOldFailureNote() async throws {
        router.on("GET", "/api/v1/me", try me(state(needsDob: true)))
        let (account, _, _) = makeAccount(.unknown)
        await account.refresh()
        account.pickDob(try day(1990, 3, 9))
        await account.submitDob()
        XCTAssertNotNil(account.ageError)
        account.pickDob(AgeCheck.gregorian.date(byAdding: .year, value: -8, to: Date())!)
        await account.submitDob()
        XCTAssertTrue(account.dobConfirming)
        XCTAssertNil(account.ageError)
    }

    @MainActor
    func testTheUsageSettingIsKeptButOffForATeen() async throws {
        router.on("GET", "/api/v1/me", try me(state(confirmed: true, teen: true)), try me(state(confirmed: true)))
        let (api, stream) = makeAPI(token: "t0k")
        let config = AppConfig(apiBaseURL: AppConfig.production, shareBaseURL: AppConfig.production, version: "1", build: "1")
        let defaults = try XCTUnwrap(UserDefaults(suiteName: "judge.tests.\(UUID().uuidString)"))
        let app = AppModel(config: config, container: HistoryContainer.inMemory(), defaults: defaults, persistsDraft: false, api: api, caseNames: MemoryCaseNamesStore())
        app.account.listen(toAgeGates: stream)
        XCTAssertTrue(app.usageStatsOn)
        await app.account.refresh()
        XCTAssertTrue(app.usageStats, "the stored choice stays")
        XCTAssertFalse(app.usageStatsOn)
        XCTAssertFalse(app.analytics.allowed)

        await app.account.refresh()
        XCTAssertTrue(app.usageStatsOn, "it comes back at 18")
    }
}

private extension Array {
    subscript(safe index: Int) -> Element? { indices.contains(index) ? self[index] : nil }
}
