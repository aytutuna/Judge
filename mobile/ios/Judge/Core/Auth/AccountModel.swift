import Foundation
import Observation

/// Sign-in state, the sign-in sheet and the account in Settings. A token in
/// the API's token store means signed in; `/api/v1/me` fills in who and
/// what plan. Getting a verdict needs an account, so Home asks here first.
///
/// It also runs the 18+ check: the phone's age signal when there is one,
/// else the checkbox, reported to the server once the account is known.
/// `ageGate` is what the app shows for it.
@MainActor
@Observable
final class AccountModel {
    enum ProvidersState: Equatable {
        case loading
        case loaded(SignInProviders)
        case failed
    }

    enum Step: Equatable {
        case choose
        /// The code was emailed to this address.
        case code(email: String)
    }

    enum Busy: Equatable {
        case apple, google, sendCode, verifyCode, signOut, delete
    }

    /// Something to tell the user that is not a form error.
    enum Notice: Equatable {
        case sessionExpired, signedOut, deleted
    }

    /// A failure shown on the sign-in sheet or in the account section.
    enum Failure: Equatable {
        case signInFailed
        case emailInvalid
        case codeInvalid
        case codeExpired
        case codeTooMany
        case rateLimited
        case unavailable
        case offline
        case deleteFailed
        case loadFailed
    }

    private(set) var providers: ProvidersState = .loading
    private(set) var isSignedIn: Bool
    private(set) var info: AccountInfo?
    private(set) var step: Step = .choose
    private(set) var busy: Busy?
    private(set) var failure: Failure?
    var notice: Notice?
    var email = ""
    var code = ""
    var isSignInPresented = false

    /// The phone's answer, asked at most once per run; nil until it answered.
    private(set) var platformAge: PlatformAge?
    /// The "I'm 18 or older" checkbox, on the sign-in sheet and the age sheet alike.
    private(set) var ageTicked = false
    /// A POST /api/v1/me/age is in flight.
    private(set) var agePosting = false
    /// Why the last report failed; the age sheet shows it.
    private(set) var ageError: APIError?
    /// The phone's own prompt may be on screen: the age window waits for it.
    private(set) var platformPrompting = false

    let api: JudgeAPI
    private let apple: any AppleAuthorizing
    private let google: any GoogleAuthorizing
    private let ageRange: any AgeRangeAsking
    @ObservationIgnored private var askingPlatform = false
    @ObservationIgnored private var platformTimedOut = false
    @ObservationIgnored private var ageListener: Task<Void, Never>?
    /// A report came up while another was in flight: settle again after it.
    @ObservationIgnored private var ageResettle = false
    /// The action sign-in was for, held until the age is on record.
    @ObservationIgnored private var afterAge: (() -> Void)?
    /// A phone that hasn't answered by then counts as unknown, so the
    /// checkbox can take over.
    @ObservationIgnored var platformTimeout: Duration = .seconds(10)
    /// Off for screenshot states: no config or account fetches.
    @ObservationIgnored var usesNetwork = true
    /// Runs once the sheet closes after a successful sign-in (the verdict
    /// the user asked for).
    @ObservationIgnored private var afterSignIn: (() -> Void)?
    @ObservationIgnored private var presentTask: Task<Void, Never>?

    static let codeLength = 6

    init(
        api: JudgeAPI,
        apple: (any AppleAuthorizing)? = nil,
        google: (any GoogleAuthorizing)? = nil,
        ageRange: (any AgeRangeAsking)? = nil
    ) {
        self.api = api
        self.apple = apple ?? AppleAuthorizer()
        self.google = google ?? GoogleOAuth()
        self.ageRange = ageRange ?? NoAgeRange()
        isSignedIn = api.tokenStore.token()?.isEmpty == false
    }

    var user: Viewer? { info?.user }
    var entitlement: Entitlement? { info?.entitlement }

    var signInProviders: SignInProviders? {
        if case .loaded(let value) = providers { return value }
        return nil
    }

    /// GET /api/v1/config as last loaded (premium switch, prices, features).
    private(set) var serverConfig: ServerConfig?

    var premiumEnabled: Bool { serverConfig?.premiumEnabled == true }
    var features: PremiumFeatures { serverConfig?.features ?? PremiumFeatures() }
    var pricing: PricingInfo { serverConfig?.pricing ?? .fallback }

    /// A premium answer carried the account's new balance: show it at once.
    /// Before /me has answered there is no account to put it on; /me brings it.
    func applyEntitlement(_ entitlement: Entitlement) {
        guard isSignedIn, var current = info else { return }
        current.entitlement = entitlement
        info = current
    }

    /// Told whenever the session ends: `true` when the user signed out or
    /// deleted the account (data kept for this account goes too), `false`
    /// when the server ended it.
    @ObservationIgnored var onSessionEnded: (@MainActor (_ byUser: Bool) -> Void)?

    /// Told the signed-in user's id whenever a sign-in or /me brings it
    /// (the store logs in with it).
    @ObservationIgnored var onUserKnown: (@MainActor (_ userId: String) -> Void)?

    /// Told each time GET /api/v1/config answers (usage events follow its switch).
    @ObservationIgnored var onConfig: (@MainActor (ServerConfig) -> Void)?

    /// Refetches /me in the background (after a premium outcome or a 402).
    func refreshSoon() {
        guard isSignedIn, usesNetwork else { return }
        Task { [weak self] in await self?.refresh() }
    }

    // MARK: - Startup

    /// Launch: the server's sign-in methods, then the account when signed in.
    func start() async {
        guard usesNetwork else { return }
        if signInProviders == nil { await loadProviders() }
        if isSignedIn { await refresh() }
    }

    func loadProviders() async {
        guard usesNetwork else { return }
        if signInProviders == nil { providers = .loading }
        do {
            let config = try await api.serverConfig()
            serverConfig = config
            providers = .loaded(config.signIn)
            onConfig?(config)
        } catch {
            if signInProviders == nil { providers = .failed }
        }
    }

    /// GET /me. A token the server no longer knows answers with no user:
    /// the session ended, so sign out here too. Network trouble keeps the
    /// token and what was shown. An answer about a token that has since
    /// been replaced (a new sign-in while the call was out) is ignored.
    func refresh() async {
        guard isSignedIn, usesNetwork else { return }
        let asked = api.tokenStore.token()
        do {
            let fresh = try await api.me()
            guard isSignedIn, api.tokenStore.token() == asked else { return }
            if fresh.user == nil {
                sessionExpired()
            } else {
                info = fresh
                if failure == .loadFailed { failure = nil }
                if let id = fresh.user?.id { onUserKnown?(id) }
                await settleAge()
                runAfterAgeIfCleared()
            }
        } catch let error as APIError {
            if error.code == "signin_required" {
                guard isSameSession(asked) else { return }
                sessionExpired()
            } else if info?.entitlement == nil {
                failure = .loadFailed
            }
        } catch is CancellationError {
            return
        } catch {
            if info?.entitlement == nil { failure = .loadFailed }
        }
    }

    // MARK: - Age

    var ageGate: AgeGate {
        AgeCheck.gate(platform: platformAge, signedIn: isSignedIn, age: info?.age, posting: agePosting)
    }

    var needsAgeCheckbox: Bool { AgeCheck.needsCheckbox(platform: platformAge) }

    /// Sign-in waits for the checkbox unless the phone already said 18+.
    var ageAllowsSignIn: Bool { !needsAgeCheckbox || ageTicked }

    /// Why a verdict or a purchase has to wait, or nil when nothing about
    /// age stands in the way: blocked for under 18 or a blocked account,
    /// unconfirmed while unconfirmed or while the phone's check or a report
    /// is still running. A server without the age check sends no age.
    var ageRefusal: String? {
        let age = info?.age
        if platformAge == .minor || age?.blocked == true { return AgeCheck.blockedCode }
        guard let age else { return nil }
        if askingPlatform || agePosting || !age.confirmed { return AgeCheck.unconfirmedCode }
        return nil
    }

    var ageCleared: Bool { ageRefusal == nil }

    func setAgeTicked(_ ticked: Bool) {
        ageTicked = ticked
        ageError = nil
    }

    /// Whether the phone should be asked now: not asked yet, and either the
    /// sign-in sheet is up or the signed-in account still has to confirm.
    /// A confirmed account is not asked again.
    func needsPlatformAge(onSignIn: Bool) -> Bool {
        guard platformAge == nil, !askingPlatform, usesNetwork else { return false }
        guard isSignedIn else { return onSignIn }
        guard let age = info?.age else { return false }
        return !age.confirmed && !age.blocked
    }

    func checkPlatformAge() async {
        guard platformAge == nil, !askingPlatform else { return }
        askingPlatform = true
        let wait = platformTimeout
        let timeout = Task { [weak self] in
            try? await Task.sleep(for: wait)
            guard !Task.isCancelled else { return }
            await self?.platformAnswered(.unknown, timedOut: true)
        }
        platformPrompting = true
        let answer = await ageRange.ask()
        platformPrompting = false
        timeout.cancel()
        await platformAnswered(answer, timedOut: false)
    }

    /// A late answer still counts when the wait already gave up on it.
    private func platformAnswered(_ answer: PlatformAge, timedOut: Bool) async {
        if let current = platformAge, !(platformTimedOut && current == .unknown && answer != .unknown) { return }
        askingPlatform = false
        platformTimedOut = timedOut
        platformAge = answer
        await settleAge()
        runAfterAgeIfCleared()
    }

    /// Lets go of the action sign-in was for once nothing about age stands
    /// in its way.
    private func runAfterAgeIfCleared() {
        guard ageCleared, let action = afterAge else { return }
        afterAge = nil
        action()
    }

    /// The age sheet's "Continue": confirms 18+ for the signed-in account.
    func confirmAge() async {
        guard ageTicked || platformAge == .adult else { return }
        await postAge(AgeCheck.confirmation(platform: platformAge))
    }

    /// Hears the API's 403 age errors for as long as the model lives.
    func listen(toAgeGates stream: AsyncStream<String>) {
        ageListener?.cancel()
        ageListener = Task { [weak self] in
            for await code in stream {
                await self?.ageGateHit(code)
            }
        }
    }

    /// A call was refused for the age check: the account on screen is
    /// behind, so show what the server asks for.
    func ageGateHit(_ code: String) async {
        guard isSignedIn, var current = info, current.user != nil else { return }
        var age = current.age ?? AgeStatus()
        if code == AgeCheck.blockedCode { age.blocked = true } else { age.confirmed = false }
        current.age = age
        info = current
        await settleAge()
    }

    /// Tells the server what is known: the phone's answer, or the box
    /// ticked before signing in.
    private func settleAge() async {
        guard isSignedIn, let age = info?.age,
              let report = AgeCheck.report(platform: platformAge, age: age, ticked: ageTicked)
        else { return }
        await postAge(report)
    }

    private func postAge(_ report: AgeCheck.Report) async {
        guard isSignedIn, usesNetwork else { return }
        guard !agePosting else {
            ageResettle = true
            return
        }
        await sendAge(report)
        runAfterAgeIfCleared()
        if ageResettle {
            ageResettle = false
            await settleAge()
        }
    }

    private func sendAge(_ report: AgeCheck.Report) async {
        agePosting = true
        ageError = nil
        defer { agePosting = false }
        let asked = api.tokenStore.token()
        do {
            let age = try await api.reportAge(adult: report.adult, source: report.source)
            guard isSignedIn, api.tokenStore.token() == asked, var current = info else { return }
            current.age = age
            info = current
        } catch let error as APIError {
            // A 403 age error already reached ageGateHit through the API.
            guard isSignedIn, AgeCheck.errorCode(status: Self.status(error), body: Self.body(error)) == nil else { return }
            ageError = error
        } catch {
            return
        }
    }

    private static func status(_ error: APIError) -> Int {
        if case .server(let status, _) = error { return status }
        return 0
    }

    private static func body(_ error: APIError) -> ApiErrorBody? {
        if case .server(_, let body) = error { return body }
        return nil
    }

    // MARK: - The sheet

    /// Runs `action` now when signed in; otherwise opens sign-in and runs it
    /// after a successful sign-in.
    func requireSignIn(then action: @escaping () -> Void) {
        if isSignedIn {
            action()
            return
        }
        afterSignIn = action
        presentSignIn()
    }

    func presentSignIn() {
        failure = nil
        if signInProviders == nil, usesNetwork {
            Task { await loadProviders() }
        }
        isSignInPresented = true
    }

    /// The sheet closed (signed in, or the user swiped it away).
    func signInDismissed() {
        presentTask?.cancel()
        presentTask = nil
        let action = afterSignIn
        afterSignIn = nil
        failure = nil
        if notice == .sessionExpired, isSignedIn { notice = nil }
        guard isSignedIn else { return }
        // A report that failed leaves the age sheet up; the action waits for it.
        if ageCleared { action?() } else { afterAge = action }
    }

    // MARK: - Providers

    func signInWithApple() async {
        guard busy == nil, ageAllowsSignIn else { return }
        busy = .apple
        failure = nil
        defer { busy = nil }
        do {
            let identity = try await apple.authorize()
            let session = try await api.signInWithIDToken(provider: .apple, idToken: identity.identityToken, nonce: identity.rawNonce, apple: identity)
            await finishSignIn(session)
            // Codes expire in minutes and work once: send it now. Any
            // answer or failure is ignored; the sign-in stands.
            if let code = identity.authorizationCode, !code.isEmpty {
                try? await api.storeAppleAuthorizationCode(code, token: session.token)
            }
        } catch {
            failure = Self.signInFailure(error)
        }
    }

    func signInWithGoogle() async {
        guard busy == nil, ageAllowsSignIn else { return }
        busy = .google
        failure = nil
        defer { busy = nil }
        do {
            let identity = try await google.authorize()
            let session = try await api.signInWithIDToken(provider: .google, idToken: identity.idToken, nonce: identity.rawNonce)
            await finishSignIn(session)
        } catch {
            failure = Self.signInFailure(error)
        }
    }

    // MARK: - Email code

    static func isPlausibleEmail(_ text: String) -> Bool {
        let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
        return value.range(of: #"^[^\s@]+@[^\s@]+\.[^\s@]+$"#, options: .regularExpression) != nil
    }

    var canSendCode: Bool { busy == nil && ageAllowsSignIn && !email.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    var canVerifyCode: Bool { busy == nil && Self.digits(code).count == Self.codeLength }

    /// Keeps digits only, at most six (paste-friendly).
    static func digits(_ text: String) -> String {
        String(text.filter { $0.isASCII && $0.isNumber }.prefix(codeLength))
    }

    func sendCode(lang: AppLang) async {
        let address = email.trimmingCharacters(in: .whitespacesAndNewlines)
        guard busy == nil, ageAllowsSignIn else { return }
        guard Self.isPlausibleEmail(address) else {
            failure = .emailInvalid
            return
        }
        busy = .sendCode
        failure = nil
        defer { busy = nil }
        do {
            try await api.sendSignInCode(email: address, lang: lang)
            email = address
            code = ""
            step = .code(email: address)
        } catch {
            failure = Self.sendFailure(error)
        }
    }

    func verifyCode() async {
        guard case .code(let address) = step, busy == nil else { return }
        let entered = Self.digits(code)
        guard entered.count == Self.codeLength else {
            failure = .codeInvalid
            return
        }
        busy = .verifyCode
        failure = nil
        defer { busy = nil }
        do {
            let session = try await api.signInWithCode(email: address, code: entered)
            await finishSignIn(session)
        } catch {
            failure = Self.codeFailure(error)
        }
    }

    func resendCode(lang: AppLang) async {
        guard case .code(let address) = step, busy == nil else { return }
        busy = .sendCode
        failure = nil
        defer { busy = nil }
        do {
            try await api.sendSignInCode(email: address, lang: lang)
            code = ""
        } catch {
            failure = Self.sendFailure(error)
        }
    }

    func changeEmail() {
        guard busy == nil else { return }
        step = .choose
        code = ""
        failure = nil
    }

    // MARK: - Session

    private func finishSignIn(_ session: AuthSession) async {
        api.tokenStore.setToken(session.token)
        isSignedIn = true
        info = session.user.map { AccountInfo(user: $0, entitlement: nil) }
        notice = nil
        failure = nil
        step = .choose
        code = ""
        // The verdict waiting behind sign-in needs the age on record first:
        // read the account and report the box (or the phone's 18+) before
        // the sheet closes.
        var known = false
        if usesNetwork, ageTicked || platformAge == .adult,
           let fresh = try? await api.me(), fresh.user != nil, isSignedIn {
            info = fresh
            known = true
            await settleAge()
        }
        isSignInPresented = false
        if let id = info?.user?.id ?? session.user?.id { onUserKnown?(id) }
        if usesNetwork, !known {
            Task { await refresh() }
        }
    }

    /// Ends the session on the server, then forgets the token whatever the
    /// server said. The account's verdicts leave the phone with it
    /// (`onSessionEnded`); ones no account has stay.
    func signOut() async {
        guard isSignedIn, busy == nil else { return }
        busy = .signOut
        defer { busy = nil }
        try? await api.signOut()
        clearSession(byUser: true)
        notice = .signedOut
    }

    /// Deletes the account on the server. The token goes only once the
    /// server confirms; its verdicts leave the phone as on sign-out.
    ///
    /// When the answer is lost (timeout, or the app was suspended), the
    /// server may have finished: /me without a user means it did.
    func deleteAccount() async {
        guard isSignedIn, busy == nil else { return }
        busy = .delete
        failure = nil
        defer { busy = nil }
        let asked = api.tokenStore.token()
        do {
            try await api.deleteAccount()
            guard isSameSession(asked) else { return }
            clearSession(byUser: true)
            notice = .deleted
        } catch let error as APIError where error.code == "signin_required" {
            guard isSameSession(asked) else { return }
            sessionExpired()
        } catch let error as APIError where error == .timeout || error == .interrupted {
            let check = try? await api.me()
            guard isSameSession(asked) else { return }
            if let check, check.user == nil {
                clearSession(byUser: true)
                notice = .deleted
            } else {
                failure = .deleteFailed
            }
        } catch {
            failure = .deleteFailed
        }
    }

    /// Whether the session a call was made with is still the current one:
    /// the same token, or none because that call's 401 just cleared it.
    private func isSameSession(_ asked: String?) -> Bool {
        guard isSignedIn else { return false }
        let current = api.tokenStore.token()
        return current == asked || current == nil
    }

    /// The server no longer accepts the token (a 401 or a /me without a
    /// user): sign out, say so, and offer sign-in again. `delay` lets a
    /// full-screen cover finish closing before the sheet goes up.
    func sessionExpired(presentAfter delay: Duration = .zero) {
        clearSession()
        notice = .sessionExpired
        failure = nil
        presentTask?.cancel()
        if delay == .zero {
            isSignInPresented = true
        } else {
            presentTask = Task { [weak self] in
                try? await Task.sleep(for: delay)
                guard !Task.isCancelled, let self, !self.isSignedIn else { return }
                self.isSignInPresented = true
            }
        }
    }

    private func clearSession(byUser: Bool = false) {
        api.tokenStore.clear()
        isSignedIn = false
        info = nil
        // The next person to sign in ticks the box for themselves; the
        // phone's own answer stays.
        ageTicked = false
        ageError = nil
        afterAge = nil
        failure = nil
        step = .choose
        code = ""
        onSessionEnded?(byUser)
    }

    // MARK: - Error mapping

    static func signInFailure(_ error: any Error) -> Failure? {
        if APIError.isCancellation(error) { return nil }
        if let provider = error as? IdentityProviderError {
            switch provider {
            case .cancelled: return nil
            case .failed: return .signInFailed
            case .network(let inner): return serverFailure(inner) ?? .signInFailed
            }
        }
        if let api = error as? APIError { return serverFailure(api) ?? .signInFailed }
        return .signInFailed
    }

    static func sendFailure(_ error: any Error) -> Failure? {
        if APIError.isCancellation(error) { return nil }
        guard let api = error as? APIError else { return .signInFailed }
        if case .server(let status, _) = api {
            if status == 400 { return .emailInvalid }
            if status == 404 { return .unavailable }
        }
        return serverFailure(api) ?? .signInFailed
    }

    static func codeFailure(_ error: any Error) -> Failure? {
        if APIError.isCancellation(error) { return nil }
        guard let api = error as? APIError else { return .signInFailed }
        switch api.code {
        case "INVALID_OTP": return .codeInvalid
        case "OTP_EXPIRED": return .codeExpired
        case "TOO_MANY_ATTEMPTS": return .codeTooMany
        default: break
        }
        if case .server(let status, _) = api, status == 400 { return .codeInvalid }
        return serverFailure(api) ?? .signInFailed
    }

    /// Transport, rate-limit and server-down failures shared by every call.
    private static func serverFailure(_ error: APIError) -> Failure? {
        switch error {
        case .offline, .interrupted: return .offline
        case .timeout: return .unavailable
        case .server(let status, _):
            if status == 429 || error.code == "rate_limited" { return .rateLimited }
            if status >= 500 || error.code == "unavailable" { return .unavailable }
            if status == 404 { return .unavailable }
            return nil
        case .malformed: return nil
        }
    }
}

extension AccountModel.Failure {
    func message(_ lang: AppLang) -> String {
        switch self {
        case .signInFailed: return L10n.signinFailed(lang)
        case .emailInvalid: return L10n.signinEmailInvalid(lang)
        case .codeInvalid: return L10n.appSigninCodeInvalid(lang)
        case .codeExpired: return L10n.appSigninCodeExpired(lang)
        case .codeTooMany: return L10n.appSigninCodeTooMany(lang)
        case .rateLimited: return L10n.appSigninRateLimited(lang)
        case .unavailable: return L10n.appSigninUnavailable(lang)
        case .offline: return L10n.appErrorOffline(lang)
        case .deleteFailed: return L10n.accountDeleteFailed(lang)
        case .loadFailed: return L10n.accountLoadFailed(lang)
        }
    }
}

extension AccountModel.Notice {
    func message(_ lang: AppLang) -> String {
        switch self {
        case .sessionExpired: return L10n.appAccountSessionExpired(lang)
        case .signedOut: return L10n.appAccountSignedOut(lang)
        case .deleted: return L10n.appAccountDeleted(lang)
        }
    }
}

#if DEBUG
extension AccountModel {
    /// Screenshot fixtures: a fixed state without a request.
    func showForScreenshot(
        providers: SignInProviders,
        info: AccountInfo? = nil,
        step: Step = .choose,
        email: String = "",
        config: ServerConfig? = nil
    ) {
        usesNetwork = false
        self.providers = .loaded(providers)
        if let config { serverConfig = config }
        if let info {
            self.info = info
            isSignedIn = true
        }
        self.step = step
        self.email = email
    }

    /// Tests: a loaded config and account, keeping the network on.
    func preload(config: ServerConfig?, info: AccountInfo?) {
        serverConfig = config
        if let config { providers = .loaded(config.signIn) }
        self.info = info
    }
}
#endif
