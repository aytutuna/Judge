import Foundation
import Observation

/// Sign-in state, the sign-in sheet and the account in Settings. A token in
/// the API's token store means signed in; `/api/v1/me` fills in who and
/// what plan. Getting a verdict needs an account, so Home asks here first.
///
/// It also runs the age check: the date of birth the account still owes,
/// and the phone's age signal, reported to the server once the account is
/// known. The server decides; `ageGate` is what the app shows for it.
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
        /// The address is known: sign in with its password, or make one.
        case password
        /// The code was emailed to this address.
        case code(email: String)
        /// Signed in by the code and choosing a password; there is no way past it.
        case choosePassword
    }

    /// What the email area is doing: sign in with a password, make an
    /// account (password first, then the code), reset a password (code
    /// first, then the password) or sign in by code alone.
    enum Mode: Equatable {
        case password, create, forgot, code
    }

    /// The method of the last successful sign-in on this phone, for the "Last used" tag.
    enum LastMethod: String {
        case apple, google, email
    }

    enum Busy: Equatable {
        case apple, google, sendCode, verifyCode, password, signOut, delete
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
        case passwordWrong
        case passwordShort
        case passwordSaveFailed
        case currentPasswordWrong
        case currentPasswordRequired
        case deleteFailed
        case deleteLimited
        /// The session is too old to delete with: sign in again first.
        case deleteReauth
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
    var mode: Mode = .password
    /// Kept in memory only, until the account has it or the sheet is left.
    var password = ""
    /// The password typed for deleting the account; memory only.
    var deletePassword = ""
    var isSignInPresented = false
    /// Seconds until another code may be asked for.
    private(set) var resendIn = 0
    private(set) var lastMethod: LastMethod?

    /// The phone's answer, asked at most once per run; nil until it answered.
    private(set) var platformAge: PlatformAge?
    /// The store says a parent must consent to a significant change for this
    /// minor. TODO: show PermissionKit's significant-update question and hold
    /// the account until it is answered, once an update has such a change.
    private(set) var parentalConsentRequired = false
    /// The day on the date step's wheels; Continue waits until one is picked.
    private(set) var dobDate = AgeCheck.defaultDobDate()
    private(set) var dobPicked = false
    /// An under-13 date waits for a second look before it is sent.
    private(set) var dobConfirming = false
    /// The date is being sent.
    private(set) var agePosting = false
    /// Why the date didn't go through; the date step shows it.
    private(set) var ageError: APIError?
    /// "Where do you live?", asked of a 13 to 15 year old, and the Quebec
    /// answer of a 13 year old in Canada. nil until answered.
    private(set) var dobCountry: String?
    private(set) var dobQuebec: Bool?
    /// The parent step of a teen whose account waits for a yes.
    let parent: ParentModel
    /// The phone's own prompt may be on screen: the age window waits for it.
    private(set) var platformPrompting = false

    let api: JudgeAPI
    private let apple: any AppleAuthorizing
    private let google: any GoogleAuthorizing
    private let ageRange: any AgeRangeAsking
    /// Apple's authorization code while the server has not confirmed it, as
    /// "<unix seconds> <code>". Kept in the Keychain like the session token.
    private let appleCodes: any TokenStore
    @ObservationIgnored private var sendingAppleCode = false
    @ObservationIgnored private var askingPlatform = false
    @ObservationIgnored private var platformTimedOut = false
    @ObservationIgnored private var ageListener: Task<Void, Never>?
    /// A report came up while another was in flight: settle again after it.
    @ObservationIgnored private var ageResettle = false
    @ObservationIgnored private var reportingPlatform = false
    /// The phone's answer last sent, so a refresh doesn't send it again.
    @ObservationIgnored private var lastReport: AgeCheck.Report?
    @ObservationIgnored private let readStoreCountry: @Sendable () async -> String?
    /// The store's country goes to the server once per launch and sign-in.
    @ObservationIgnored private var storeCountrySent = false
    @ObservationIgnored private var hintLoaded = false
    /// The language of the app, for what the server writes in it.
    @ObservationIgnored var language: () -> AppLang = { .en }
    /// Told when the account turns into (or stops being) one under 18.
    @ObservationIgnored var onUnderEighteen: (@MainActor (Bool) -> Void)?
    /// Told when nothing about age holds things back any more.
    @ObservationIgnored var onHoldEnded: (@MainActor () -> Void)?
    /// The action sign-in was for, held until the age is on record.
    @ObservationIgnored private var afterAge: (() -> Void)?
    /// A phone that hasn't answered by then counts as unknown.
    @ObservationIgnored var platformTimeout: Duration = .seconds(10)
    /// Off for screenshot states: no config or account fetches.
    @ObservationIgnored var usesNetwork = true
    /// Runs once the sheet closes after a successful sign-in (the verdict
    /// the user asked for).
    @ObservationIgnored private var afterSignIn: (() -> Void)?
    @ObservationIgnored private var presentTask: Task<Void, Never>?
    @ObservationIgnored private var countdown: Task<Void, Never>?
    /// The code the server just refused: typing it again does not send it on its own.
    @ObservationIgnored private var rejectedCode: String?
    @ObservationIgnored private let defaults: UserDefaults

    static let codeLength = 6
    static let resendSeconds = 30
    private static let lastMethodKey = "lastSignInMethod"
    private static let lastEmailKey = "lastSignInEmail"
    private static let signedInAtKey = "session.signedInAt"
    private static let askedKey = "age.askedOnInstall"
    /// The server accepts a delete without a password for 10 minutes after
    /// the sign-in; a minute less covers the clocks.
    static let freshSignIn: TimeInterval = 9 * 60

    init(
        api: JudgeAPI,
        apple: (any AppleAuthorizing)? = nil,
        google: (any GoogleAuthorizing)? = nil,
        ageRange: (any AgeRangeAsking)? = nil,
        appleCodes: (any TokenStore)? = nil,
        storeCountry: @escaping @Sendable () async -> String? = { nil },
        defaults: UserDefaults = .standard
    ) {
        self.api = api
        readStoreCountry = storeCountry
        parent = ParentModel(api: api)
        self.defaults = defaults
        lastMethod = defaults.string(forKey: Self.lastMethodKey).flatMap(LastMethod.init)
        email = defaults.string(forKey: Self.lastEmailKey) ?? ""
        self.apple = apple ?? AppleAuthorizer()
        self.google = google ?? GoogleOAuth()
        self.ageRange = ageRange ?? NoAgeRange()
        self.appleCodes = appleCodes ?? KeychainTokenStore(service: "com.okjudge.judge.apple-code", account: "pending")
        isSignedIn = api.tokenStore.token()?.isEmpty == false
        parent.onChanged = { [weak self] in await self?.refresh() }
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
        await retryAppleCode()
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
                // The server ignored the phone's signal while blocked.
                if info?.age?.blocked == true, fresh.age?.blocked != true { lastReport = nil }
                info = fresh
                ageChanged()
                if failure == .loadFailed { failure = nil }
                if let id = fresh.user?.id { onUserKnown?(id) }
                await settleAge()
                await settleStoreCountry()
                runAfterAgeIfCleared()
                await retryAppleCode()
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
        AgeCheck.gate(signedIn: isSignedIn, age: info?.age)
    }

    /// Teen accounts, and blocked, restricted or waiting ones, get the
    /// under-18 defaults.
    var underEighteen: Bool {
        guard isSignedIn, let age = info?.age else { return false }
        return age.teen || age.blocked || age.restricted || age.parent != nil
    }

    /// No usage events while the account is under 18 or its age is unknown,
    /// as on the website.
    var statsLocked: Bool {
        guard isSignedIn, let age = info?.age else { return false }
        return age.teen || age.blocked || age.restricted || age.parent != nil || age.needsDob
    }

    static let statsLockedKey = "age.statsLocked"

    private func ageChanged() {
        // Kept so the next launch holds events until /me has answered.
        defaults.set(statsLocked, forKey: Self.statsLockedKey)
        if info?.age?.parent == nil { parent.reset() }
        onUnderEighteen?(statsLocked)
    }

    /// Why a verdict or a purchase has to wait, or nil when nothing about
    /// age stands in the way. Only the server's state counts, never the
    /// phone's signal. A server without the age check sends no age.
    var ageRefusal: String? {
        guard let age = info?.age else { return nil }
        if age.blocked { return AgeCheck.blockedCode }
        if age.restricted { return AgeCheck.regionCode }
        if age.parent != nil { return AgeCheck.parentPendingCode }
        // The phone's check and its report hold things back too; nothing is
        // decided from the signal itself.
        if askingPlatform || reportingPlatform || agePosting { return AgeCheck.unconfirmedCode }
        return age.confirmed ? nil : AgeCheck.unconfirmedCode
    }

    var ageCleared: Bool { ageRefusal == nil }

    /// Only the phone's check, its report or the date post is in the way, for
    /// an account /me already says is confirmed: it passes by itself.
    var ageHolding: Bool {
        guard let age = info?.age, age.confirmed, !age.blocked, !age.restricted, age.parent == nil else { return false }
        return askingPlatform || reportingPlatform || agePosting
    }

    /// Runs `action` once nothing about age stands in the way.
    func afterAgeClears(_ action: @escaping () -> Void) {
        afterAge = action
    }

    /// Whether the phone should be asked now: not asked yet, and either the
    /// sign-in sheet is up or the signed-in account is not closed for good.
    func needsPlatformAge(onSignIn: Bool) -> Bool {
        guard platformAge == nil, !askingPlatform, usesNetwork else { return false }
        guard isSignedIn else { return onSignIn || !defaults.bool(forKey: Self.askedKey) }
        guard let age = info?.age else { return false }
        return !(age.blocked && !age.needsDob)
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
        parentalConsentRequired = ageRange.needsParentalConsent
        defaults.set(true, forKey: Self.askedKey)
        platformPrompting = false
        timeout.cancel()
        await platformAnswered(answer, timedOut: false)
    }

    /// A late answer still counts when the wait already gave up on it.
    private func platformAnswered(_ answer: PlatformAge, timedOut: Bool) async {
        if let current = platformAge, !(platformTimedOut && current == .unknown && answer != .unknown) { return }
        askingPlatform = false
        if timedOut { platformPrompting = false }
        platformTimedOut = timedOut
        platformAge = answer
        await settleAge()
        runAfterAgeIfCleared()
    }

    /// Lets go of the action sign-in was for once nothing about age stands
    /// in its way.
    private func runAfterAgeIfCleared() {
        if !askingPlatform, !reportingPlatform, !agePosting { onHoldEnded?() }
        guard ageCleared, let action = afterAge else { return }
        afterAge = nil
        action()
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
    /// behind, so show it as refused now and ask the server what it holds.
    func ageGateHit(_ code: String) async {
        guard isSignedIn, var current = info, current.user != nil else { return }
        var age = current.age ?? AgeStatus()
        switch code {
        case AgeCheck.blockedCode: age.blocked = true
        case AgeCheck.regionCode: age.restricted = true
        case AgeCheck.parentPendingCode: age.parent = age.parent ?? .pending
        default: age.confirmed = false
        }
        current.age = age
        info = current
        ageChanged()
        await refresh()
    }

    /// Tells the server what the phone said, once per launch and sign-in.
    private func settleAge() async {
        guard isSignedIn, usesNetwork else { return }
        guard !reportingPlatform else {
            ageResettle = true
            return
        }
        reportingPlatform = true
        repeat {
            ageResettle = false
            guard let report = AgeCheck.report(platform: platformAge, age: info?.age), report != lastReport else { continue }
            // Set before the call, so a refusal doesn't send it again in a loop.
            lastReport = report
            let asked = api.tokenStore.token()
            do {
                let age = try await api.reportAge(adult: report.adult, under13: report.under13)
                guard isSignedIn, api.tokenStore.token() == asked, var current = info else { continue }
                current.age = age
                info = current
                ageChanged()
            } catch let error as APIError {
                // A 403 age error already reached ageGateHit through the API.
                if AgeCheck.errorCode(status: Self.status(error), body: Self.body(error)) == nil { lastReport = nil }
            } catch {
                lastReport = nil
            }
        } while ageResettle
        reportingPlatform = false
        runAfterAgeIfCleared()
    }

    /// Tells the server the App Store's country once per launch. It can only
    /// add a rule (the parent step, the Brazil refusal), never lift one.
    private func settleStoreCountry() async {
        guard !storeCountrySent, isSignedIn, usesNetwork, let age = info?.age, !age.needsDob, !age.blocked else { return }
        storeCountrySent = true
        guard let code = await readStoreCountry() else { return }
        let asked = api.tokenStore.token()
        do {
            let fresh = try await api.reportStoreCountry(code)
            guard isSignedIn, api.tokenStore.token() == asked, var current = info else { return }
            current.age = fresh
            info = current
            ageChanged()
        } catch {
            storeCountrySent = false
        }
    }

    // MARK: - The date step

    func pickDob(_ date: Date) {
        dobDate = date
        dobPicked = true
    }

    func pickCountry(_ code: String?) {
        dobCountry = code
        if code != "CA" { dobQuebec = nil }
    }

    func pickQuebec(_ answer: Bool?) {
        dobQuebec = answer
    }

    var asksCountry: Bool { dobPicked && AgeCheck.asksCountry(dob: dob) }
    var asksQuebec: Bool { dobPicked && AgeCheck.asksQuebec(dob: dob, country: dobCountry) }

    /// Continue waits for a day and for the questions that day calls for.
    var canSubmitDob: Bool {
        dobPicked && (!asksCountry || dobCountry != nil) && (!asksQuebec || dobQuebec != nil)
    }

    /// Fills the country question with a first guess, once: the App Store's
    /// country, else where the request's IP says. The person can change it.
    func loadAgeHint() async {
        guard !hintLoaded, usesNetwork else { return }
        hintLoaded = true
        let store = await readStoreCountry()
        let hint = try? await api.ageHint()
        guard dobCountry == nil else { return }
        let guess = [store, hint?.country].compactMap { $0 }.first { Countries.codes.contains($0) }
        guard let guess else { return }
        dobCountry = guess
        if guess == hint?.country, let quebec = hint?.quebec { dobQuebec = quebec }
    }

    /// The picked day as `YYYY-MM-DD`.
    var dob: String { AgeCheck.dobString(from: dobDate, calendar: AgeCheck.gregorian) }

    /// "Continue": an under-13 date waits for a second look first.
    func submitDob() async {
        guard canSubmitDob, !agePosting else { return }
        if !dobConfirming, AgeCheck.underThirteen(dob: dob) {
            dobConfirming = true
            ageError = nil
            return
        }
        await sendDob()
    }

    /// Back from the confirm step to the picker, the date kept.
    func changeDob() {
        dobConfirming = false
        ageError = nil
    }

    private func sendDob() async {
        agePosting = true
        ageError = nil
        defer { agePosting = false }
        let asked = api.tokenStore.token()
        do {
            let store = await readStoreCountry()
            let age = try await api.reportDob(
                dob,
                storeCountry: store,
                country: asksCountry ? dobCountry : nil,
                quebec: asksQuebec ? dobQuebec : nil
            )
            if store != nil { storeCountrySent = true }
            guard isSignedIn, api.tokenStore.token() == asked, var current = info else { return }
            let wasBlocked = current.age?.blocked == true
            current.age = age
            info = current
            ageChanged()
            dobConfirming = false
            agePosting = false
            // The server ignored the phone's signal while the account was
            // blocked: tell it again now that the date lifted the block.
            if wasBlocked, !age.blocked {
                lastReport = nil
                await settleAge()
            }
            runAfterAgeIfCleared()
        } catch let error as APIError {
            guard isSignedIn else { return }
            let status = Self.status(error)
            let code = Self.body(error).flatMap { $0.code ?? $0.error }
            if status == 409 || (status == 403 && (code == AgeCheck.blockedCode || code == AgeCheck.setCode)) {
                // Given elsewhere, or closed there: show what the server holds.
                agePosting = false
                await refresh()
                dobConfirming = false
                if info?.age?.needsDob != false { ageError = error }
            } else {
                ageError = error
            }
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
        password = ""
        guard isSignedIn else {
            // Reopening starts at the first screen, the address still filled in.
            stopCountdown()
            step = .choose
            mode = .password
            code = ""
            return
        }
        mode = .password
        if step == .choosePassword { step = .choose }
        // A report that failed leaves the age sheet up; the action waits for it.
        if ageCleared { action?() } else { afterAge = action }
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
            await finishSignIn(session, via: .apple)
            // Codes expire in minutes and work once: send it now. A failure
            // leaves the code kept for a retry; the sign-in stands.
            if let code = identity.authorizationCode, !code.isEmpty {
                appleCodes.setToken("\(Int(Date().timeIntervalSince1970)) \(code)")
                await retryAppleCode()
            }
        } catch {
            failure = Self.signInFailure(error)
        }
    }

    /// Sends the kept Apple code to the server until it confirms (or
    /// refuses it for good). Apple's codes die after about five minutes, so
    /// one older than ten is dropped. Runs at launch, after /me and when the
    /// app becomes active.
    func retryAppleCode() async {
        guard isSignedIn, usesNetwork, !sendingAppleCode, let kept = appleCodes.token() else { return }
        let parts = kept.split(separator: " ", maxSplits: 1)
        guard parts.count == 2, let stamp = TimeInterval(parts[0]),
              Date().timeIntervalSince1970 - stamp < 600
        else {
            appleCodes.clear()
            return
        }
        guard let token = api.tokenStore.token() else { return }
        sendingAppleCode = true
        defer { sendingAppleCode = false }
        do {
            try await api.storeAppleAuthorizationCode(String(parts[1]), token: token)
        } catch let error as APIError {
            // A refusal other than "busy" or "slow down" will not change on a retry.
            let status = Self.status(error)
            guard (400..<500).contains(status), status != 408, status != 429 else { return }
        } catch {
            return
        }
        if appleCodes.token() == kept { appleCodes.clear() }
    }

    func signInWithGoogle() async {
        guard busy == nil else { return }
        busy = .google
        failure = nil
        defer { busy = nil }
        do {
            let identity = try await google.authorize()
            let session = try await api.signInWithIDToken(provider: .google, idToken: identity.idToken, nonce: identity.rawNonce)
            await finishSignIn(session, via: .google)
        } catch {
            failure = Self.signInFailure(error)
        }
    }

    // MARK: - Email code

    static func isPlausibleEmail(_ text: String) -> Bool {
        let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
        return value.range(of: #"^[^\s@]+@[^\s@]+\.[^\s@]+$"#, options: .regularExpression) != nil
    }

    static let passwordMin = 8

    var passwordSignIn: Bool { signInProviders?.passwordSignIn == true }

    private var hasEmail: Bool { !email.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    var canSendCode: Bool {
        busy == nil && hasEmail && (mode != .create || !password.isEmpty)
    }
    var canSignInWithPassword: Bool { busy == nil && hasEmail && !password.isEmpty }
    var canVerifyCode: Bool { busy == nil && Self.digits(code).count == Self.codeLength }

    /// Keeps digits only, at most six (paste-friendly).
    static func digits(_ text: String) -> String {
        String(text.filter { $0.isASCII && $0.isNumber }.prefix(codeLength))
    }

    /// The Continue button: the server says whether the address takes a
    /// password, the code, or has no account yet. A server without the
    /// lookup (404) has no passwords, so it is the code; any other failure
    /// falls back to the password screen, which still offers the code.
    func continueWithEmail(lang: AppLang) async {
        let address = email.trimmingCharacters(in: .whitespacesAndNewlines)
        guard busy == nil else { return }
        guard Self.isPlausibleEmail(address) else {
            failure = .emailInvalid
            return
        }
        email = address
        guard passwordSignIn else {
            mode = .code
            await sendCode(lang: lang)
            return
        }
        busy = .sendCode
        failure = nil
        let method = await lookup(address)
        busy = nil
        switch method {
        case .code:
            mode = .code
            await sendCode(lang: lang)
        case .password:
            password = ""
            mode = .password
            step = .password
        case .new:
            password = ""
            mode = .create
            step = .password
        }
    }

    private func lookup(_ address: String) async -> EmailMethod {
        do {
            return try await api.lookupEmail(address)
        } catch {
            if let error = error as? APIError, Self.status(error) == 404 { return .code }
            return .password
        }
    }

    func forgotPassword(lang: AppLang) async {
        guard busy == nil else { return }
        setMode(.forgot)
        await sendCode(lang: lang)
    }

    func useCode(lang: AppLang) async {
        guard busy == nil else { return }
        setMode(.code)
        await sendCode(lang: lang)
    }

    func sendCode(lang: AppLang) async {
        let address = email.trimmingCharacters(in: .whitespacesAndNewlines)
        guard busy == nil else { return }
        guard Self.isPlausibleEmail(address) else {
            failure = .emailInvalid
            return
        }
        if passwordSignIn, mode == .create, password.count < Self.passwordMin {
            failure = .passwordShort
            return
        }
        busy = .sendCode
        failure = nil
        defer { busy = nil }
        do {
            try await api.sendSignInCode(email: address, lang: lang)
            email = address
            code = ""
            rejectedCode = nil
            if mode != .create { password = "" }
            step = .code(email: address)
            startCountdown()
        } catch {
            failure = Self.sendFailure(error)
        }
    }

    /// A full code goes on its own, unless it is the one just refused.
    var shouldAutoSubmitCode: Bool { canVerifyCode && Self.digits(code) != rejectedCode }

    func verifyCode() async {
        guard case .code(let address) = step, busy == nil else { return }
        let entered = Self.digits(code)
        guard entered.count == Self.codeLength else {
            failure = .codeInvalid
            return
        }
        busy = .verifyCode
        failure = nil
        do {
            let session = try await api.signInWithCode(email: address, code: entered)
            await finishSignIn(session, byCode: true, via: .email, email: address)
        } catch {
            failure = Self.codeFailure(error)
            if failure == .codeInvalid { rejectedCode = entered }
        }
        busy = nil
        // Create asked for the password up front: save it now that the
        // address is proven. A failure leaves the form up to retry.
        if step == .choosePassword, mode == .create, password.count >= Self.passwordMin {
            await saveChosenPassword()
        }
    }

    // MARK: - Password

    func signInWithPassword() async {
        let address = email.trimmingCharacters(in: .whitespacesAndNewlines)
        guard busy == nil, !password.isEmpty else { return }
        guard Self.isPlausibleEmail(address) else {
            failure = .emailInvalid
            return
        }
        busy = .password
        failure = nil
        defer { busy = nil }
        do {
            let session = try await api.signInWithPassword(email: address, password: password)
            await finishSignIn(session, via: .email, email: address)
        } catch {
            failure = Self.passwordFailure(error)
        }
    }

    func setMode(_ mode: Mode) {
        guard busy == nil else { return }
        self.mode = mode
        password = ""
        failure = nil
    }

    /// The password form after a code sign-in: saves what was typed, then
    /// closes the sheet.
    func saveChosenPassword() async {
        if await storePassword(password) { isSignInPresented = false }
    }

    /// Stays signed in without a password.
    func skipPassword() {
        guard step == .choosePassword, busy == nil else { return }
        isSignInPresented = false
    }

    private func storePassword(_ new: String) async -> Bool {
        guard isSignedIn, busy == nil else { return false }
        guard new.count >= Self.passwordMin else {
            failure = .passwordShort
            return false
        }
        busy = .password
        failure = nil
        defer { busy = nil }
        let asked = api.tokenStore.token()
        do {
            try await api.setPassword(new, current: nil, lang: language())
            guard isSameSession(asked) else { return false }
            info?.hasPassword = true
            info?.needsPassword = false
            password = ""
            return true
        } catch let error as APIError where error.code == "signin_required" {
            guard isSameSession(asked) else { return false }
            sessionExpired()
            return false
        } catch let error as APIError where error.code == "password_required" && step == .choosePassword {
            // This code sign-in is too old to replace a password: back to the code step for a fresh one.
            guard isSameSession(asked) else { return false }
            step = .code(email: email)
            code = ""
            failure = .codeExpired
            return false
        } catch APIError.server(let status, let body) where status == 403 && body?.code == "invalid" && step == .choosePassword {
            // The server takes no password for this account (the review account): the sign-in stands without one.
            guard isSameSession(asked) else { return false }
            info?.needsPassword = false
            password = ""
            return true
        } catch {
            failure = Self.passwordSaveFailure(error)
            return false
        }
    }

    func resendCode(lang: AppLang) async {
        guard case .code(let address) = step, busy == nil, resendIn == 0 else { return }
        busy = .sendCode
        failure = nil
        defer { busy = nil }
        do {
            try await api.sendSignInCode(email: address, lang: lang)
            code = ""
            rejectedCode = nil
            startCountdown()
        } catch {
            failure = Self.sendFailure(error)
        }
    }

    func changeEmail() {
        guard busy == nil else { return }
        stopCountdown()
        step = .choose
        mode = .password
        code = ""
        password = ""
        failure = nil
    }

    private func startCountdown() {
        countdown?.cancel()
        resendIn = Self.resendSeconds
        countdown = Task { [weak self] in
            while let self, self.resendIn > 0 {
                try? await Task.sleep(for: .seconds(1))
                guard !Task.isCancelled else { return }
                self.resendIn -= 1
            }
        }
    }

    private func stopCountdown() {
        countdown?.cancel()
        countdown = nil
        resendIn = 0
    }

    /// A deleted account leaves nothing to prefill or tag.
    private func forgetLastSignIn() {
        lastMethod = nil
        email = ""
        defaults.removeObject(forKey: Self.lastMethodKey)
        defaults.removeObject(forKey: Self.lastEmailKey)
    }

    /// Apple may hide the address: the email then stays what it was.
    private func remember(_ method: LastMethod, email: String?) {
        lastMethod = method
        defaults.set(method.rawValue, forKey: Self.lastMethodKey)
        if let email, !email.isEmpty {
            self.email = email
            defaults.set(email, forKey: Self.lastEmailKey)
        }
    }

    // MARK: - Session

    /// A code sign-in keeps the sheet open on the password form when the
    /// person is creating an account or resetting a password, or when /me says
    /// the account has none. If /me can't be read the sign-in just finishes.
    private func finishSignIn(_ session: AuthSession, byCode: Bool = false, via method: LastMethod, email: String? = nil) async {
        api.tokenStore.setToken(session.token)
        defaults.set(Date().timeIntervalSince1970, forKey: Self.signedInAtKey)
        remember(method, email: email ?? session.user?.email)
        isSignedIn = true
        info = session.user.map { AccountInfo(user: $0, entitlement: nil) }
        notice = nil
        failure = nil
        code = ""
        var choosePassword = byCode && passwordSignIn && (mode == .create || mode == .forgot)
        if choosePassword {
            step = .choosePassword
        } else if !byCode {
            step = .choose
        }
        // The verdict waiting behind sign-in needs the age on record first:
        // read the account and report the phone's answer before the sheet closes.
        var known = false
        if usesNetwork,
           let fresh = try? await api.me(), fresh.user != nil, isSignedIn {
            info = fresh
            ageChanged()
            known = true
            await settleAge()
            if byCode, passwordSignIn, fresh.needsPassword { choosePassword = true }
        }
        if byCode { step = choosePassword ? .choosePassword : .choose }
        if !choosePassword {
            password = ""
            mode = .password
            isSignInPresented = false
        }
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

    /// Deleting needs the account's password, or a sign-in from the last
    /// few minutes when it has none. Without either the delete sheet asks
    /// for a new sign-in instead of sending a call that would be refused.
    var deleteNeedsSignIn: Bool {
        if isSignedIn, failure == .deleteReauth { return true }
        guard isSignedIn, let info, info.user != nil, info.hasPassword == false else { return false }
        let at = defaults.double(forKey: Self.signedInAtKey)
        return at == 0 || Date().timeIntervalSince1970 - at > Self.freshSignIn
    }

    /// The account has a password the delete sheet asks for. Left empty it
    /// sends none, and the server decides by the age of the sign-in.
    var deleteNeedsPassword: Bool { info?.hasPassword == true }

    /// The sheet also offers a new sign-in: the session is too old, or the
    /// password was wrong and may be forgotten.
    var deleteOffersSignIn: Bool { deleteNeedsSignIn || (isSignedIn && failure == .currentPasswordWrong) }

    /// Ends this session and opens sign-in, so the next delete is fresh.
    /// Nothing is wiped from the phone: the same account comes back.
    func signInAgainToDelete() async {
        guard isSignedIn, busy == nil else { return }
        busy = .signOut
        try? await api.signOut()
        busy = nil
        clearSession()
        isSignInPresented = true
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
        let typed = deleteNeedsPassword && !deletePassword.isEmpty ? deletePassword : nil
        deletePassword = ""
        do {
            try await api.deleteAccount(password: typed)
            guard isSameSession(asked) else { return }
            clearSession(byUser: true)
            forgetLastSignIn()
            notice = .deleted
        } catch let error as APIError where error.code == "signin_required" {
            guard isSameSession(asked) else { return }
            sessionExpired()
        } catch let error as APIError where error == .timeout || error == .interrupted {
            let check = try? await api.me()
            guard isSameSession(asked) else { return }
            if let check, check.user == nil {
                clearSession(byUser: true)
                forgetLastSignIn()
                notice = .deleted
            } else {
                failure = .deleteFailed
            }
        } catch let error as APIError {
            guard isSameSession(asked) else { return }
            failure = Self.deleteFailure(error)
        } catch {
            failure = .deleteFailed
        }
    }

    /// What the delete screens show under the button.
    static let deleteFailures: [Failure] = [
        .deleteFailed, .deleteLimited, .deleteReauth, .currentPasswordWrong, .currentPasswordRequired,
    ]

    static func deleteFailure(_ error: APIError) -> Failure {
        if case .server(let status, _) = error {
            if status == 429 || error.code == "rate_limited" { return .deleteLimited }
            switch error.code {
            case "reauth_required": return .deleteReauth
            case "password_wrong": return .currentPasswordWrong
            case "password_required": return .currentPasswordRequired
            default: break
            }
        }
        return .deleteFailed
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
        defaults.removeObject(forKey: Self.signedInAtKey)
        deletePassword = ""
        appleCodes.clear()
        isSignedIn = false
        info = nil
        ageChanged()
        // The phone's own answer stays; what was sent for this account doesn't.
        lastReport = nil
        ageError = nil
        dobConfirming = false
        dobDate = AgeCheck.defaultDobDate()
        dobPicked = false
        dobCountry = nil
        dobQuebec = nil
        hintLoaded = false
        storeCountrySent = false
        parent.reset()
        afterAge = nil
        failure = nil
        step = .choose
        code = ""
        password = ""
        mode = .password
        stopCountdown()
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

    /// A wrong password, an unknown address and an account without a
    /// password all answer 401 alike.
    static func passwordFailure(_ error: any Error) -> Failure? {
        if APIError.isCancellation(error) { return nil }
        guard let api = error as? APIError else { return .signInFailed }
        if case .server(let status, _) = api, status == 401 { return .passwordWrong }
        return serverFailure(api) ?? .signInFailed
    }

    static func passwordSaveFailure(_ error: any Error) -> Failure? {
        if APIError.isCancellation(error) { return nil }
        guard let api = error as? APIError else { return .passwordSaveFailed }
        switch api.code {
        case "too_short", "too_long": return .passwordShort
        case "password_wrong": return .currentPasswordWrong
        case "password_required": return .currentPasswordRequired
        default: return serverFailure(api) ?? .passwordSaveFailed
        }
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
        case .passwordWrong: return L10n.signinPasswordWrong(lang)
        case .passwordShort: return L10n.signinPasswordShort(lang)
        case .passwordSaveFailed: return L10n.signinPasswordSaveFailed(lang)
        case .currentPasswordWrong: return L10n.errorPasswordWrong(lang)
        case .currentPasswordRequired: return L10n.errorPasswordRequired(lang)
        case .deleteFailed: return L10n.accountDeleteFailed(lang)
        case .deleteLimited: return L10n.accountDeleteLimited(lang)
        case .deleteReauth: return L10n.errorReauthRequired(lang)
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
        mode: Mode = .password,
        config: ServerConfig? = nil
    ) {
        usesNetwork = false
        lastMethod = nil
        self.providers = .loaded(providers)
        if let config { serverConfig = config }
        if let info {
            self.info = info
            isSignedIn = true
        }
        self.step = step
        self.email = email
        self.mode = mode
    }

    /// Tests: a loaded config and account, keeping the network on.
    func preload(config: ServerConfig?, info: AccountInfo?) {
        serverConfig = config
        if let config { providers = .loaded(config.signIn) }
        self.info = info
    }
}
#endif
