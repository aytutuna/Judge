import Security
import XCTest
@testable import Judge

@MainActor
private final class FakeApple: AppleAuthorizing {
    var result: Result<AppleIdentity, any Error>
    private(set) var calls = 0

    init(_ result: Result<AppleIdentity, any Error>) {
        self.result = result
    }

    func authorize() async throws -> AppleIdentity {
        calls += 1
        return try result.get()
    }
}

@MainActor
private final class FakeGoogle: GoogleAuthorizing {
    var result: Result<String, any Error>

    init(_ result: Result<String, any Error>) {
        self.result = result
    }

    func idToken() async throws -> String {
        try result.get()
    }
}

/// Answers by path; anything unrouted fails like a dead network.
private struct Routes: Sendable {
    var replies: [String: StubURLProtocol.Reply]

    func reply(to request: URLRequest) -> StubURLProtocol.Reply {
        let path = request.url?.path ?? ""
        return replies[path] ?? StubURLProtocol.Reply(error: URLError(.notConnectedToInternet))
    }
}

/// Sign-in, the account and sign-out against the URLProtocol stub, with the
/// Apple and Google sheets faked.
final class AccountTests: XCTestCase {
    override func setUp() {
        super.setUp()
        StubURLProtocol.handler = nil
        StubURLProtocol.requests = []
    }

    override func tearDown() {
        StubURLProtocol.handler = nil
        super.tearDown()
    }

    private static var userJSON: [String: Any] { [
        "id": "u1", "email": "ann@example.com", "name": "Ann Lee", "image": NSNull(), "emailVerified": true,
    ] }

    private static var meJSON: [String: Any] { [
        "user": ["id": "u1", "email": "ann@example.com", "name": "Ann Lee", "image": NSNull()] as [String: Any],
        "entitlement": [
            "canUsePremium": false, "blockedReason": "premium_required", "credits": 0,
            "subscription": NSNull(), "resetsAt": NSNull(),
        ] as [String: Any],
    ] }

    private func json(_ status: Int, _ object: [String: Any], headers: [String: String] = [:]) throws -> StubURLProtocol.Reply {
        var all = ["Content-Type": "application/json"]
        all.merge(headers) { _, new in new }
        return StubURLProtocol.Reply(status: status, headers: all, body: try JSONSerialization.data(withJSONObject: object))
    }

    private func route(_ replies: [String: StubURLProtocol.Reply]) {
        let routes = Routes(replies: replies)
        StubURLProtocol.handler = { routes.reply(to: $0) }
    }

    private func api(_ store: any TokenStore) -> JudgeAPI {
        JudgeAPI(
            baseURL: AppConfig.production,
            userAgent: "Judge-iOS/test",
            tokenStore: store,
            session: JudgeAPI.makeSession(protocolClasses: [StubURLProtocol.self])
        )
    }

    @MainActor
    private func model(
        _ store: any TokenStore = MemoryTokenStore(),
        apple: Result<AppleIdentity, any Error> = .failure(IdentityProviderError.cancelled),
        google: Result<String, any Error> = .failure(IdentityProviderError.cancelled)
    ) -> AccountModel {
        AccountModel(api: api(store), apple: FakeApple(apple), google: FakeGoogle(google))
    }

    private func body(_ request: URLRequest?) throws -> [String: Any] {
        try XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(request?.httpBody)) as? [String: Any])
    }

    private func request(_ path: String) -> URLRequest? {
        StubURLProtocol.requests.first { $0.url?.path == path }
    }

    // MARK: - Config

    @MainActor
    func testConfigDecidesWhichProvidersShow() async throws {
        route(["/api/v1/config": try json(200, [
            "signIn": ["apple": false, "google": true, "email": true, "emailCode": true, "dev": false],
            "premiumEnabled": false,
            "pricing": [
                "currency": "USD", "purchasesEnabled": false, "packs": [Any](),
                "monthly": ["id": "m", "priceUsd": 5, "fairUseCap": 100, "periodDays": 30] as [String: Any],
            ] as [String: Any],
            "features": ["cases": false, "evidence": false],
        ])])
        let account = model()
        XCTAssertEqual(account.providers, .loading)
        await account.loadProviders()
        XCTAssertEqual(account.signInProviders, SignInProviders(apple: false, google: true, email: true, emailCode: true))
        XCTAssertEqual(request("/api/v1/config")?.httpMethod, "GET")
        XCTAssertEqual(request("/api/v1/config")?.url?.absoluteString, "https://okjudge.com/api/v1/config")
    }

    func testMissingProviderFlagsReadAsOff() throws {
        let partial = try JSONDecoder().decode(ServerConfig.self, from: Data(#"{"signIn":{"google":true}}"#.utf8))
        XCTAssertEqual(partial.signIn, SignInProviders(google: true))
        XCTAssertTrue(partial.signIn.any)
        XCTAssertFalse(partial.premiumEnabled)

        let devOnly = try JSONDecoder().decode(ServerConfig.self, from: Data(#"{"signIn":{"dev":true,"email":true}}"#.utf8))
        XCTAssertFalse(devOnly.signIn.any, "the dev login and the web magic link are not app sign-in methods")
    }

    @MainActor
    func testConfigFailureIsReported() async {
        route([:])
        let account = model()
        await account.loadProviders()
        XCTAssertEqual(account.providers, .failed)
    }

    // MARK: - Apple

    @MainActor
    func testAppleIdentityIsExchangedAndTheTokenStored() async throws {
        route([
            "/api/auth/sign-in/social": try json(200, ["token": "sess-apple", "user": Self.userJSON], headers: ["set-auth-token": "sess-apple.sig"]),
            "/api/v1/me": try json(200, Self.meJSON),
        ])
        let store = MemoryTokenStore()
        let identity = AppleIdentity(identityToken: "apple.jwt.token", rawNonce: "r4w-n0nce", firstName: "Ann", lastName: "Lee", email: "ann@privaterelay.appleid.com")
        let account = model(store, apple: .success(identity))
        account.presentSignIn()

        await account.signInWithApple()

        XCTAssertEqual(store.token(), "sess-apple")
        XCTAssertTrue(account.isSignedIn)
        XCTAssertFalse(account.isSignInPresented)
        XCTAssertNil(account.failure)
        XCTAssertEqual(account.user?.email, "ann@example.com")

        let sent = try XCTUnwrap(request("/api/auth/sign-in/social"))
        XCTAssertEqual(sent.httpMethod, "POST")
        XCTAssertNil(sent.value(forHTTPHeaderField: "Authorization"))
        let payload = try body(sent)
        XCTAssertEqual(payload["provider"] as? String, "apple")
        let idToken = try XCTUnwrap(payload["idToken"] as? [String: Any])
        XCTAssertEqual(idToken["token"] as? String, "apple.jwt.token")
        XCTAssertEqual(idToken["nonce"] as? String, "r4w-n0nce", "the raw nonce; the request carried its hash")
        let user = try XCTUnwrap(idToken["user"] as? [String: Any])
        XCTAssertEqual(user["email"] as? String, "ann@privaterelay.appleid.com")
        XCTAssertEqual(user["name"] as? [String: String], ["firstName": "Ann", "lastName": "Lee"])
    }

    @MainActor
    func testAppleWithoutNameSendsNoUser() async throws {
        route(["/api/auth/sign-in/social": try json(200, ["token": "t", "user": Self.userJSON])])
        let account = model(apple: .success(AppleIdentity(identityToken: "jwt", rawNonce: "n")))
        await account.signInWithApple()
        let idToken = try XCTUnwrap(try body(request("/api/auth/sign-in/social"))["idToken"] as? [String: Any])
        XCTAssertNil(idToken["user"], "Apple shares name and email only on the first sign-in")
    }

    @MainActor
    func testCancellingTheAppleSheetShowsNothing() async {
        route([:])
        let store = MemoryTokenStore()
        let account = model(store, apple: .failure(IdentityProviderError.cancelled))
        await account.signInWithApple()
        XCTAssertNil(account.failure)
        XCTAssertFalse(account.isSignedIn)
        XCTAssertNil(store.token())
        XCTAssertTrue(StubURLProtocol.requests.isEmpty)
    }

    @MainActor
    func testARejectedIDTokenFailsWithoutStoringAnything() async throws {
        route(["/api/auth/sign-in/social": try json(401, ["message": "Invalid token", "code": "INVALID_TOKEN"])])
        let store = MemoryTokenStore()
        let account = model(store, apple: .success(AppleIdentity(identityToken: "jwt", rawNonce: "n")))
        await account.signInWithApple()
        XCTAssertEqual(account.failure, .signInFailed)
        XCTAssertNil(store.token())
        XCTAssertFalse(account.isSignedIn)
    }

    func testAppleNonceHashIsLowercaseHexSHA256() {
        XCTAssertEqual(AuthCrypto.sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
        let nonce = AuthCrypto.randomString()
        XCTAssertGreaterThanOrEqual(nonce.count, 43)
        XCTAssertNotEqual(nonce, AuthCrypto.randomString())
        XCTAssertNil(nonce.rangeOfCharacter(from: CharacterSet(charactersIn: "+/=")))
    }

    // MARK: - Google

    @MainActor
    func testGoogleIDTokenIsExchanged() async throws {
        route([
            "/api/auth/sign-in/social": try json(200, ["token": "sess-google", "user": Self.userJSON]),
            "/api/v1/me": try json(200, Self.meJSON),
        ])
        let store = MemoryTokenStore()
        let account = model(store, google: .success("google.id.token"))
        await account.signInWithGoogle()
        XCTAssertEqual(store.token(), "sess-google")
        XCTAssertTrue(account.isSignedIn)
        let payload = try body(request("/api/auth/sign-in/social"))
        XCTAssertEqual(payload["provider"] as? String, "google")
        let idToken = try XCTUnwrap(payload["idToken"] as? [String: Any])
        XCTAssertEqual(idToken as? [String: String], ["token": "google.id.token"])
    }

    @MainActor
    func testGoogleOfflineSaysOffline() async {
        route([:])
        let account = model(google: .failure(IdentityProviderError.network(.offline)))
        await account.signInWithGoogle()
        XCTAssertEqual(account.failure, .offline)
    }

    func testGoogleAuthorizationRequest() throws {
        let url = try XCTUnwrap(GoogleOAuthClient.authorizationURL(state: "st4te", codeChallenge: "ch4llenge"))
        let components = try XCTUnwrap(URLComponents(url: url, resolvingAgainstBaseURL: false))
        XCTAssertEqual(components.host, "accounts.google.com")
        let items = Dictionary(uniqueKeysWithValues: (components.queryItems ?? []).map { ($0.name, $0.value ?? "") })
        XCTAssertEqual(items["client_id"], "173777773521-rh4lbrotjdeufmq3rd50r924b7nn0l1r.apps.googleusercontent.com")
        XCTAssertEqual(items["redirect_uri"], "com.googleusercontent.apps.173777773521-rh4lbrotjdeufmq3rd50r924b7nn0l1r:/oauth2redirect")
        XCTAssertEqual(items["response_type"], "code")
        XCTAssertEqual(items["scope"], "openid email profile")
        XCTAssertEqual(items["code_challenge_method"], "S256")
        XCTAssertEqual(items["code_challenge"], "ch4llenge")
        XCTAssertEqual(items["state"], "st4te")

        // RFC 7636 appendix B.
        XCTAssertEqual(AuthCrypto.codeChallenge(for: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
    }

    func testGoogleCallbackParsing() throws {
        let scheme = GoogleOAuthClient.scheme
        XCTAssertEqual(try GoogleOAuthClient.code(fromCallback: XCTUnwrap(URL(string: "\(scheme):/oauth2redirect?state=s&code=4/abc")), state: "s"), "4/abc")
        XCTAssertThrowsError(try GoogleOAuthClient.code(fromCallback: XCTUnwrap(URL(string: "\(scheme):/oauth2redirect?state=other&code=x")), state: "s")) {
            XCTAssertEqual($0 as? IdentityProviderError, .failed)
        }
        XCTAssertThrowsError(try GoogleOAuthClient.code(fromCallback: XCTUnwrap(URL(string: "\(scheme):/oauth2redirect?error=access_denied&state=s")), state: "s")) {
            XCTAssertEqual($0 as? IdentityProviderError, .cancelled)
        }
    }

    func testGoogleCodeExchange() async throws {
        route(["/token": try json(200, ["access_token": "at", "id_token": "google.id.token", "expires_in": 3599, "token_type": "Bearer"])])
        let session = JudgeAPI.makeSession(protocolClasses: [StubURLProtocol.self])
        let idToken = try await GoogleOAuthClient.exchange(code: "4/0Ab+c", verifier: "v3rifier", session: session)
        XCTAssertEqual(idToken, "google.id.token")

        let sent = try XCTUnwrap(StubURLProtocol.requests.first)
        XCTAssertEqual(sent.url?.absoluteString, "https://oauth2.googleapis.com/token")
        XCTAssertEqual(sent.httpMethod, "POST")
        XCTAssertEqual(sent.value(forHTTPHeaderField: "Content-Type"), "application/x-www-form-urlencoded")
        let form = String(decoding: try XCTUnwrap(sent.httpBody), as: UTF8.self)
        var parsed = URLComponents()
        parsed.percentEncodedQuery = form
        let items = Dictionary(uniqueKeysWithValues: (parsed.queryItems ?? []).map { ($0.name, $0.value ?? "") })
        XCTAssertEqual(items["grant_type"], "authorization_code")
        XCTAssertEqual(items["code"], "4/0Ab+c")
        XCTAssertEqual(items["code_verifier"], "v3rifier")
        XCTAssertEqual(items["client_id"], GoogleOAuthClient.clientID)
        XCTAssertEqual(items["redirect_uri"], GoogleOAuthClient.redirectURI)
        XCTAssertNil(items["client_secret"])
    }

    func testGoogleCodeExchangeFailure() async throws {
        route(["/token": try json(400, ["error": "invalid_grant"])])
        let session = JudgeAPI.makeSession(protocolClasses: [StubURLProtocol.self])
        do {
            _ = try await GoogleOAuthClient.exchange(code: "c", verifier: "v", session: session)
            XCTFail("expected a failure")
        } catch {
            XCTAssertEqual(error as? IdentityProviderError, .failed)
        }
    }

    func testSessionTokenFallsBackToTheHeader() throws {
        let session = try JudgeAPI.session(from: Data(#"{"user":{"id":"u1","email":"a@b.co"}}"#.utf8), header: "t0k.sig")
        XCTAssertEqual(session.token, "t0k.sig")
        XCTAssertEqual(session.user?.id, "u1")
        XCTAssertThrowsError(try JudgeAPI.session(from: Data("{}".utf8), header: nil))
    }

    // MARK: - Email code

    @MainActor
    func testEmailCodeSignIn() async throws {
        route([
            "/api/auth/email-otp/send-verification-otp": try json(200, ["success": true]),
            "/api/auth/sign-in/email-otp": try json(200, ["token": "sess-code", "user": Self.userJSON]),
            "/api/v1/me": try json(200, Self.meJSON),
        ])
        let store = MemoryTokenStore()
        let account = model(store)
        account.email = "  Ann@Example.com "
        await account.sendCode(lang: .tr)
        XCTAssertEqual(account.step, .code(email: "Ann@Example.com"))
        XCTAssertNil(account.failure)

        let send = try XCTUnwrap(request("/api/auth/email-otp/send-verification-otp"))
        XCTAssertEqual(send.url?.query, "lang=tr")
        XCTAssertEqual(try body(send) as? [String: String], ["email": "Ann@Example.com", "type": "sign-in"])

        account.code = "12 34-56"
        XCTAssertTrue(account.canVerifyCode, "pasted codes with spaces count by their digits")
        await account.verifyCode()
        XCTAssertEqual(store.token(), "sess-code")
        XCTAssertTrue(account.isSignedIn)
        XCTAssertEqual(account.step, .choose)
        XCTAssertEqual(try body(request("/api/auth/sign-in/email-otp")) as? [String: String], ["email": "Ann@Example.com", "otp": "123456"])
    }

    @MainActor
    func testAnImplausibleEmailIsCaughtBeforeSending() async {
        route([:])
        let account = model()
        account.email = "not-an-email"
        await account.sendCode(lang: .en)
        XCTAssertEqual(account.failure, .emailInvalid)
        XCTAssertEqual(account.step, .choose)
        XCTAssertTrue(StubURLProtocol.requests.isEmpty)
    }

    @MainActor
    private func codeStep(verify reply: StubURLProtocol.Reply) async throws -> (AccountModel, MemoryTokenStore) {
        route([
            "/api/auth/email-otp/send-verification-otp": try json(200, ["success": true]),
            "/api/auth/sign-in/email-otp": reply,
        ])
        let store = MemoryTokenStore()
        let account = model(store)
        account.email = "ann@example.com"
        await account.sendCode(lang: .en)
        account.code = "000000"
        await account.verifyCode()
        return (account, store)
    }

    @MainActor
    func testWrongCode() async throws {
        let (account, store) = try await codeStep(verify: try json(400, ["message": "Invalid OTP", "code": "INVALID_OTP"]))
        XCTAssertEqual(account.failure, .codeInvalid)
        XCTAssertEqual(account.step, .code(email: "ann@example.com"), "stays on the code step to try again")
        XCTAssertNil(store.token())
        XCTAssertFalse(account.isSignedIn)
    }

    @MainActor
    func testExpiredCode() async throws {
        let (account, _) = try await codeStep(verify: try json(400, ["message": "OTP expired", "code": "OTP_EXPIRED"]))
        XCTAssertEqual(account.failure, .codeExpired)
    }

    @MainActor
    func testTooManyAttempts() async throws {
        let (account, store) = try await codeStep(verify: try json(403, ["message": "Too many attempts", "code": "TOO_MANY_ATTEMPTS"]))
        XCTAssertEqual(account.failure, .codeTooMany)
        XCTAssertNil(store.token())
    }

    @MainActor
    func testRateLimitedCode() async throws {
        let (account, _) = try await codeStep(verify: try json(429, ["message": "Too many requests. Please try again later."], headers: ["X-Retry-After": "60"]))
        XCTAssertEqual(account.failure, .rateLimited)
    }

    @MainActor
    func testRateLimitedSend() async throws {
        route(["/api/auth/email-otp/send-verification-otp": try json(429, ["message": "Too many requests. Please try again later."])])
        let account = model()
        account.email = "ann@example.com"
        await account.sendCode(lang: .en)
        XCTAssertEqual(account.failure, .rateLimited)
        XCTAssertEqual(account.step, .choose)
    }

    func testFailureMessagesAreLocalized() {
        XCTAssertEqual(AccountModel.Failure.codeInvalid.message(.en), L10n.appSigninCodeInvalid(.en))
        XCTAssertEqual(AccountModel.Failure.codeTooMany.message(.tr), L10n.appSigninCodeTooMany(.tr))
        XCTAssertEqual(AccountModel.Notice.sessionExpired.message(.en), L10n.appAccountSessionExpired(.en))
        XCTAssertFalse(L10n.appSigninRateLimited(.tr).isEmpty)
    }

    // MARK: - /me

    func testMeDecoding() throws {
        let data = try JSONSerialization.data(withJSONObject: [
            "user": ["id": "u1", "email": "ann@example.com", "name": "Ann", "image": "https://example.com/a.png"],
            "entitlement": [
                "canUsePremium": true, "blockedReason": NSNull(), "credits": 3,
                "subscription": [
                    "source": "app_store", "productId": "monthly", "periodStart": "2026-10-01T00:00:00.000Z",
                    "periodEnd": "2026-11-01T00:00:00.000Z", "willRenew": true, "used": 4, "cap": 100,
                ] as [String: Any],
                "resetsAt": NSNull(),
            ] as [String: Any],
        ] as [String: Any])
        let info = try JSONDecoder().decode(AccountInfo.self, from: data)
        XCTAssertEqual(info.user, Viewer(id: "u1", email: "ann@example.com", name: "Ann", image: "https://example.com/a.png"))
        let entitlement = try XCTUnwrap(info.entitlement)
        XCTAssertTrue(entitlement.canUsePremium)
        XCTAssertNil(entitlement.blockedReason)
        XCTAssertEqual(entitlement.credits, 3)
        XCTAssertEqual(entitlement.subscription?.periodEnd, "2026-11-01T00:00:00.000Z")
        XCTAssertEqual(entitlement.subscription?.used, 4)
        XCTAssertTrue(entitlement.isPremium)

        let signedOut = try JSONDecoder().decode(AccountInfo.self, from: Data(#"{"user":null,"entitlement":null}"#.utf8))
        XCTAssertNil(signedOut.user)
        XCTAssertNil(signedOut.entitlement)

        let free = Entitlement(credits: 0)
        XCTAssertFalse(free.isPremium)
    }

    @MainActor
    func testRefreshFillsTheAccount() async throws {
        route(["/api/v1/me": try json(200, Self.meJSON)])
        let account = model(MemoryTokenStore(token: "t0k"))
        XCTAssertTrue(account.isSignedIn)
        await account.refresh()
        XCTAssertEqual(account.user?.email, "ann@example.com")
        XCTAssertEqual(account.entitlement?.credits, 0)
        XCTAssertEqual(request("/api/v1/me")?.value(forHTTPHeaderField: "Authorization"), "Bearer t0k")
    }

    @MainActor
    func testAnUnknownTokenSignsOut() async throws {
        route(["/api/v1/me": try json(200, ["user": NSNull(), "entitlement": NSNull()])])
        let store = MemoryTokenStore(token: "stale")
        let account = model(store)
        await account.refresh()
        XCTAssertFalse(account.isSignedIn)
        XCTAssertNil(store.token())
        XCTAssertEqual(account.notice, .sessionExpired)
        XCTAssertTrue(account.isSignInPresented)
    }

    @MainActor
    func testRefreshOfflineKeepsTheSession() async {
        route([:])
        let store = MemoryTokenStore(token: "t0k")
        let account = model(store)
        await account.refresh()
        XCTAssertTrue(account.isSignedIn)
        XCTAssertEqual(store.token(), "t0k")
        XCTAssertEqual(account.failure, .loadFailed)
    }

    @MainActor
    func test401SignsOut() async throws {
        route(["/api/v1/me": try json(401, ["error": "Sign in first.", "code": "signin_required"])])
        let store = MemoryTokenStore(token: "expired")
        let account = model(store)
        await account.refresh()
        XCTAssertNil(store.token())
        XCTAssertFalse(account.isSignedIn)
        XCTAssertNil(account.user)
        XCTAssertEqual(account.notice, .sessionExpired)
        XCTAssertTrue(account.isSignInPresented)
    }

    // MARK: - Sign out and delete

    @MainActor
    func testSignOutClearsTheTokenEvenOffline() async {
        route([:])
        let store = MemoryTokenStore(token: "t0k")
        let account = model(store)
        await account.signOut()
        XCTAssertNil(store.token())
        XCTAssertFalse(account.isSignedIn)
        XCTAssertEqual(account.notice, .signedOut)
        let sent = request("/api/auth/sign-out")
        XCTAssertEqual(sent?.httpMethod, "POST")
        XCTAssertEqual(sent?.value(forHTTPHeaderField: "Authorization"), "Bearer t0k")
    }

    @MainActor
    func testSignOut() async throws {
        route(["/api/auth/sign-out": try json(200, ["success": true])])
        let store = MemoryTokenStore(token: "t0k")
        let account = model(store)
        await account.signOut()
        XCTAssertNil(store.token())
        XCTAssertEqual(account.notice, .signedOut)
    }

    @MainActor
    func testDeleteAccount() async throws {
        route(["/api/v1/me": try json(200, ["deleted": true])])
        let store = MemoryTokenStore(token: "t0k")
        let account = model(store)
        await account.deleteAccount()
        let sent = try XCTUnwrap(request("/api/v1/me"))
        XCTAssertEqual(sent.httpMethod, "DELETE")
        XCTAssertEqual(sent.value(forHTTPHeaderField: "Authorization"), "Bearer t0k")
        XCTAssertEqual(try body(sent) as? [String: String], ["confirm": "delete"])
        XCTAssertNil(store.token())
        XCTAssertFalse(account.isSignedIn)
        XCTAssertEqual(account.notice, .deleted)
        XCTAssertNil(account.failure)
    }

    @MainActor
    func testAFailedDeleteKeepsTheSession() async throws {
        route(["/api/v1/me": try json(503, ["error": "Deleting the account failed. Try again.", "code": "unavailable"])])
        let store = MemoryTokenStore(token: "t0k")
        let account = model(store)
        await account.deleteAccount()
        XCTAssertEqual(store.token(), "t0k")
        XCTAssertTrue(account.isSignedIn)
        XCTAssertEqual(account.failure, .deleteFailed)
        XCTAssertNil(account.notice)
    }

    // MARK: - Gate

    @MainActor
    func testRequireSignInRunsAtOnceWhenSignedIn() {
        let account = model(MemoryTokenStore(token: "t0k"))
        var ran = 0
        account.requireSignIn { ran += 1 }
        XCTAssertEqual(ran, 1)
        XCTAssertFalse(account.isSignInPresented)
    }

    // MARK: - Keychain

    func testKeychainRoundTrip() throws {
        let service = "com.okjudge.judge.tests.\(UUID().uuidString)"
        let store = KeychainTokenStore(service: service)
        defer { store.delete() }
        let status = store.write("k3ych41n")
        if status == errSecMissingEntitlement || status == errSecNotAvailable {
            throw XCTSkip("Keychain unavailable in this test host (status \(status))")
        }
        XCTAssertEqual(status, errSecSuccess)
        XCTAssertEqual(store.read(), "k3ych41n")
        XCTAssertEqual(KeychainTokenStore(service: service).token(), "k3ych41n", "a new store reads the saved token")

        store.setToken("r0tated")
        XCTAssertEqual(KeychainTokenStore(service: service).token(), "r0tated", "a second write replaces the first")

        store.clear()
        XCTAssertNil(store.token())
        XCTAssertNil(KeychainTokenStore(service: service).token())
    }

    func testMemoryTokenStore() {
        let store = MemoryTokenStore()
        XCTAssertNil(store.token())
        store.setToken("a")
        XCTAssertEqual(store.token(), "a")
        store.clear()
        XCTAssertNil(store.token())
    }
}
