import Foundation
import Observation
import UIKit

enum HomeRoute: Hashable {
    case verdict(id: String)
    case saved(id: String)
    case pricing
    case caseDetail(id: String)
}

/// The mode on Home (components/case/CaseModeSwitch.tsx): a verdict
/// right away, or a two-sided case with an invite link.
enum HomeMode: String, Sendable {
    case now, both
}

/// The Home flow: argument, the pending request and its outcome.
/// Owned by `AppModel` so a verdict in progress survives tab switches.
///
/// Every verdict is premium and follows the website (app/page.tsx): POST
/// /api/v1/clarify for up to two questions, then the verdict with an
/// Idempotency-Key, retried while the server says the same request is
/// still being judged (409 in_progress).
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

    /// Your side.
    var argument = ""
    /// The other side, when the user writes it too; empty sends `argument` alone.
    var otherSide = ""
    /// The other side's name over their card; nil until typed.
    var otherName: String?
    var path: [HomeRoute] = []

    /// Step 1: asking whether key facts are missing.
    private(set) var isCheckingQuestions = false
    /// Shows the judging cover.
    var isJudging = false
    /// The clarifying questions, shown in place of the form.
    private(set) var clarify: ClarifyState?
    /// The verdict, once it has arrived (the cover then plays its finish).
    /// Kept until the next submit or cancel, so the cover keeps its final
    /// frame while it animates out.
    private(set) var arrived: VerdictResult?
    /// The sides the running request sent, for the judging cover.
    private(set) var judgedSides: [JudgedSide] = []
    private(set) var error: APIError?
    private(set) var blockedUntil: Date?
    /// Screenshots picked for the next request.
    let evidence: EvidenceModel
    /// Just me (a verdict now) or both sides (a case), when cases are offered.
    var mode: HomeMode = .now
    /// Your name over your card, in the joined text and on a new case's
    /// share pages; nil = the account's first name until the user types.
    var caseName: String?
    /// POST /api/v1/cases is running (the owner's side is being anonymized).
    private(set) var isCreatingCase = false

    /// While the server answers 409 in_progress (the same premium request is
    /// still being judged, e.g. after a dropped connection), ask again this
    /// often, for at most the route's 300 s.
    @ObservationIgnored var inProgressInterval: Duration = .seconds(4)
    @ObservationIgnored var inProgressWait: Duration = .seconds(300)
    /// Scroll anchor Home opens on (screenshot states); nil = the top.
    @ObservationIgnored var initialScroll: String?
    static let submitAnchor = "home.submit"
    static let evidenceAnchor = "home.evidence"

    /// One written side as the judging cover shows it; an empty name reads
    /// "Your side" / "Their side".
    struct JudgedSide: Equatable {
        let mine: Bool
        let name: String
        let text: String
    }

    struct ClarifyState: Equatable {
        var questions: [ClarifyQuestion]
        var answers: [String: String] = [:]
    }

    @ObservationIgnored private var sessions: [String: VerdictSession] = [:]
    @ObservationIgnored private var arrivedID: String?
    @ObservationIgnored private var request: Task<Void, Never>?
    @ObservationIgnored private var unblock: Task<Void, Never>?
    @ObservationIgnored private var pending: PendingVerdict?
    /// What a request judges, fixed when it was submitted.
    @ObservationIgnored private var premiumInput: PremiumInput?
    @ObservationIgnored private let keys = IdempotencyKeys()
    /// The example "Try an example" filled in last, so the next tap picks another.
    @ObservationIgnored private var lastExample: String?
    /// The name the example wrote: "+" drops it, but keeps one the user typed.
    @ObservationIgnored private var exampleName: String?
    /// Told when the server refuses the session (401) and when an outcome
    /// changes the balance.
    @ObservationIgnored private weak var account: AccountModel?

    /// What was asked: "Try again" with the same request resumes its verdict.
    private struct RequestKey: Equatable {
        let text: String
        let lang: AppLang
        /// The evidence tokens.
        var extra = ""
    }

    private struct PremiumInput: Equatable {
        let argument: String
        let lang: AppLang
        let evidence: [String]

        var requestKey: RequestKey {
            RequestKey(text: argument, lang: lang, extra: "premium:" + evidence.joined(separator: ","))
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
        /// Premium: the request's Idempotency-Key, retired once the verdict arrives.
        var idempotencyKey: String? = nil
    }

    /// After this long a pending verdict is dropped and a new one is asked
    /// for; the server settles every verdict within about 10 minutes.
    static let resumeWindow: TimeInterval = 15 * 60

    init() {
        evidence = EvidenceModel(max: Self.maxEvidence)
    }

    /// What the judges read: your side as written, or with the other side
    /// filled in, both joined into one text with a name in front of each.
    func outgoing(_ app: AppModel) -> String {
        Self.joined(mine: argument, theirs: otherSide, myName: shownCaseName(app), theirName: otherName ?? "", lang: app.lang)
    }

    static func joined(mine: String, theirs: String, myName: String, theirName: String, lang: AppLang) -> String {
        let theirs = theirs.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !theirs.isEmpty else { return mine }
        let mine = mine.trimmingCharacters(in: .whitespacesAndNewlines)
        func part(_ text: String, name: String, unnamed: String) -> String {
            let name = name.trimmingCharacters(in: .whitespacesAndNewlines)
            return (name.isEmpty ? unnamed : L10n.appHomeSays(lang, name: name)) + " " + text
        }
        var parts: [String] = []
        if !mine.isEmpty { parts.append(part(mine, name: myName, unnamed: L10n.appHomeMySide(lang))) }
        parts.append(part(theirs, name: theirName, unnamed: L10n.appHomeOtherSide(lang)))
        return parts.joined(separator: "\n\n")
    }

    /// The written sides, yours first.
    static func sides(mine: String, theirs: String, myName: String, theirName: String) -> [JudgedSide] {
        func side(_ isMine: Bool, _ text: String, _ name: String) -> JudgedSide {
            JudgedSide(
                mine: isMine,
                name: name.trimmingCharacters(in: .whitespacesAndNewlines),
                text: text.trimmingCharacters(in: .whitespacesAndNewlines)
            )
        }
        return [side(true, mine, myName), side(false, theirs, theirName)].filter { !$0.text.isEmpty }
    }

    /// UTF-16 length of what would be sent, as the website's `maxLength`
    /// and the server count it.
    func length(_ app: AppModel) -> Int { outgoing(app).utf16.count }

    /// What the user wrote, without the names and labels the join adds.
    var writtenLength: Int {
        [argument, otherSide].map { $0.trimmingCharacters(in: .whitespacesAndNewlines).utf16.count }.reduce(0, +)
    }

    /// Something the form started is still running: the switches hold still.
    var isBusy: Bool { isCheckingQuestions || isJudging || isCreatingCase }

    /// Nothing typed or attached: Home's "+" stays hidden.
    var isBlank: Bool { argument.isEmpty && otherSide.isEmpty && evidence.items.isEmpty }

    /// Both sides chosen while cases can be used: "Create the invite".
    func isTwoSided(_ app: AppModel) -> Bool {
        app.casesOn && mode == .both
    }

    /// The display name field's text: what was typed, else the account's first name.
    func shownCaseName(_ app: AppModel) -> String {
        caseName ?? Names.firstName(app.account.user?.name) ?? ""
    }

    func canSubmit(_ app: AppModel, now: Date = .now) -> Bool {
        guard writtenLength >= Self.minLength, length(app) <= Self.maxLength, !isBusy else { return false }
        if app.evidenceOn, evidence.busy { return false }
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
    /// sign-in and submits once the user has signed in. A verdict goes
    /// through the clarifying step first.
    func submit(app: AppModel) {
        guard canSubmit(app) else { return }
        account = app.account
        guard app.account.isSignedIn else {
            // Signing in can turn on cases; then nothing is sent until the
            // user taps again.
            let twoSidedAtTap = isTwoSided(app)
            app.account.requireSignIn { [weak self, weak app] in
                guard let self, let app, self.isTwoSided(app) == twoSidedAtTap else { return }
                self.submit(app: app)
            }
            return
        }
        app.analytics.track("case_submitted")
        if isTwoSided(app) {
            createCase(app: app)
        } else {
            submitPremium(app: app)
        }
    }

    /// "Or send them a link to write it": a two-sided case with your side;
    /// the other person writes theirs.
    func sendLink(app: AppModel) {
        mode = .both
        submit(app: app)
    }

    /// Nothing left to spend: pricing instead of a request the server
    /// would refuse. Until /me has answered the server decides.
    private func openPricingIfOut(_ app: AppModel) -> Bool {
        guard let entitlement = app.account.entitlement, Balance(entitlement) == .empty else { return false }
        path.append(.pricing)
        return true
    }

    // MARK: - Two-sided cases

    /// Both sides: create the case with the owner's side (it holds one
    /// verdict's unit), keep the returned names on the phone and open the
    /// case page with the invite link. No clarifying step: the other side's
    /// account fills the gaps.
    private func createCase(app: AppModel) {
        if openPricingIfOut(app) { return }
        error = nil
        isCreatingCase = true
        let text = argument
        let lang = app.lang
        let tokens = app.evidenceOn ? evidence.tokens : []
        let name = shownCaseName(app).trimmingCharacters(in: .whitespacesAndNewlines)
        let displayName: String? = name.isEmpty ? nil : name
        let other = otherName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let body = JudgeAPI.createCaseBody(text: text, lang: lang, evidence: tokens, displayName: displayName)
        let token = keys.key(for: JudgeAPI.canonical(body))
        let api = app.api
        let names = app.caseNames
        request = Task { [weak self, weak app] in
            do {
                let created = try await api.createCase(
                    text: text, lang: lang, evidence: tokens, displayName: displayName, idempotencyKey: token
                )
                guard let self, !Task.isCancelled else { return }
                self.keys.clear(token)
                names.save(caseID: created.view.id, created.nameMap)
                if let entitlement = created.entitlement { self.account?.applyEntitlement(entitlement) }
                app?.seedCase(created.view, otherName: other.isEmpty ? nil : other)
                self.evidence.clear()
                self.argument = ""
                self.caseName = nil
                self.otherName = nil
                self.mode = .now
                self.isCreatingCase = false
                self.path.append(.caseDetail(id: created.view.id))
            } catch is CancellationError {
                self?.isCreatingCase = false
            } catch let failure as APIError {
                guard let self else { return }
                self.isCreatingCase = false
                self.fail(failure)
            } catch {
                guard let self else { return }
                self.isCreatingCase = false
                self.fail(.malformed)
            }
        }
    }

    // MARK: - Verdicts

    private enum QuestionsOutcome {
        case questions([ClarifyQuestion])
        case stop(APIError)
    }

    /// Step 1: ask whether key facts are missing. Network trouble or a
    /// server error never blocks the verdict: it goes ahead without
    /// questions. Account problems (401, 402) and bad input (400, 403) stop
    /// on the form. A request already accepted for the same input is picked
    /// up again instead, even with nothing left to spend: it is paid for.
    private func submitPremium(app: AppModel) {
        error = nil
        arrived = nil
        arrivedID = nil
        clarify = nil
        let input = PremiumInput(
            argument: outgoing(app),
            lang: app.lang,
            evidence: app.evidenceOn ? evidence.tokens : []
        )
        premiumInput = input
        judgedSides = Self.sides(mine: argument, theirs: otherSide, myName: shownCaseName(app), theirName: otherName ?? "")
        let api = app.api
        let history = app.history
        let key = input.requestKey
        if let held = pending, held.key == key, Date.now.timeIntervalSince(held.since) < Self.resumeWindow {
            isJudging = true
            request = Task { [weak self] in
                await self?.judge(.resume(held.accepted, idempotencyKey: held.idempotencyKey), requestKey: key, api: api, history: history)
            }
            return
        }
        if openPricingIfOut(app) { return }
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
        if !skip { app.analytics.track("question_answered") }
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

    /// Step 2: the verdict itself, behind the judging cover.
    private func judgePremium(_ input: PremiumInput, clarifications: [VerdictRequest.Clarification]?, api: JudgeAPI, history: HistoryStore) {
        clarify = nil
        error = nil
        arrived = nil
        arrivedID = nil
        pending = nil
        isJudging = true
        let body = VerdictRequest(
            argument: input.argument,
            lang: input.lang,
            tier: Tier.premium.rawValue,
            clarifications: clarifications,
            evidence: input.evidence.isEmpty ? nil : input.evidence
        )
        let token = keys.key(for: IdempotencyKeys.canonical(body))
        let key = input.requestKey
        request = Task { [weak self] in
            await self?.judge(.post(body, idempotencyKey: token), requestKey: key, api: api, history: history)
        }
    }

    /// The POST, asked again every few seconds while the server
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

    /// A replayed verdict comes without its name map: the writer's
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
        case post(VerdictRequest, idempotencyKey: String)
        case resume(VerdictAccepted, idempotencyKey: String?)
    }

    /// The request behind the judging cover: the POST (unless resuming),
    /// then polling while the server judges. Cancelling the task (the close
    /// button) stops either.
    private func judge(
        _ start: Start,
        requestKey: RequestKey,
        api: JudgeAPI,
        history: HistoryStore
    ) async {
        // A verdict can take minutes: ask for background time so a short
        // app switch does not suspend the app and drop the connection.
        let background = BackgroundActivity(name: "verdict")
        defer { background.end() }
        // Any outcome (a refusal or failure gives the unit back) can change
        // the balance.
        defer { account?.refreshSoon() }
        var acceptedID: String?
        var idempotencyKey: String?
        do {
            let accepted: VerdictAccepted
            switch start {
            case .resume(let held, let token):
                accepted = held
                idempotencyKey = token
            case .post(let body, let token):
                idempotencyKey = token
                switch try await startPremium(body, idempotencyKey: token, api: api) {
                case .ready(let payload):
                    if let entitlement = payload.entitlement { account?.applyEntitlement(entitlement) }
                    var named = payload
                    if payload.replayed { named = await withNames(payload, api: api) }
                    guard !Task.isCancelled else { return }
                    keys.clear(token)
                    deliver(named, history: history)
                    return
                case .accepted(let fresh):
                    if let entitlement = fresh.entitlement { account?.applyEntitlement(entitlement) }
                    accepted = fresh
                    pending = PendingVerdict(accepted: fresh, key: requestKey, since: .now, idempotencyKey: token)
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
            deliver(payload, history: history)
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

    private func deliver(_ payload: VerdictPayload, history: HistoryStore) {
        let session = VerdictSession(id: payload.id, original: payload.result, nameMap: payload.nameMap, translations: [:])
        sessions[session.id] = session
        try? history.save(session)
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
        isCheckingQuestions = false
        isJudging = false
        arrived = nil
        arrivedID = nil
    }

    /// The header's "+" and "Start a new case": back to an empty form.
    func judgeAnother() {
        argument = ""
        otherSide = ""
        otherName = nil
        if caseName == exampleName { caseName = nil }
        exampleName = nil
        mode = .now
        error = nil
        clarify = nil
        evidence.clear()
        path.removeAll()
    }

    /// "Try an example": both names and both sides from a random example,
    /// over whatever was typed.
    func fillExample(lang: AppLang) {
        let example = ExampleCase.random(after: lastExample)
        lastExample = example.id
        caseName = example.myName(lang)
        exampleName = caseName
        argument = example.mine(lang)
        otherName = example.theirName(lang)
        otherSide = example.theirs(lang)
    }

    func dismissError() {
        error = nil
    }

    private func fail(_ failure: APIError) {
        isJudging = false
        if failure.code == "evidence_invalid" {
            // A token expired or failed its check: those images must be added again.
            evidence.invalidateTokens()
        }
        if case .server(let status, _) = failure, status == 401, let account {
            // signin_required, or sign_in_required from a server that wants
            // an account first. Sign-in comes up once the cover is gone.
            account.sessionExpired(presentAfter: .milliseconds(600))
            return
        }
        if case .server(let status, _) = failure, status == 402 {
            // no_credits or fair_use: the pricing screen answers it, not a
            // banner left over for when the user comes back with a pack.
            account?.refreshSoon()
            if path.last != .pricing { path.append(.pricing) }
            return
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
    func showJudgingForScreenshot() {
        judgedSides = Self.sides(mine: argument, theirs: otherSide, myName: caseName ?? "", theirName: otherName ?? "")
        isJudging = true
    }

    /// Screenshot fixtures: a fresh verdict.
    func showForScreenshot(thread session: VerdictSession) {
        sessions[session.id] = session
        path = [.verdict(id: session.id)]
    }

    /// Screenshot fixtures: the clarifying step without a request.
    func showForScreenshot(questions: [ClarifyQuestion], answers: [String: String] = [:]) {
        clarify = ClarifyState(questions: questions, answers: answers)
        premiumInput = PremiumInput(argument: argument, lang: .en, evidence: [])
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
