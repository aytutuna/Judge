import XCTest
@testable import Judge

/// Decoding, gates and the region and parent flows of the age check.
final class ParentConsentTests: XCTestCase {
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

    private func decode(_ json: String) throws -> AgeStatus {
        try JSONDecoder().decode(AgeStatus.self, from: Data(json.utf8))
    }

    private func me(_ age: [String: Any]) throws -> StubURLProtocol.Reply {
        try PremiumFixtures.json(200, [
            "user": ["id": "u1", "email": "ann@example.com", "name": "Ann", "image": NSNull()] as [String: Any],
            "entitlement": ["canUsePremium": false, "credits": 0] as [String: Any],
            "age": age,
        ])
    }

    private func state(
        confirmed: Bool = true, blocked: Bool = false, teen: Bool = false, needsDob: Bool = false,
        restricted: Bool? = nil, parent: String? = nil
    ) -> [String: Any] {
        var age: [String: Any] = ["confirmed": confirmed, "blocked": blocked, "teen": teen, "needsDob": needsDob]
        if let restricted { age["restricted"] = restricted }
        if let parent { age["parent"] = parent }
        return age
    }

    private func parentJSON(
        status: String = "pending", sent: Bool = true, expired: Bool = false, resends: Int = 3, changes: Int = 3,
        resendAt: String? = nil
    ) -> [String: Any] {
        [
            "status": status, "sent": sent, "emailHint": sent ? "m***@example.com" : NSNull(),
            "expiresAt": sent ? "2026-12-12T10:00:00.000Z" : NSNull(), "expired": expired,
            "resendsLeft": resends, "changesLeft": changes, "resendAt": resendAt ?? NSNull(),
            "deleteAt": "2026-12-28T10:00:00.000Z",
        ]
    }

    @MainActor
    private func makeAccount(storeCountry: String? = nil, token: String? = "t0k") -> (AccountModel, JudgeAPI) {
        let (stream, sink) = AsyncStream.makeStream(of: String.self)
        let api = JudgeAPI(
            baseURL: AppConfig.production,
            userAgent: "Judge-iOS/test",
            tokenStore: MemoryTokenStore(token: token),
            session: JudgeAPI.makeSession(protocolClasses: [StubURLProtocol.self]),
            ageGate: sink
        )
        let account = AccountModel(api: api, storeCountry: { storeCountry })
        account.listen(toAgeGates: stream)
        return (account, api)
    }

    private func sent(_ method: String, _ path: String, _ index: Int = 0) throws -> [String: Any] {
        let bodies = router.sentBodies(method, path)
        let body = try XCTUnwrap(bodies.indices.contains(index) ? bodies[index] : nil)
        return try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
    }

    private func day(_ year: Int, _ month: Int, _ day: Int) throws -> Date {
        try XCTUnwrap(AgeCheck.gregorian.date(from: DateComponents(year: year, month: month, day: day, hour: 12)))
    }

    private func yearsAgo(_ years: Int) throws -> Date {
        try XCTUnwrap(AgeCheck.gregorian.date(byAdding: .year, value: -years, to: Date()))
    }

    // MARK: - Decoding and gates

    func testTheNewFieldsDecodeAndAreAbsentFromAnOlderServer() throws {
        XCTAssertEqual(try decode(#"{"confirmed":true,"blocked":false,"teen":true,"needsDob":false,"restricted":true}"#),
                       AgeStatus(confirmed: true, teen: true, restricted: true))
        XCTAssertEqual(try decode(#"{"confirmed":true,"parent":"pending"}"#).parent, .pending)
        XCTAssertEqual(try decode(#"{"parent":"declined"}"#).parent, .declined)
        XCTAssertEqual(try decode(#"{"parent":"revoked"}"#).parent, .revoked)
        let old = try decode(#"{"confirmed":true,"blocked":false,"teen":false,"needsDob":false}"#)
        XCTAssertFalse(old.restricted)
        XCTAssertNil(old.parent)
        // A word this build doesn't know reads as no parent state.
        XCTAssertNil(try decode(#"{"parent":"later"}"#).parent)
        let info = try JSONDecoder().decode(AccountInfo.self, from: Data(#"{"user":null,"entitlement":null,"age":{"parent":"pending"}}"#.utf8))
        XCTAssertEqual(info.age?.parent, .pending)
    }

    func testEachStateOpensItsScreenAndBlockedWins() {
        XCTAssertEqual(AgeCheck.gate(signedIn: true, age: AgeStatus(restricted: true)), .restricted)
        for parent in [ParentState.pending, .declined, .revoked] {
            XCTAssertEqual(AgeCheck.gate(signedIn: true, age: AgeStatus(parent: parent)), .parent)
        }
        XCTAssertEqual(AgeCheck.gate(signedIn: true, age: AgeStatus(blocked: true, restricted: true, parent: .pending)), .blocked)
        XCTAssertEqual(AgeCheck.gate(signedIn: true, age: AgeStatus(restricted: true, parent: .pending)), .restricted)
        XCTAssertEqual(AgeCheck.gate(signedIn: false, age: AgeStatus(restricted: true)), .none)
        XCTAssertEqual(AgeCheck.gate(signedIn: true, age: AgeStatus(confirmed: true)), .none)
    }

    func testTheParentViewDecodesWithItsNulls() throws {
        let data = try JSONSerialization.data(withJSONObject: parentJSON(sent: false))
        let view = try JSONDecoder().decode(ParentView.self, from: data)
        XCTAssertEqual(view.status, "pending")
        XCTAssertFalse(view.sent)
        XCTAssertNil(view.emailHint)
        XCTAssertEqual(view.resendsLeft, 3)
        XCTAssertEqual(view.deleteAt, "2026-12-28T10:00:00.000Z")
    }

    // MARK: - The parent screen

    private func view(_ json: [String: Any]) throws -> ParentView {
        try JSONDecoder().decode(ParentView.self, from: JSONSerialization.data(withJSONObject: json))
    }

    @MainActor
    func testTheParentScreenFollowsTheState() throws {
        let notSent = try view(parentJSON(sent: false))
        let sentView = try view(parentJSON())
        XCTAssertEqual(ParentModel.screen(state: .pending, view: nil, changing: false), .loading)
        XCTAssertEqual(ParentModel.screen(state: .pending, view: notSent, changing: false), .form)
        XCTAssertEqual(ParentModel.screen(state: .pending, view: sentView, changing: false), .waiting)
        XCTAssertEqual(ParentModel.screen(state: .pending, view: sentView, changing: true), .form, "typing another address")
        XCTAssertEqual(ParentModel.screen(state: .declined, view: sentView, changing: false), .declined)
        XCTAssertEqual(ParentModel.screen(state: .declined, view: nil, changing: false), .declined)
        // Asking again after a yes was taken back.
        XCTAssertEqual(ParentModel.screen(state: .revoked, view: sentView, changing: false), .revoked)
    }

    func testResendAndChangeAreOffWhenNoTriesAreLeft() throws {
        let now = ErrorText.parseISO("2026-11-28T12:00:00Z")!
        XCTAssertTrue(try view(parentJSON()).canResend(now: now))
        XCTAssertFalse(try view(parentJSON(resends: 0)).canResend(now: now))
        XCTAssertFalse(try view(parentJSON(changes: 0)).canChange)
        XCTAssertTrue(try view(parentJSON()).canChange)
        // The hour since the last mail is not over yet, then it is.
        let waiting = try view(parentJSON(resendAt: "2026-11-28T12:30:00Z"))
        XCTAssertFalse(waiting.canResend(now: now))
        XCTAssertTrue(waiting.canResend(now: now.addingTimeInterval(31 * 60)))
        XCTAssertTrue(try view(parentJSON(expired: true)).expired)
    }

    @MainActor
    func testGivingAnAddressSendsItAndReadsTheAccountAgain() async throws {
        router.on("GET", "/api/v1/me", try me(state(parent: "pending")), try me(state(parent: "pending")))
        router.on("POST", "/api/v1/me/parent", try PremiumFixtures.json(200, parentJSON()))
        let (account, _) = makeAccount()
        await account.refresh()
        XCTAssertEqual(account.ageGate, .parent)
        account.parent.email = "  mum@example.com "
        await account.parent.send()
        XCTAssertEqual(try sent("POST", "/api/v1/me/parent")["email"] as? String, "mum@example.com")
        XCTAssertEqual(account.parent.view?.emailHint, "m***@example.com")
        XCTAssertEqual(account.parent.email, "")
        XCTAssertEqual(router.count("GET", "/api/v1/me"), 2)
    }

    @MainActor
    func testResendAndChange() async throws {
        router.on("GET", "/api/v1/me", try me(state(parent: "pending")))
        router.on("POST", "/api/v1/me/parent/resend", try PremiumFixtures.json(200, parentJSON(resends: 2)))
        router.on("POST", "/api/v1/me/parent", try PremiumFixtures.json(200, parentJSON(changes: 2)))
        let (account, _) = makeAccount()
        await account.refresh()
        await account.parent.resend()
        XCTAssertEqual(router.count("POST", "/api/v1/me/parent/resend"), 1)
        XCTAssertEqual(try sent("POST", "/api/v1/me/parent/resend").count, 0, "an empty object")
        XCTAssertEqual(account.parent.view?.resendsLeft, 2)
        account.parent.startChange()
        XCTAssertTrue(account.parent.changing)
        account.parent.cancelChange()
        XCTAssertFalse(account.parent.changing)
        account.parent.startChange()
        account.parent.email = "dad@example.com"
        await account.parent.send()
        XCTAssertFalse(account.parent.changing)
        XCTAssertEqual(account.parent.view?.changesLeft, 2)
    }

    @MainActor
    func testParentErrorsShowTheirOwnTextAndConflictsReload() async throws {
        router.on("GET", "/api/v1/me", try me(state(parent: "pending")))
        router.on("GET", "/api/v1/me/parent", try PremiumFixtures.json(200, parentJSON(changes: 1)))
        let (account, _) = makeAccount()
        await account.refresh()
        let cases: [(Int, String, String)] = [
            (400, "parent_email", L10n.errorParentEmail(.en)),
            (409, "parent_limit", L10n.errorParentLimit(.en)),
            (429, "parent_wait", L10n.errorParentWait(.en)),
        ]
        for (status, code, text) in cases {
            router.on("POST", "/api/v1/me/parent", try PremiumFixtures.json(status, ["error": "x", "code": code, "retryAfterSec": 600]))
            account.parent.email = "mum@example.com"
            await account.parent.send()
            let error = try XCTUnwrap(account.parent.error)
            XCTAssertEqual(ErrorText.message(error, lang: .en), text, code)
        }
        XCTAssertEqual(router.count("GET", "/api/v1/me/parent"), 0)
        router.on("POST", "/api/v1/me/parent", try PremiumFixtures.json(409, ["error": "x", "code": "parent_conflict"]))
        await account.parent.send()
        XCTAssertEqual(ErrorText.message(try XCTUnwrap(account.parent.error), lang: .en), L10n.errorParentConflict(.en))
        XCTAssertEqual(router.count("GET", "/api/v1/me/parent"), 1, "the request is read again")
        XCTAssertEqual(account.parent.view?.changesLeft, 1)
        XCTAssertEqual(ErrorText.message(.server(status: 409, body: ApiErrorBody(code: "parent_declined")), lang: .en), L10n.errorParentDeclined(.en))
    }

    @MainActor
    func testTheYesOpensTheAppOnTheNextRead() async throws {
        router.on("GET", "/api/v1/me", try me(state(parent: "pending")), try me(state()))
        let (account, _) = makeAccount()
        await account.refresh()
        XCTAssertEqual(account.ageGate, .parent)
        XCTAssertTrue(account.underEighteen)
        XCTAssertEqual(account.ageRefusal, AgeCheck.parentPendingCode)
        await account.refresh()
        XCTAssertEqual(account.ageGate, .none)
        XCTAssertNil(account.ageRefusal)
    }

    // MARK: - The Brazil refusal

    @MainActor
    func testARestrictedAccountIsRefusedUntilTheServerLiftsIt() async throws {
        router.on("GET", "/api/v1/me", try me(state(teen: true, restricted: true)), try me(state(teen: true)))
        let (account, _) = makeAccount()
        await account.refresh()
        XCTAssertEqual(account.ageGate, .restricted)
        XCTAssertEqual(account.ageRefusal, AgeCheck.regionCode)
        XCTAssertEqual(PurchaseModel.refusal(account.ageRefusal), .ageRegion)
        await account.refresh()
        XCTAssertEqual(account.ageGate, .none)
    }

    // MARK: - Any route

    @MainActor
    func testAParentPending403FromAnyRouteOpensTheParentScreen() async throws {
        router.on("GET", "/api/v1/me", try me(state()), try me(state(parent: "pending")))
        router.on("GET", "/api/v1/verdicts/abc", try PremiumFixtures.json(403, ["error": "A parent has to say yes first.", "code": "age_parent_pending"]))
        let (account, api) = makeAccount()
        await account.refresh()
        do {
            _ = try await api.storedVerdict(id: "abc")
            XCTFail("expected a 403")
        } catch let error as APIError {
            XCTAssertEqual(ErrorText.message(error, lang: .en), L10n.errorAgeParentPending(.en))
        }
        try await PremiumFixtures.waitUntil("the parent screen") { account.ageGate == .parent }
    }

    @MainActor
    func testAnAgeRegion403FromAnyRouteOpensTheRefusal() async throws {
        router.on("GET", "/api/v1/me", try me(state()), try me(state(restricted: true)))
        router.on("GET", "/api/v1/verdicts/abc", try PremiumFixtures.json(403, ["error": "closed", "code": "age_region"]))
        let (account, api) = makeAccount()
        await account.refresh()
        do {
            _ = try await api.storedVerdict(id: "abc")
            XCTFail("expected a 403")
        } catch let error as APIError {
            XCTAssertEqual(ErrorText.message(error, lang: .en), L10n.errorAgeRegion(.en))
        }
        try await PremiumFixtures.waitUntil("the refusal") { account.ageGate == .restricted }
    }

    // MARK: - The date step

    func testWhichQuestionsADateAsks() {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        let now = calendar.date(from: DateComponents(year: 2026, month: 11, day: 28, hour: 12))!
        // 12: the confirm step, nothing more.
        XCTAssertFalse(AgeCheck.asksCountry(dob: "2014-06-01", now: now))
        XCTAssertTrue(AgeCheck.asksCountry(dob: "2013-06-01", now: now))
        XCTAssertTrue(AgeCheck.asksCountry(dob: "2011-12-01", now: now), "14 and 15 year olds are asked where too")
        XCTAssertFalse(AgeCheck.asksCountry(dob: "2010-11-28", now: now), "16 and over are asked nothing")
        XCTAssertFalse(AgeCheck.asksCountry(dob: "2008-01-01", now: now))
        XCTAssertFalse(AgeCheck.asksCountry(dob: "1990-01-01", now: now))
        // Quebec: only a 13 year old, only in Canada.
        XCTAssertTrue(AgeCheck.asksQuebec(dob: "2013-06-01", country: "CA", now: now))
        XCTAssertFalse(AgeCheck.asksQuebec(dob: "2013-06-01", country: "DE", now: now))
        XCTAssertFalse(AgeCheck.asksQuebec(dob: "2013-06-01", country: nil, now: now))
        XCTAssertFalse(AgeCheck.asksQuebec(dob: "2012-06-01", country: "CA", now: now))
    }

    @MainActor
    func testAThirteenYearOldInCanadaNeedsBothAnswers() async throws {
        router.on("GET", "/api/v1/me", try me(state(confirmed: false, needsDob: true)))
        router.on("POST", "/api/v1/me/age", try PremiumFixtures.json(200, state(teen: true, parent: "pending")))
        let (account, _) = makeAccount(storeCountry: "CA")
        await account.refresh()
        account.pickDob(try yearsAgo(13).addingTimeInterval(-86400 * 20))
        XCTAssertTrue(account.asksCountry)
        XCTAssertFalse(account.canSubmitDob)
        await account.submitDob()
        XCTAssertEqual(router.count("POST", "/api/v1/me/age"), 0)
        account.pickCountry("CA")
        XCTAssertTrue(account.asksQuebec)
        XCTAssertFalse(account.canSubmitDob)
        account.pickQuebec(true)
        XCTAssertTrue(account.canSubmitDob)
        await account.submitDob()
        let body = try sent("POST", "/api/v1/me/age")
        XCTAssertEqual(body["country"] as? String, "CA")
        XCTAssertEqual(body["quebec"] as? Bool, true)
        XCTAssertEqual(body["storeCountry"] as? String, "CA")
        XCTAssertNotNil(body["dob"] as? String)
        XCTAssertEqual(account.ageGate, .parent, "the first answer can already hold the account")
    }

    @MainActor
    func testAFourteenYearOldIsAskedWhereButNotAboutQuebec() async throws {
        router.on("GET", "/api/v1/me", try me(state(confirmed: false, needsDob: true)))
        router.on("POST", "/api/v1/me/age", try PremiumFixtures.json(200, state(teen: true)))
        let (account, _) = makeAccount(storeCountry: "DE")
        await account.refresh()
        account.pickDob(try yearsAgo(14).addingTimeInterval(-86400 * 20))
        XCTAssertTrue(account.asksCountry)
        XCTAssertFalse(account.asksQuebec)
        account.pickCountry("CA")
        XCTAssertFalse(account.asksQuebec)
        account.pickCountry("FR")
        await account.submitDob()
        let body = try sent("POST", "/api/v1/me/age")
        XCTAssertEqual(body["country"] as? String, "FR")
        XCTAssertNil(body["quebec"])
        XCTAssertEqual(body["storeCountry"] as? String, "DE")
        XCTAssertEqual(account.ageGate, .none)
    }

    @MainActor
    func testSixteenAndOverSendOnlyTheDateAndTheStoreCountry() async throws {
        router.on("GET", "/api/v1/me", try me(state(confirmed: false, needsDob: true)))
        router.on("POST", "/api/v1/me/age", try PremiumFixtures.json(200, state(teen: true)))
        let (account, _) = makeAccount(storeCountry: "GB")
        await account.refresh()
        // An answer given for a younger date doesn't ride along.
        account.pickDob(try yearsAgo(14).addingTimeInterval(-86400 * 20))
        account.pickCountry("CA")
        account.pickQuebec(false)
        account.pickDob(try day(2009, 1, 15))
        XCTAssertFalse(account.asksCountry)
        XCTAssertTrue(account.canSubmitDob)
        await account.submitDob()
        let body = try sent("POST", "/api/v1/me/age")
        XCTAssertEqual(Set(body.keys), ["dob", "storeCountry"])
        XCTAssertEqual(body["dob"] as? String, "2009-01-15")
    }

    @MainActor
    func testAnAdultWithNoStoreCountrySendsJustTheDate() async throws {
        router.on("GET", "/api/v1/me", try me(state(confirmed: false, needsDob: true)))
        router.on("POST", "/api/v1/me/age", try PremiumFixtures.json(200, state()))
        let (account, _) = makeAccount()
        await account.refresh()
        account.pickDob(try day(1990, 3, 9))
        await account.submitDob()
        XCTAssertEqual(Set(try sent("POST", "/api/v1/me/age").keys), ["dob"])
    }

    @MainActor
    func testTheIPGuessFillsTheQuestionsOnce() async throws {
        router.on("GET", "/api/v1/me", try me(state(confirmed: false, needsDob: true)))
        router.on("GET", "/api/v1/me/age", try PremiumFixtures.json(200, ["country": "CA", "quebec": true]))
        let (account, _) = makeAccount()
        await account.refresh()
        await account.loadAgeHint()
        XCTAssertEqual(account.dobCountry, "CA")
        XCTAssertEqual(account.dobQuebec, true)
        await account.loadAgeHint()
        XCTAssertEqual(router.count("GET", "/api/v1/me/age"), 1)

        // The store's country is the first guess, and Quebec only follows the IP's own.
        let (other, _) = makeAccount(storeCountry: "DE")
        await other.refresh()
        await other.loadAgeHint()
        XCTAssertEqual(other.dobCountry, "DE")
        XCTAssertNil(other.dobQuebec)
    }

    // MARK: - The store country

    @MainActor
    func testTheStoreCountryIsSentOnceOnLaunchForAnAccountWithADate() async throws {
        router.on("GET", "/api/v1/me", try me(state()))
        router.on("POST", "/api/v1/me/age", try PremiumFixtures.json(200, state(teen: true, parent: "pending")))
        let (account, _) = makeAccount(storeCountry: "DE")
        await account.refresh()
        XCTAssertEqual(try sent("POST", "/api/v1/me/age") as? [String: String], ["storeCountry": "DE"])
        XCTAssertEqual(account.ageGate, .parent, "the answer can only tighten")
        await account.refresh()
        XCTAssertEqual(router.count("POST", "/api/v1/me/age"), 1)
    }

    @MainActor
    func testNoStoreCountryIsSentWithoutADateOrWithoutACountry() async throws {
        router.on("GET", "/api/v1/me", try me(state(confirmed: false, needsDob: true)))
        let (owing, _) = makeAccount(storeCountry: "DE")
        await owing.refresh()
        XCTAssertEqual(router.count("POST", "/api/v1/me/age"), 0)

        router.on("GET", "/api/v1/me", try me(state()))
        let (unknown, _) = makeAccount(storeCountry: nil)
        await unknown.refresh()
        XCTAssertEqual(router.count("POST", "/api/v1/me/age"), 0)
    }

    @MainActor
    func testAFailedStoreCountryIsTriedAgainOnTheNextRead() async throws {
        router.on("GET", "/api/v1/me", try me(state()))
        let (account, _) = makeAccount(storeCountry: "DE")
        await account.refresh()
        XCTAssertEqual(router.count("POST", "/api/v1/me/age"), 1)
        router.on("POST", "/api/v1/me/age", try PremiumFixtures.json(200, state(restricted: true)))
        await account.refresh()
        XCTAssertEqual(router.count("POST", "/api/v1/me/age"), 2)
        XCTAssertEqual(account.ageGate, .restricted)
    }

    func testStoreCountriesComeAsTwoLetters() {
        XCTAssertEqual(Countries.alpha2(fromAlpha3: "GBR"), "GB")
        XCTAssertEqual(Countries.alpha2(fromAlpha3: "deu"), "DE")
        XCTAssertEqual(Countries.alpha2(fromAlpha3: "USA"), "US")
        XCTAssertEqual(Countries.alpha2(fromAlpha3: "BRA"), "BR")
        XCTAssertEqual(Countries.alpha2(fromAlpha3: "CAN"), "CA")
        XCTAssertEqual(Countries.alpha2(fromAlpha3: "XKS"), "XK")
        XCTAssertNil(Countries.alpha2(fromAlpha3: "ZZZ"))
        XCTAssertEqual(Countries.codes.count, Set(Countries.codes).count)
        XCTAssertTrue(Countries.codes.contains("CA"))
        XCTAssertTrue(Countries.codes.allSatisfy { $0.count == 2 })
    }

    func testCountryNamesFollowTheLanguageAndSort() {
        let english = Countries.options(lang: .en)
        XCTAssertEqual(english.first { $0.code == "DE" }?.name, "Germany")
        XCTAssertEqual(Countries.options(lang: .tr).first { $0.code == "DE" }?.name, "Almanya")
        XCTAssertEqual(english.map(\.name), english.map(\.name).sorted { $0.compare($1, locale: AppLang.en.locale) == .orderedAscending })
    }
}
