import Foundation
import Observation

/// "Add context" on the writer's one-sided verdict (useVerdictAppeal in
/// components/VerdictAppeal.tsx): the rounds and the writer's gate from
/// GET /api/v1/verdicts/{id}, the case appeal's form and states, and each
/// round polled like an async verdict. A round's verdict goes to
/// `onRuling`, which shows it and saves it into the history entry.
@MainActor
@Observable
final class VerdictAppealModel: AppealDraft {
    let id: String
    /// Nil until read; the gate inside is nil for anyone but the writer.
    private(set) var rounds: VerdictRounds?
    /// "Add context" was tapped (or the last round failed): the form is out.
    private(set) var open = false
    /// A round just finished: its verdict is the shown one now.
    private(set) var finished = false

    var appealText = ""
    let appealEvidence: EvidenceModel
    private(set) var appealSending = false
    private(set) var appealError: APIError?

    /// Off for screenshot states.
    @ObservationIgnored var usesNetwork = true
    @ObservationIgnored private let api: JudgeAPI
    @ObservationIgnored private weak var account: AccountModel?
    @ObservationIgnored private let keys = IdempotencyKeys()
    /// The 202 of the round sent from here: its names and first wait.
    @ObservationIgnored private var sent: VerdictAccepted?
    @ObservationIgnored private let shown: @MainActor () -> VerdictSession
    @ObservationIgnored private let onRuling: @MainActor (VerdictSession) -> Void

    init(
        id: String,
        api: JudgeAPI,
        account: AccountModel?,
        shown: @escaping @MainActor () -> VerdictSession,
        onRuling: @escaping @MainActor (VerdictSession) -> Void
    ) {
        self.id = id
        self.api = api
        self.account = account
        self.shown = shown
        self.onRuling = onRuling
        appealEvidence = EvidenceModel(max: CaseLogic.maxAppealEvidence)
    }

    var area: CaseLogic.AppealArea {
        guard let rounds else { return .none }
        return CaseLogic.appealArea(rounds)
    }

    /// The card's "Add context": the writer only.
    var offered: Bool { area != .none }

    /// The area under the verdict: opened, or while the judges re-judge.
    var panel: Bool { area != .none && (open || area == .judging) }

    /// The round being judged right now.
    var judgingID: String? { rounds?.appeals.last(where: { $0.status == .judging })?.id }

    func openForm() {
        open = true
    }

    /// Reads the rounds. A round that finished while the app was away (or on
    /// the website) becomes the shown verdict.
    func load() async {
        guard usesNetwork, let fresh = try? await api.verdictRounds(id: id) else { return }
        rounds = fresh
        guard !fresh.appeals.contains(where: { $0.status == .judging }),
              let latest = fresh.appeals.last(where: { $0.status == .judged }),
              shown().currentID != latest.id,
              let stored = try? await api.storedVerdict(id: latest.id),
              shown().currentID != latest.id
        else { return }
        onRuling(shown().withRuling(VerdictPayload(id: latest.id, result: stored.result, nameMap: [])))
    }

    /// Polls the round being judged to its end: its verdict is shown, a
    /// failed one opens the form again (it says the credit is back).
    func follow(_ roundID: String) async {
        let accepted = sent.flatMap { $0.id == roundID ? $0 : nil } ?? VerdictAccepted(id: roundID, nameMap: [], pollAfterMs: 0)
        do {
            let payload = try await api.awaitVerdict(accepted)
            sent = nil
            onRuling(shown().withRuling(payload))
            open = false
            finished = true
        } catch {
            if APIError.isCancellation(error) || Task.isCancelled { return }
            open = true
        }
        await load()
    }

    var appealCanSubmit: Bool {
        CaseLogic.appealTextFits(appealText) && !appealSending && !appealEvidence.busy
    }

    /// POST the context with an Idempotency-Key (one per exact body). The
    /// screen then follows the new round.
    func submitAppeal() async {
        guard appealCanSubmit else { return }
        let text = appealText.trimmingCharacters(in: .whitespacesAndNewlines)
        let evidence = appealEvidence.tokens
        let key = keys.key(for: JudgeAPI.canonical(JudgeAPI.appealBody(text: text, evidence: evidence)))
        appealSending = true
        appealError = nil
        finished = false
        defer { appealSending = false }
        do {
            let answer = try await api.appealVerdict(id: id, text: text, evidence: evidence, idempotencyKey: key)
            keys.clear(key)
            if let entitlement = answer.accepted.entitlement { account?.applyEntitlement(entitlement) }
            appealText = ""
            appealEvidence.clear()
            sent = answer.accepted
            rounds = VerdictRounds(appeals: answer.appeals, gate: CaseAppealGate(allowed: false, blockedBy: "busy"))
            // A replay of a round already judged: catch up instead of polling.
            if answer.appeal.status != .judging { await load() }
        } catch {
            if APIError.isCancellation(error) { return }
            let failure = (error as? APIError) ?? .malformed
            if failure.code == "signin_required" {
                account?.sessionExpired()
            } else if case .server(let status, _) = failure, status == 402 {
                account?.refreshSoon()
            }
            if failure.code == "evidence_invalid" { appealEvidence.invalidateTokens() }
            appealError = failure
            // Another round or the limit got there first: the gate says so now.
            if failure.code == "appeal_limit" || failure.code == "in_progress" { await load() }
        }
    }
}

#if DEBUG
extension VerdictAppealModel {
    /// Screenshot fixtures: the writer's gate without a request, the form out.
    func showForScreenshot(gate: CaseAppealGate, text: String = "") {
        rounds = VerdictRounds(appeals: [], gate: gate)
        appealText = text
        open = true
    }
}
#endif
