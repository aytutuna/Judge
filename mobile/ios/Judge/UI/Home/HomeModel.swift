import Foundation
import Observation
import UIKit

enum HomeRoute: Hashable {
    case verdict(id: String)
    case pricing
}

/// The Home flow: argument, preset, the pending request and its outcome.
/// Owned by `AppModel` so a verdict in progress survives tab switches.
///
/// Free verdicts post once (a bot check first). Premium verdicts follow the
/// website (app/page.tsx): POST /api/v1/clarify for up to two questions,
/// then the verdict with an Idempotency-Key, retried while the server says
/// the same request is still being judged (409 in_progress).
@MainActor
@Observable
final class HomeModel {
    static let maxLength = 6000
    static let minLength = 20
    /// The counter turns terracotta above this.
    static let warnLength = 5700
    /// Longest clarifying answer the API takes (lib/types.ts Clarification).
    static let maxAnswer = 500
    /// MAX_EVIDENCE_PER_SIDE (lib/case-types.ts).
    static let maxEvidence = 3

    var argument = ""
    var preset: String
    var path: [HomeRoute] = []

    /// The bot check is running (before the judging cover goes up).
    private(set) var isCheckingBot = false
    /// Premium step 1: asking whether key facts are missing.
    private(set) var isCheckingQuestions = false
    /// Shows the judging cover.
    var isJudging = false
    /// The cover shows the premium variant (the web check line).
    private(set) var judgingPremium = false
    /// Premium's questions, shown in place of the form.
    private(set) var clarify: ClarifyState?
    /// The verdict, once it has arrived (the cover then plays its finish).
    /// Kept until the next submit or cancel, so the cover keeps its final
    /// frame while it animates out.
    private(set) var arrived: VerdictResult?
    private(set) var error: APIError?
    private(set) var blockedUntil: Date?
    /// Screenshots picked for the next premium request.
    let evidence: EvidenceModel

    /// While the server answers 409 in_progress (the same premium request is
    /// still being judged, e.g. after a dropped connection), ask again this
    /// often, for at most the route's 300 s.
    @ObservationIgnored var inProgressInterval: Duration = .seconds(4)
    @ObservationIgnored var inProgressWait: Duration = .seconds(300)

    struct ClarifyState: Equatable {
        var questions: [ClarifyQuestion]
        var answers: [String: String] = [:]
    }

    @ObservationIgnored private var sessions: [String: VerdictSession] = [:]
    @ObservationIgnored private var arrivedID: String?
    @ObservationIgnored private var request: Task<Void, Never>?
    @ObservationIgnored private var unblock: Task<Void, Never>?
    @ObservationIgnored private var pending: PendingVerdict?
    /// What a premium request judges, fixed when it was submitted.
    @ObservationIgnored private var premiumInput: PremiumInput?
    @ObservationIgnored private let keys = IdempotencyKeys()
    /// Told when the server refuses the session (401 signin_required) and
    /// when a premium outcome changes the balance.
    @ObservationIgnored private weak var account: AccountModel?

    /// What was asked: "Try again" with the same request resumes its verdict.
    private struct RequestKey: Equatable {
        let text: String
        let preset: String
        let lang: AppLang
        /// Premium: the tier and the evidence tokens.
        var extra = ""
    }

    private struct PremiumInput: Equatable {
        let argument: String
        let preset: String
        let lang: AppLang
        let evidence: [String]

        var requestKey: RequestKey {
            RequestKey(text: argument, preset: preset, lang: lang, extra: "premium:" + evidence.joined(separator: ","))
        }
    }

    /// A verdict the server accepted (202) but the app has not received:
    /// kept when polling stopped short (network, server hiccups, the close
    /// button), so the same request polls the same id again instead of
    /// asking, and paying, for a second verdict.
    private struct PendingVerdict {
        let accepted: VerdictAccepted
        let key: RequestKey
        let since: Date
    }

    /// After this long a pending verdict is dropped and a new one is asked
    /// for; the server settles every verdict within about 10 minutes.
    static let resumeWindow: TimeInterval = 15 * 60

    init(preset: String) {
        self.preset = Preset.find(preset).id
        evidence = EvidenceModel(max: Self.maxEvidence)
    }

    /// UTF-16 length, as the website's `maxLength` and the server count it.
    var length: Int { argument.utf16.count }

    var trimmedLength: Int { argument.trimmingCharacters(in: .whitespacesAndNewlines).utf16.count }

    /// Something the form started is still running: the switches hold still.
    var isBusy: Bool { isCheckingBot || isCheckingQuestions || isJudging }

    func canSubmit(now: Date = .now, evidenceOn: Bool = false) -> Bool {
        guard trimmedLength >= Self.minLength, length <= Self.maxLength, !isBusy else { return false }
        if evidenceOn, evidence.busy { return false }
        if let blockedUntil, blockedUntil > now { return false }
        return true
    }

    /// Hard cap at 6000 UTF-16 units, cutting whole characters.
    static func capped(_ text: String) -> String {
        capUTF16(text, max: maxLength)
    }

    /// One cut at the last character boundary at or before `max` UTF-16 units.
    static func capUTF16(_ text: String, max: Int) -> String {
        let utf16 = text.utf16
        guard utf16.count > max else { return text }
        var end = utf16.index(utf16.startIndex, offsetBy: max)
        while String.Index(end, within: text) == nil {
            end = utf16.index(before: end)
        }
        return String(text[..<end])
    }

    func session(_ id: String) -> VerdictSession? { sessions[id] }

    func updateSession(_ session: VerdictSession) {
        sessions[session.id] = session
    }

    /// "Get the verdict". Verdicts need an account: signed out, this opens
    /// sign-in and submits once the user has signed in. Premium (chosen and
    /// usable) goes through the clarifying step first.
    func submit(app: AppModel) {
        guard canSubmit(evidenceOn: app.evidenceOn) else { return }
        account = app.account
        guard app.account.isSignedIn else {
            app.account.requireSignIn { [weak self, weak app] in
                guard let self, let app else { return }
                self.submit(app: app)
            }
            return
        }
        if app.effectiveTier == .premium {
            submitPremium(app: app)
        } else {
            submitFree(app: app)
        }
    }

    /// A free verdict. The request is sent once; "Try again" is the only
    /// retry, and it is the user's. When the same request was already
    /// accepted, it polls for that verdict instead.
    ///
    /// The bot check runs first, with Home still on screen: its interactive
    /// sheet is presented from the root view, which cannot present while the
    /// judging cover is up. The cover goes up once there is a token.
    private func submitFree(app: AppModel) {
        error = nil
        arrived = nil
        arrivedID = nil
        judgingPremium = false
        isCheckingBot = true
        let text = argument
        let preset = preset
        let lang = app.lang
        let api = app.api
        let botCheck = app.botCheck
        let history = app.history
        let key = RequestKey(text: text, preset: preset, lang: lang)
        if let held = pending, held.key == key, Date.now.timeIntervalSince(held.since) < Self.resumeWindow {
            isCheckingBot = false
            isJudging = true
            request = Task { [weak self] in
                await self?.judge(.resume(held.accepted), requestKey: key, api: api, history: history, preset: preset)
            }
            return
        }
        pending = nil
        request = Task { [weak self] in
            let token: String?
            do {
                token = try await botCheck.token()
            } catch {
                guard let self, !Task.isCancelled else { return }
                self.isCheckingBot = false
                self.fail(.botCheck)
                return
            }
            guard let self, !Task.isCancelled else { return }
            self.isCheckingBot = false
            self.isJudging = true
            let body = VerdictRequest(argument: text, framework: .init(preset: preset), lang: lang, turnstileToken: token)
            await self.judge(.post(body), requestKey: key, api: api, history: history, preset: preset)
        }
    }

    // MARK: - Premium

    private enum QuestionsOutcome {
        case questions([ClarifyQuestion])
        case stop(APIError)
    }

    /// Premium step 1: ask whether key facts are missing. Network trouble or
    /// a server error never blocks the verdict: it goes ahead without
    /// questions. Account problems (401, 402) and bad input (400, 403) stop
    /// on the form. A premium request already accepted for the same input
    /// is picked up again instead.
    private func submitPremium(app: AppModel) {
        error = nil
        arrived = nil
        arrivedID = nil
        clarify = nil
        let input = PremiumInput(
            argument: argument,
            preset: preset,
            lang: app.lang,
            evidence: app.evidenceOn ? evidence.tokens : []
        )
        premiumInput = input
        let api = app.api
        let history = app.history
        let key = input.requestKey
        if let held = pending, held.key == key, Date.now.timeIntervalSince(held.since) < Self.resumeWindow {
            judgingPremium = true
            isJudging = true
            request = Task { [weak self] in
                await self?.judge(.resume(held.accepted), requestKey: key, api: api, history: history, preset: input.preset, premium: true)
            }
            return
        }
        isCheckingQuestions = true
        request = Task { [weak self] in
            let asked = await Self.askQuestions(api: api, argument: input.argument, lang: input.lang)
            guard let self, !Task.isCancelled else { return }
            self.isCheckingQuestions = false
            switch asked {
            case .stop(let failure):
                self.fail(failure)
            case .questions(let questions):
                if questions.isEmpty {
                    self.judgePremium(input, clarifications: nil, api: api, history: history)
                } else {
                    self.clarify = ClarifyState(questions: questions)
                }
            }
        }
    }

    private static func askQuestions(api: JudgeAPI, argument: String, lang: AppLang) async -> QuestionsOutcome {
        do {
            return .questions(try await api.clarify(argument: argument, lang: lang))
        } catch let failure as APIError {
            if case .server(let status, _) = failure, [400, 401, 402, 403].contains(status) {
                return .stop(failure)
            }
            return .questions([])
        } catch {
            return .questions([])
        }
    }

    func setAnswer(_ value: String, for id: String) {
        clarify?.answers[id] = Self.capUTF16(value, max: Self.maxAnswer)
    }

    /// "Get the verdict" (answers as typed) or "Skip and judge" (every
    /// answer empty, so the server still knows what was asked).
    func finishClarify(skip: Bool, app: AppModel) {
        guard let state = clarify, let input = premiumInput else { return }
        account = app.account
        let clarifications = Self.clarifications(state.questions, answers: state.answers, skip: skip)
        judgePremium(input, clarifications: clarifications, api: app.api, history: app.history)
    }

    /// "Edit the argument": back to the form, nothing sent.
    func clarifyBack() {
        clarify = nil
    }

    /// The request's `clarifications` (buildClarifications on the web): one
    /// entry per question, answered or not; nil when there were none.
    static func clarifications(_ questions: [ClarifyQuestion], answers: [String: String], skip: Bool) -> [VerdictRequest.Clarification]? {
        guard !questions.isEmpty else { return nil }
        return questions.prefix(2).map { question in
            let text = capUTF16(question.text.trimmingCharacters(in: .whitespacesAndNewlines), max: 300)
            let answer = skip ? "" : capUTF16((answers[question.id] ?? "").trimmingCharacters(in: .whitespacesAndNewlines), max: maxAnswer)
            return VerdictRequest.Clarification(question: text, answer: answer)
        }
    }

    /// Premium step 2: the verdict itself, behind the premium judging cover.
    private func judgePremium(_ input: PremiumInput, clarifications: [VerdictRequest.Clarification]?, api: JudgeAPI, history: HistoryStore) {
        clarify = nil
        error = nil
        arrived = nil
        arrivedID = nil
        pending = nil
        judgingPremium = true
        isJudging = true
        let body = VerdictRequest(
            argument: input.argument,
            framework: .init(preset: input.preset),
            lang: input.lang,
            tier: Tier.premium.rawValue,
            clarifications: clarifications,
            evidence: input.evidence.isEmpty ? nil : input.evidence
        )
        let token = keys.key(for: IdempotencyKeys.canonical(body))
        let key = input.requestKey
        request = Task { [weak self] in
            await self?.judge(.premium(body, idempotencyKey: token), requestKey: key, api: api, history: history, preset: input.preset, premium: true)
        }
    }

    /// The premium POST, asked again every few seconds while the server
    /// answers 409 in_progress, until the route's time is up.
    private func startPremium(_ body: VerdictRequest, idempotencyKey: String, api: JudgeAPI) async throws -> VerdictStart {
        let clock = ContinuousClock()
        let deadline = clock.now.advanced(by: inProgressWait)
        while true {
            do {
                return try await api.startVerdict(body, idempotencyKey: idempotencyKey)
            } catch let failure as APIError where failure.code == "in_progress" && clock.now < deadline {
                try await Task.sleep(for: inProgressInterval)
            }
        }
    }

    /// A replayed premium verdict comes without its name map: the writer's
    /// view has it. Best effort; the labels stay otherwise.
    private func withNames(_ payload: VerdictPayload, api: JudgeAPI) async -> VerdictPayload {
        guard payload.nameMap.isEmpty,
              let names = try? await api.mineNameMap(id: payload.id), !names.isEmpty
        else { return payload }
        var named = payload
        named.nameMap = names
        return named
    }

    // MARK: - The request

    private enum Start {
        case post(VerdictRequest)
        case premium(VerdictRequest, idempotencyKey: String)
        case resume(VerdictAccepted)
    }

    /// The request behind the judging cover: the POST (unless resuming),
    /// then polling while the server judges. Cancelling the task (the close
    /// button) stops either.
    private func judge(
        _ start: Start,
        requestKey: RequestKey,
        api: JudgeAPI,
        history: HistoryStore,
        preset: String,
        premium: Bool = false
    ) async {
        // A verdict can take minutes: ask for background time so a short
        // app switch does not suspend the app and drop the connection.
        let background = BackgroundActivity(name: "verdict")
        defer { background.end() }
        // Any premium outcome (a refusal or failure gives the unit back) can
        // change the balance.
        defer { if premium { account?.refreshSoon() } }
        var acceptedID: String?
        var idempotencyKey: String?
        do {
            let accepted: VerdictAccepted
            switch start {
            case .resume(let held):
                accepted = held
            case .post(let body):
                switch try await api.startVerdict(body) {
                case .ready(let payload):
                    guard !Task.isCancelled else { return }
                    deliver(payload, history: history, preset: preset)
                    return
                case .accepted(let fresh):
                    accepted = fresh
                    pending = PendingVerdict(accepted: fresh, key: requestKey, since: .now)
                }
            case .premium(let body, let token):
                idempotencyKey = token
                switch try await startPremium(body, idempotencyKey: token, api: api) {
                case .ready(let payload):
                    if let entitlement = payload.entitlement { account?.applyEntitlement(entitlement) }
                    var named = payload
                    if payload.replayed { named = await withNames(payload, api: api) }
                    guard !Task.isCancelled else { return }
                    keys.clear(token)
                    deliver(named, history: history, preset: preset)
                    return
                case .accepted(let fresh):
                    if let entitlement = fresh.entitlement { account?.applyEntitlement(entitlement) }
                    accepted = fresh
                    pending = PendingVerdict(accepted: fresh, key: requestKey, since: .now)
                }
            }
            acceptedID = accepted.id
            var payload = try await api.awaitVerdict(accepted)
            // Closed at the last moment: keep the id so the same request
            // picks the finished verdict up.
            guard !Task.isCancelled else { return }
            if accepted.replayed { payload = await withNames(payload, api: api) }
            guard !Task.isCancelled else { return }
            if pending?.accepted.id == accepted.id { pending = nil }
            if let idempotencyKey { keys.clear(idempotencyKey) }
            deliver(payload, history: history, preset: preset)
        } catch let failure as VerdictPollError {
            if !failure.resumable, let acceptedID, pending?.accepted.id == acceptedID { pending = nil }
            guard !Task.isCancelled else { return }
            fail(failure.error, background: background)
        } catch let failure as APIError {
            guard !Task.isCancelled else { return }
            fail(failure, background: background)
        } catch is CancellationError {
            return
        } catch {
            guard !Task.isCancelled else { return }
            fail(.malformed)
        }
    }

    private func deliver(_ payload: VerdictPayload, history: HistoryStore, preset: String) {
        let session = VerdictSession(id: payload.id, original: payload.result, nameMap: payload.nameMap, translations: [:])
        sessions[session.id] = session
        try? history.save(session, preset: preset)
        arrivedID = session.id
        arrived = payload.result.result
    }

    /// A connection lost after the background time ran out is the
    /// suspension, not the network.
    private func fail(_ failure: APIError, background: BackgroundActivity) {
        fail(failure == .offline && background.expired ? .interrupted : failure)
    }

    /// The judging cover finished its reveal: hand over to the verdict.
    func judgingFinished() {
        isJudging = false
        guard let id = arrivedID else { return }
        arrivedID = nil
        path.append(.verdict(id: id))
    }

    /// Close button on the judging cover. The server may still finish and
    /// save the verdict; that is accepted.
    func cancel() {
        request?.cancel()
        request = nil
        isCheckingBot = false
        isCheckingQuestions = false
        isJudging = false
        arrived = nil
        arrivedID = nil
    }

    /// "Judge another": back to an empty form.
    func judgeAnother() {
        argument = ""
        error = nil
        clarify = nil
        judgingPremium = false
        evidence.clear()
        path.removeAll()
    }

    func dismissError() {
        error = nil
    }

    private func fail(_ failure: APIError) {
        isJudging = false
        if failure.code == "signin_required", let account {
            // The token is already cleared; sign-in comes up once the cover is gone.
            account.sessionExpired(presentAfter: .milliseconds(600))
            return
        }
        if case .server(let status, _) = failure, status == 402 {
            // The balance on screen is stale: the tier note updates with it.
            account?.refreshSoon()
        }
        error = failure
        if failure.code == "rate_limited", let wait = failure.retryAfterSec, wait > 0 {
            block(for: wait)
        }
    }

    private func block(for seconds: Double) {
        let until = Date.now.addingTimeInterval(seconds)
        blockedUntil = until
        unblock?.cancel()
        unblock = Task { [weak self] in
            try? await Task.sleep(for: .seconds(seconds))
            guard !Task.isCancelled, let self, self.blockedUntil == until else { return }
            self.blockedUntil = nil
        }
    }
}

#if DEBUG
extension HomeModel {
    /// Screenshot fixtures: show an error without a request.
    func showForScreenshot(error: APIError) {
        self.error = error
    }

    /// Screenshot fixtures: the judging cover without a request.
    func showForScreenshot(judgingPremium: Bool) {
        self.judgingPremium = judgingPremium
        isJudging = true
    }

    /// Screenshot fixtures: the clarifying step without a request.
    func showForScreenshot(questions: [ClarifyQuestion], answers: [String: String] = [:]) {
        clarify = ClarifyState(questions: questions, answers: answers)
        premiumInput = PremiumInput(argument: argument, preset: preset, lang: .en, evidence: [])
    }
}
#endif

/// A UIKit background task around one request: about 30 s of extra run time
/// after the user leaves the app. `expired` records that the time ran out
/// (iOS then suspends the app and open connections usually drop).
@MainActor
final class BackgroundActivity {
    private var identifier: UIBackgroundTaskIdentifier = .invalid
    private(set) var expired = false

    init(name: String) {
        identifier = UIApplication.shared.beginBackgroundTask(withName: name) { [weak self] in
            MainActor.assumeIsolated {
                self?.expired = true
                self?.end()
            }
        }
    }

    func end() {
        guard identifier != .invalid else { return }
        UIApplication.shared.endBackgroundTask(identifier)
        identifier = .invalid
    }
}
