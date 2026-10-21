import Foundation
import Observation

/// One case page for its owner (components/case/CaseScreen.tsx and
/// lib/use-case.ts): the view from GET /api/v1/cases/{id}, kept fresh while
/// something is judging (the server's pollAfterMs, backing off to 30 s on
/// failures), and the owner's actions. An action that answers with a new
/// view swaps it in and restarts polling.
@MainActor
@Observable
final class CaseModel {
    enum Load: Equatable {
        case loading, ready, missing, signIn, error
    }

    /// Why saving the display name failed.
    enum DisplayFailure: Equatable {
        case invalid
        case server(APIError)
        case failed

        func message(_ lang: AppLang) -> String {
            switch self {
            case .invalid: return L10n.namesInvalid(lang)
            case .server(let error): return ErrorText.message(error, lang: lang)
            case .failed: return L10n.namesFailed(lang)
            }
        }
    }

    let id: String
    private(set) var load: Load
    private(set) var view: CaseView?
    /// The names this phone kept for the case (the fallback for `view.names`).
    private(set) var localNames: [NameMapping]
    private(set) var busy = false
    private(set) var actionError: APIError?
    private(set) var resetDone = false
    /// The owner removed the case on this screen just now.
    private(set) var removedNow = false
    /// Bumped when an action swaps in a new view: the screen restarts polling.
    private(set) var generation = 0

    /// The "add context" form.
    var appealText = ""
    let appealEvidence: EvidenceModel
    private(set) var appealSending = false
    private(set) var appealError: APIError?

    /// The owner's name on the share pages, while being edited.
    var displayNameDraft: String?
    private(set) var displayBusy = false
    private(set) var displayFailure: DisplayFailure?
    private(set) var displaySaved = false

    /// Off for screenshot states: no fetches, no polling.
    @ObservationIgnored var usesNetwork = true
    @ObservationIgnored private var failures = 0
    @ObservationIgnored private var loadedOnce = false
    @ObservationIgnored private let keys = IdempotencyKeys()
    @ObservationIgnored private let api: JudgeAPI
    @ObservationIgnored private let namesStore: any CaseNamesStore
    @ObservationIgnored private weak var account: AccountModel?

    init(id: String, api: JudgeAPI, namesStore: any CaseNamesStore, account: AccountModel?, initial: CaseView? = nil) {
        self.id = id
        self.api = api
        self.namesStore = namesStore
        self.account = account
        view = initial
        load = initial == nil ? .loading : .ready
        localNames = namesStore.names(caseID: id)
        appealEvidence = EvidenceModel(max: CaseLogic.maxAppealEvidence)
    }

    /// Party A's names for the verdicts: the server's copy, else this phone's.
    var names: [NameMapping] {
        guard let view else { return localNames }
        return CaseLogic.names(view, local: localNames)
    }

    // MARK: - Loading and polling

    /// Loads the case when there is none yet, then polls while the server
    /// asks for it. Runs until cancelled (the screen goes away) or nothing
    /// is being judged anymore.
    func run() async {
        guard usesNetwork else { return }
        // A view created on this phone shows at once; it is refreshed once anyway.
        if !loadedOnce {
            loadedOnce = true
            await reload()
        }
        while !Task.isCancelled, let delay = CaseLogic.nextPollDelay(view, failures: failures) {
            do {
                try await Task.sleep(for: .milliseconds(Int(delay)))
            } catch {
                return
            }
            await reload()
        }
    }

    /// GET the case once. A failed refresh keeps the last view.
    func reload() async {
        do {
            let fresh = try await api.fetchCase(id: id)
            failures = 0
            view = fresh
            load = .ready
        } catch let error as APIError {
            failures += 1
            switch CaseLogic.loadFailure(error) {
            case .missing:
                view = nil
                load = .missing
            case .signIn:
                view = nil
                load = .signIn
                if error.code == "signin_required", account?.isSignedIn == true { account?.sessionExpired() }
            case .error:
                if view == nil { load = .error }
            }
        } catch is CancellationError {
            return
        } catch {
            failures += 1
            if view == nil { load = .error }
        }
    }

    private func apply(_ fresh: CaseView) {
        view = fresh
        load = .ready
        failures = 0
        generation += 1
    }

    // MARK: - Actions

    /// "Judge with only my side" (awaiting or expired; the confirm is the
    /// screen's), or "Try again" on a failed case.
    func judge(onlyMine: Bool) async {
        await act { api, id in try await api.judgeCase(id: id, onlyMine: onlyMine) }
    }

    /// "Make a new link": the old one stops working.
    func resetInvite() async {
        guard !busy else { return }
        resetDone = false
        busy = true
        actionError = nil
        defer { busy = false }
        do {
            let url = try await api.rotateInvite(id: id)
            view?.inviteUrl = url
            resetDone = true
        } catch {
            fail(error)
        }
    }

    /// Removes the owner's side: blanked, and every link of the case closes.
    func remove() async {
        let removed = await act { api, id in try await api.removeCase(id: id) }
        guard removed else { return }
        namesStore.forget(caseID: id)
        localNames = []
        removedNow = true
    }

    @discardableResult
    private func act(_ call: (JudgeAPI, String) async throws -> CaseView) async -> Bool {
        guard !busy else { return false }
        busy = true
        actionError = nil
        defer { busy = false }
        do {
            apply(try await call(api, id))
            return true
        } catch {
            fail(error)
            return false
        }
    }

    /// 401 ends the session; 402 means the balance on screen is stale.
    private func fail(_ error: any Error) {
        if APIError.isCancellation(error) { return }
        let failure = (error as? APIError) ?? .malformed
        if failure.code == "signin_required" {
            account?.sessionExpired()
        } else if case .server(let status, _) = failure, status == 402 {
            account?.refreshSoon()
        }
        actionError = failure
    }

    // MARK: - Adding context

    var appealCanSubmit: Bool {
        CaseLogic.appealTextFits(appealText) && !appealSending && !appealEvidence.busy
    }

    /// POST the context with an Idempotency-Key (one per exact body), keep
    /// the names it returns and swap in the re-judging view.
    func submitAppeal() async {
        guard appealCanSubmit else { return }
        let text = appealText.trimmingCharacters(in: .whitespacesAndNewlines)
        let evidence = appealEvidence.tokens
        let key = keys.key(for: JudgeAPI.canonical(JudgeAPI.appealBody(text: text, evidence: evidence)))
        appealSending = true
        appealError = nil
        defer { appealSending = false }
        do {
            let answer = try await api.appealCase(id: id, text: text, evidence: evidence, idempotencyKey: key)
            keys.clear(key)
            namesStore.save(caseID: id, answer.nameMap)
            localNames = namesStore.names(caseID: id)
            if let entitlement = answer.entitlement { account?.applyEntitlement(entitlement) }
            appealText = ""
            appealEvidence.clear()
            apply(answer.view)
        } catch {
            if APIError.isCancellation(error) { return }
            let failure = (error as? APIError) ?? .malformed
            if failure.code == "signin_required" {
                account?.sessionExpired()
            } else if case .server(let status, _) = failure, status == 402 {
                account?.refreshSoon()
            }
            appealError = failure
        }
    }

    // MARK: - Names on the share pages

    /// Saves the owner's display name (empty clears it).
    func saveDisplayName() async {
        let value = (displayNameDraft ?? view?.display.a ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        await sendDisplay(name: value.isEmpty ? nil : value, clear: value.isEmpty, namesVisible: nil)
    }

    func setNamesVisible(_ visible: Bool) async {
        await sendDisplay(name: nil, clear: false, namesVisible: visible)
    }

    private func sendDisplay(name: String?, clear: Bool, namesVisible: Bool?) async {
        guard !displayBusy else { return }
        displayBusy = true
        displayFailure = nil
        displaySaved = false
        defer { displayBusy = false }
        do {
            let fresh = try await api.updateCaseDisplay(id: id, displayName: name, clearName: clear, namesVisible: namesVisible)
            apply(fresh)
            displayNameDraft = nil
            displaySaved = true
        } catch let error as APIError {
            if error.code == "signin_required" { account?.sessionExpired() }
            displayFailure = error.code == "invalid" ? .invalid : .server(error)
        } catch {
            if APIError.isCancellation(error) { return }
            displayFailure = .failed
        }
    }
}
