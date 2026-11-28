import XCTest
@testable import Judge

/// Deleting the account with a password or a fresh sign-in, the language
/// of the password call, and the server sync after a restore.
final class AccountSafetyTests: XCTestCase {
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

    private func me(hasPassword: Bool?) throws -> StubURLProtocol.Reply {
        var body: [String: Any] = [
            "user": ["id": "u1", "email": "ann@example.com", "name": "Ann", "image": NSNull()] as [String: Any],
            "entitlement": ["canUsePremium": false, "credits": 0] as [String: Any],
        ]
        if let hasPassword { body["hasPassword"] = hasPassword }
        return try PremiumFixtures.json(200, body)
    }

    private func error(_ status: Int, _ code: String) throws -> StubURLProtocol.Reply {
        try PremiumFixtures.json(status, ["error": "no", "code": code])
    }

    /// Signed in, with /me already read. `signedInAgo` is how long ago the
    /// session began, nil for a sign-in the app never noted.
    @MainActor
    private func signedIn(hasPassword: Bool?, signedInAgo: TimeInterval? = 60) async throws -> (AccountModel, MemoryTokenStore) {
        let defaults = try XCTUnwrap(UserDefaults(suiteName: UUID().uuidString))
        if let signedInAgo { defaults.set(Date().timeIntervalSince1970 - signedInAgo, forKey: "session.signedInAt") }
        router.on("GET", "/api/v1/me", try me(hasPassword: hasPassword))
        let store = MemoryTokenStore(token: "t0k")
        let api = JudgeAPI(
            baseURL: AppConfig.production,
            userAgent: "Judge-iOS/test",
            tokenStore: store,
            session: JudgeAPI.makeSession(protocolClasses: [StubURLProtocol.self])
        )
        let account = AccountModel(api: api, appleCodes: MemoryTokenStore(), defaults: defaults)
        await account.refresh()
        return (account, store)
    }

    private func sentBody(_ method: String, _ path: String) throws -> [String: Any] {
        let data = try XCTUnwrap(router.sentBodies(method, path).last)
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    // MARK: - Deleting

    @MainActor
    func testDeleteSendsTheReauthHeader() async throws {
        router.on("DELETE", "/api/v1/me", try PremiumFixtures.json(200, ["deleted": true]))
        let (account, store) = try await signedIn(hasPassword: false)
        XCTAssertFalse(account.deleteNeedsSignIn)
        await account.deleteAccount()
        XCTAssertEqual(router.sentHeaders("DELETE", "/api/v1/me").last?["Judge-Reauth"], "1")
        XCTAssertEqual(try sentBody("DELETE", "/api/v1/me") as? [String: String], ["confirm": "delete"])
        XCTAssertNil(store.token())
        XCTAssertEqual(account.notice, .deleted)
    }

    @MainActor
    func testDeleteSendsThePasswordWhenTheAccountHasOne() async throws {
        router.on("DELETE", "/api/v1/me", try PremiumFixtures.json(200, ["deleted": true]))
        let (account, store) = try await signedIn(hasPassword: true, signedInAgo: 3600)
        XCTAssertTrue(account.deleteNeedsPassword)
        XCTAssertFalse(account.deleteNeedsSignIn, "an old session is fine with the password")
        account.deletePassword = "correct horse"
        await account.deleteAccount()
        XCTAssertEqual(try sentBody("DELETE", "/api/v1/me") as? [String: String], ["confirm": "delete", "password": "correct horse"])
        XCTAssertNil(store.token())
        XCTAssertEqual(account.deletePassword, "")
    }

    @MainActor
    func testAPasswordAccountDeletesFreshWithoutTypingIt() async throws {
        router.on("DELETE", "/api/v1/me", try PremiumFixtures.json(200, ["deleted": true]))
        let (account, store) = try await signedIn(hasPassword: true)
        await account.deleteAccount()
        XCTAssertEqual(try sentBody("DELETE", "/api/v1/me") as? [String: String], ["confirm": "delete"])
        XCTAssertNil(store.token())
    }

    @MainActor
    func testAPasswordAccountWithAnOldSessionIsOfferedSignIn() async throws {
        router.on("DELETE", "/api/v1/me", try error(403, "reauth_required"))
        let (account, store) = try await signedIn(hasPassword: true, signedInAgo: 3600)
        XCTAssertFalse(account.deleteOffersSignIn)
        await account.deleteAccount()
        XCTAssertEqual(account.failure, .deleteReauth)
        XCTAssertTrue(account.deleteOffersSignIn)
        XCTAssertTrue(account.deleteNeedsPassword, "the password field stays")
        XCTAssertEqual(store.token(), "t0k")
    }

    @MainActor
    func testAWrongPasswordOffersSignInToo() async throws {
        router.on("DELETE", "/api/v1/me", try error(403, "password_wrong"))
        let (account, _) = try await signedIn(hasPassword: true)
        account.deletePassword = "nope"
        await account.deleteAccount()
        XCTAssertTrue(account.deleteOffersSignIn)
    }

    @MainActor
    func testAWrongPasswordKeepsTheSessionAndClearsTheField() async throws {
        router.on("DELETE", "/api/v1/me", try error(403, "password_wrong"))
        let (account, store) = try await signedIn(hasPassword: true)
        account.deletePassword = "nope"
        await account.deleteAccount()
        XCTAssertEqual(account.failure, .currentPasswordWrong)
        XCTAssertEqual(store.token(), "t0k")
        XCTAssertEqual(account.deletePassword, "")
        XCTAssertTrue(account.isSignedIn)
    }

    @MainActor
    func testTooManyTriesSaysSo() async throws {
        router.on("DELETE", "/api/v1/me", try error(429, "rate_limited"))
        let (account, _) = try await signedIn(hasPassword: true)
        account.deletePassword = "nope"
        await account.deleteAccount()
        XCTAssertEqual(account.failure, .deleteLimited)
        XCTAssertEqual(account.failure?.message(.en), L10n.accountDeleteLimited(.en))
    }

    @MainActor
    func testWithoutAPasswordAnOldSignInAsksToSignInAgain() async throws {
        let (stale, _) = try await signedIn(hasPassword: false, signedInAgo: 11 * 60)
        XCTAssertTrue(stale.deleteNeedsSignIn)
        let (unknown, _) = try await signedIn(hasPassword: false, signedInAgo: nil)
        XCTAssertTrue(unknown.deleteNeedsSignIn, "a sign-in the app never noted counts as old")
        let (fresh, _) = try await signedIn(hasPassword: false, signedInAgo: 5 * 60)
        XCTAssertFalse(fresh.deleteNeedsSignIn)
        let (withPassword, _) = try await signedIn(hasPassword: true, signedInAgo: 11 * 60)
        XCTAssertFalse(withPassword.deleteNeedsSignIn)
    }

    @MainActor
    func testTheServerRefusingAnOldSessionTurnsIntoTheSignInOffer() async throws {
        router.on("DELETE", "/api/v1/me", try error(403, "reauth_required"))
        let (account, store) = try await signedIn(hasPassword: nil)
        XCTAssertFalse(account.deleteNeedsSignIn)
        await account.deleteAccount()
        XCTAssertEqual(account.failure, .deleteReauth)
        XCTAssertEqual(account.failure?.message(.en), L10n.errorReauthRequired(.en))
        XCTAssertTrue(account.deleteNeedsSignIn)
        XCTAssertEqual(store.token(), "t0k")
    }

    @MainActor
    func testSigningInAgainEndsTheSessionWithoutWipingThePhone() async throws {
        router.on("POST", "/api/auth/sign-out", try PremiumFixtures.json(200, ["success": true]))
        let (account, store) = try await signedIn(hasPassword: false, signedInAgo: 3600)
        var endedByUser: Bool?
        account.onSessionEnded = { endedByUser = $0 }
        await account.signInAgainToDelete()
        XCTAssertEqual(router.count("POST", "/api/auth/sign-out"), 1)
        XCTAssertNil(store.token())
        XCTAssertFalse(account.isSignedIn)
        XCTAssertTrue(account.isSignInPresented)
        XCTAssertEqual(endedByUser, false)
    }

    // MARK: - Password language

    @MainActor
    func testThePasswordCallCarriesTheInAppLanguage() async throws {
        router.on("POST", "/api/v1/me/password", try PremiumFixtures.json(200, ["ok": true]))
        let (account, _) = try await signedIn(hasPassword: false)
        account.language = { .tr }
        account.password = "long enough"
        await account.saveChosenPassword()
        let sent = try XCTUnwrap(StubURLProtocol.requests.first { $0.url?.path == "/api/v1/me/password" })
        let query = URLComponents(url: try XCTUnwrap(sent.url), resolvingAgainstBaseURL: false)?.queryItems
        XCTAssertEqual(query?.first { $0.name == "lang" }?.value, "tr")
    }

    // MARK: - Restore

    @MainActor
    func testRestoreAsksTheServerToSyncAndShowsItsBalance() async throws {
        router.on("POST", "/api/v1/me/purchases/sync", try PremiumFixtures.json(200, [
            "synced": 1,
            "entitlement": ["canUsePremium": true, "credits": 10] as [String: Any],
        ]))
        let (account, _) = try await signedIn(hasPassword: true)
        let gateway = FakePurchaseGateway()
        gateway.restoreAnswer = .success(false)
        let purchases = PurchaseModel(gateway: gateway, account: account)
        await purchases.restore()
        XCTAssertEqual(router.count("POST", "/api/v1/me/purchases/sync"), 1)
        XCTAssertEqual(gateway.restores, 1)
        XCTAssertEqual(purchases.restoreResult, .done, "the server added a plan the store did not report")
    }

    @MainActor
    func testRestoreStaysQuietWhenTheServerHasNoSync() async throws {
        router.on("POST", "/api/v1/me/purchases/sync", try error(503, "not_configured"))
        let (account, _) = try await signedIn(hasPassword: true)
        let gateway = FakePurchaseGateway()
        let purchases = PurchaseModel(gateway: gateway, account: account)
        await purchases.restore()
        XCTAssertEqual(router.count("POST", "/api/v1/me/purchases/sync"), 1)
        XCTAssertEqual(purchases.restoreResult, .done)

        gateway.restoreAnswer = .success(false)
        await purchases.restore()
        XCTAssertEqual(purchases.restoreResult, .nothing)
    }
}
