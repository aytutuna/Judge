import Foundation
import Observation

/// Sign-in state, the sign-in sheet and the account in Settings. A token in
/// the API's token store means signed in; `/api/v1/me` fills in who and
/// what plan. Getting a verdict needs an account, so Home asks here first.
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

    let api: JudgeAPI
    private let apple: any AppleAuthorizing
    private let google: any GoogleAuthorizing
    /// Off for screenshot states: no config or account fetches.
    @ObservationIgnored var usesNetwork = true
    /// Runs once the sheet closes after a successful sign-in (the verdict
    /// the user asked for).
    @ObservationIgnored private var afterSignIn: (() -> Void)?
    @ObservationIgnored private var presentTask: Task<Void, Never>?

    static let codeLength = 6

    init(api: JudgeAPI, apple: (any AppleAuthorizing)? = nil, google: (any GoogleAuthorizing)? = nil) {
        self.api = api
        self.apple = apple ?? AppleAuthorizer()
        self.google = google ?? GoogleOAuth()
        isSignedIn = api.tokenStore.token()?.isEmpty == false
    }

    var user: Viewer? { info?.user }
    var entitlement: Entitlement? { info?.entitlement }

    var signInProviders: SignInProviders? {
        if case .loaded(let value) = providers { return value }
        return nil
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
            providers = .loaded(try await api.serverConfig().signIn)
        } catch {
            if signInProviders == nil { providers = .failed }
        }
    }

    /// GET /me. A token the server no longer knows answers with no user:
    /// the session ended, so sign out here too. Network trouble keeps the
    /// token and what was shown.
    func refresh() async {
        guard isSignedIn, usesNetwork else { return }
        do {
            let fresh = try await api.me()
            guard isSignedIn else { return }
            if fresh.user == nil {
                sessionExpired()
            } else {
                info = fresh
                if failure == .loadFailed { failure = nil }
            }
        } catch let error as APIError {
            if error.code == "signin_required" {
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
        if isSignedIn { action?() }
    }

    // MARK: - Providers

    func signInWithApple() async {
        guard busy == nil else { return }
        busy = .apple
        failure = nil
        defer { busy = nil }
        do {
            let identity = try await apple.authorize()
            let session = try await api.signInWithIDToken(provider: .apple, idToken: identity.identityToken, nonce: identity.rawNonce, apple: identity)
            finishSignIn(session)
        } catch {
            failure = Self.signInFailure(error)
        }
    }

    func signInWithGoogle() async {
        guard busy == nil else { return }
        busy = .google
        failure = nil
        defer { busy = nil }
        do {
            let idToken = try await google.idToken()
            let session = try await api.signInWithIDToken(provider: .google, idToken: idToken)
            finishSignIn(session)
        } catch {
            failure = Self.signInFailure(error)
        }
    }

    // MARK: - Email code

    static func isPlausibleEmail(_ text: String) -> Bool {
        let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
        return value.range(of: #"^[^\s@]+@[^\s@]+\.[^\s@]+$"#, options: .regularExpression) != nil
    }

    var canSendCode: Bool { busy == nil && !email.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    var canVerifyCode: Bool { busy == nil && Self.digits(code).count == Self.codeLength }

    /// Keeps digits only, at most six (paste-friendly).
    static func digits(_ text: String) -> String {
        String(text.filter { $0.isASCII && $0.isNumber }.prefix(codeLength))
    }

    func sendCode(lang: AppLang) async {
        let address = email.trimmingCharacters(in: .whitespacesAndNewlines)
        guard busy == nil else { return }
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
            finishSignIn(try await api.signInWithCode(email: address, code: entered))
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

    private func finishSignIn(_ session: AuthSession) {
        api.tokenStore.setToken(session.token)
        isSignedIn = true
        info = session.user.map { AccountInfo(user: $0, entitlement: nil) }
        notice = nil
        failure = nil
        step = .choose
        code = ""
        isSignInPresented = false
        if usesNetwork {
            Task { await refresh() }
        }
    }

    /// Ends the session on the server, then forgets the token whatever the
    /// server said. On-device history stays.
    func signOut() async {
        guard isSignedIn, busy == nil else { return }
        busy = .signOut
        defer { busy = nil }
        try? await api.signOut()
        clearSession()
        notice = .signedOut
    }

    /// Deletes the account on the server. The token goes only once the
    /// server confirms; on-device history stays.
    func deleteAccount() async {
        guard isSignedIn, busy == nil else { return }
        busy = .delete
        failure = nil
        defer { busy = nil }
        do {
            try await api.deleteAccount()
            clearSession()
            notice = .deleted
        } catch let error as APIError where error.code == "signin_required" {
            sessionExpired()
        } catch {
            failure = .deleteFailed
        }
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

    private func clearSession() {
        api.tokenStore.clear()
        isSignedIn = false
        info = nil
        step = .choose
        code = ""
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
        case .malformed, .botCheck: return nil
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
    func showForScreenshot(providers: SignInProviders, info: AccountInfo? = nil, step: Step = .choose, email: String = "") {
        usesNetwork = false
        self.providers = .loaded(providers)
        if let info {
            self.info = info
            isSignedIn = true
        }
        self.step = step
        self.email = email
    }
}
#endif
