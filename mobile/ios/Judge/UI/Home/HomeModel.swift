import Foundation
import Observation
import UIKit

enum HomeRoute: Hashable {
    case verdict(id: String)
}

/// The Home flow: argument, preset, the pending request and its outcome.
/// Owned by `AppModel` so a verdict in progress survives tab switches.
@MainActor
@Observable
final class HomeModel {
    static let maxLength = 6000
    static let minLength = 20
    /// The counter turns terracotta above this.
    static let warnLength = 5700

    var argument = ""
    var preset: String
    var path: [HomeRoute] = []

    /// The bot check is running (before the judging cover goes up).
    private(set) var isCheckingBot = false
    /// Shows the judging cover.
    var isJudging = false
    /// The verdict, once it has arrived (the cover then plays its finish).
    /// Kept until the next submit or cancel, so the cover keeps its final
    /// frame while it animates out.
    private(set) var arrived: VerdictResult?
    private(set) var error: APIError?
    private(set) var blockedUntil: Date?

    @ObservationIgnored private var sessions: [String: VerdictSession] = [:]
    @ObservationIgnored private var arrivedID: String?
    @ObservationIgnored private var request: Task<Void, Never>?
    @ObservationIgnored private var unblock: Task<Void, Never>?
    @ObservationIgnored private var pending: PendingVerdict?
    /// Told when the server refuses the session (401 signin_required).
    @ObservationIgnored private weak var account: AccountModel?

    /// What was asked: "Try again" with the same request resumes its verdict.
    private struct RequestKey: Equatable {
        let text: String
        let preset: String
        let lang: AppLang
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
    }

    /// UTF-16 length, as the website's `maxLength` and the server count it.
    var length: Int { argument.utf16.count }

    var trimmedLength: Int { argument.trimmingCharacters(in: .whitespacesAndNewlines).utf16.count }

    func canSubmit(now: Date = .now) -> Bool {
        guard trimmedLength >= Self.minLength, length <= Self.maxLength, !isJudging, !isCheckingBot else { return false }
        if let blockedUntil, blockedUntil > now { return false }
        return true
    }

    /// Hard cap at 6000 UTF-16 units, cutting whole characters: one cut at
    /// the last character boundary at or before the limit.
    static func capped(_ text: String) -> String {
        let utf16 = text.utf16
        guard utf16.count > maxLength else { return text }
        var end = utf16.index(utf16.startIndex, offsetBy: maxLength)
        while String.Index(end, within: text) == nil {
            end = utf16.index(before: end)
        }
        return String(text[..<end])
    }

    func session(_ id: String) -> VerdictSession? { sessions[id] }

    func updateSession(_ session: VerdictSession) {
        sessions[session.id] = session
    }

    /// Starts a free verdict. The request is sent once; "Try again" is the
    /// only retry, and it is the user's. When the same request was already
    /// accepted, it polls for that verdict instead.
    ///
    /// The bot check runs first, with Home still on screen: its interactive
    /// sheet is presented from the root view, which cannot present while the
    /// judging cover is up. The cover goes up once there is a token.
    ///
    /// Verdicts need an account: signed out, this opens sign-in and submits
    /// once the user has signed in.
    func submit(app: AppModel) {
        guard canSubmit() else { return }
        account = app.account
        guard app.account.isSignedIn else {
            app.account.requireSignIn { [weak self, weak app] in
                guard let self, let app else { return }
                self.submit(app: app)
            }
            return
        }
        error = nil
        arrived = nil
        arrivedID = nil
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
                await self?.judge(.resume(held.accepted), key: key, api: api, history: history, preset: preset)
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
            await self.judge(.post(body), key: key, api: api, history: history, preset: preset)
        }
    }

    private enum Start {
        case post(VerdictRequest)
        case resume(VerdictAccepted)
    }

    /// The request behind the judging cover: the POST (unless resuming),
    /// then polling while the server judges. Cancelling the task (the close
    /// button) stops either.
    private func judge(_ start: Start, key: RequestKey, api: JudgeAPI, history: HistoryStore, preset: String) async {
        // A verdict can take minutes: ask for background time so a short
        // app switch does not suspend the app and drop the connection.
        let background = BackgroundActivity(name: "verdict")
        defer { background.end() }
        var acceptedID: String?
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
                    pending = PendingVerdict(accepted: fresh, key: key, since: .now)
                }
            }
            acceptedID = accepted.id
            let payload = try await api.awaitVerdict(accepted)
            // Closed at the last moment: keep the id so the same request
            // picks the finished verdict up.
            guard !Task.isCancelled else { return }
            if pending?.accepted.id == accepted.id { pending = nil }
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
        isJudging = false
        arrived = nil
        arrivedID = nil
    }

    /// "Judge another": back to an empty form.
    func judgeAnother() {
        argument = ""
        error = nil
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
