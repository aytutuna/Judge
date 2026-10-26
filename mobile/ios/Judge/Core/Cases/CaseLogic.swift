import Foundation

/// Pure decisions of the case page: polling (lib/use-case.ts), load
/// failures and the appeal area (components/case/AppealForm.tsx appealArea).
enum CaseLogic {
    /// Longest wait between polls after repeated failures (MAX_POLL_BACKOFF_MS).
    static let maxBackoffMs: Double = 30_000

    /// Milliseconds until the next poll, or nil for none. `failures` counts
    /// failed refreshes in a row since the last good one.
    static func nextPollDelay(_ view: CaseView?, failures: Int) -> Double? {
        guard let wait = view?.pollAfterMs else { return nil }
        let base = max(1000, wait)
        guard failures > 0 else { return base }
        return min(maxBackoffMs, base * pow(2, Double(min(failures, 5))))
    }

    enum LoadFailure: Equatable {
        /// 404: deleted, or another account's case.
        case missing
        /// 401: sign in to see it.
        case signIn
        /// Anything else, with no view to keep showing.
        case error
    }

    static func loadFailure(_ error: APIError) -> LoadFailure {
        if case .server(let status, _) = error {
            if status == 404 || error.code == "not_found" { return .missing }
            if status == 401 || error.code == "signin_required" { return .signIn }
        }
        return .error
    }

    /// What the appeal area shows for a case view or a one-sided verdict.
    enum AppealArea: Equatable {
        case none
        /// The viewer's own context is being judged.
        case judging
        /// `failed`: the last try failed ("refused" or "failed").
        case form(failed: String?)
        case upsell(signIn: Bool)
        /// premium_required, no_credits or fair_use (the owner has an
        /// account and sees why).
        case blocked(reason: String)
        case used
        /// A verdict that already took context twice.
        case limit
        case busy
    }

    static func appealArea(_ view: CaseView) -> AppealArea {
        guard view.status == .judged else { return .none }
        let mine = view.appeals.last { $0.party == view.yourParty }
        return appealArea(
            judging: view.appealJudging, mine: mine?.status, error: mine?.error,
            gate: view.appeal, respondent: view.role == .respondent
        )
    }

    /// A one-sided verdict for its writer (useVerdictAppeal): the latest
    /// round stands for theirs. Nothing for anyone else.
    static func appealArea(_ rounds: VerdictRounds) -> AppealArea {
        guard let gate = rounds.gate else { return .none }
        let latest = rounds.appeals.last
        return appealArea(
            judging: rounds.appeals.contains { $0.status == .judging }, mine: latest?.status, error: latest?.error,
            gate: gate, respondent: false
        )
    }

    private static func appealArea(judging: Bool, mine: CaseAppealStatus?, error: String?, gate: CaseAppealGate, respondent: Bool) -> AppealArea {
        if judging {
            return mine == .judging ? .judging : .busy
        }
        if gate.allowed {
            let failed: String? = mine == .failed ? (error == "refused" ? "refused" : "failed") : nil
            return .form(failed: failed)
        }
        switch gate.blockedBy {
        case "signin_required":
            return .upsell(signIn: true)
        case "premium_required", "no_credits", "fair_use":
            let reason = gate.blockedBy ?? "premium_required"
            return respondent ? .upsell(signIn: false) : .blocked(reason: reason)
        case "appeal_used":
            return .used
        case "appeal_limit":
            return .limit
        case "busy":
            return .busy
        default:
            // claim_required: the website claims with the owner token, which the app never keeps.
            return .none
        }
    }

    /// The held-unit line under the invite. Only a premium case holds a
    /// unit, so a free case never mentions credits.
    static func heldNote(_ view: CaseView, lang: AppLang) -> String? {
        guard view.tier == .premium else { return nil }
        return ErrorText.formatDate(view.expiresAt, lang: lang).map { L10n.caseHeld(lang, date: $0) } ?? L10n.caseHeldSoon(lang)
    }

    static func failedBody(_ view: CaseView, lang: AppLang) -> String {
        if view.lastError == "quota" { return L10n.errorQuota(lang) }
        return view.tier == .premium ? L10n.caseFailedBody(lang) : L10n.caseFailedBodyFree(lang)
    }

    static func expiredBody(_ view: CaseView, lang: AppLang) -> String {
        view.tier == .premium ? L10n.caseExpiredBody(lang) : L10n.caseExpiredBodyFree(lang)
    }

    /// Text and button of the "judge with only my side" confirm. Waiting: the
    /// held unit pays and the invite closes. Expired: the held unit went
    /// back, so a premium case spends a new one; a free case spends nothing.
    static func judgeNowConfirm(expired: Bool, tier: Tier, lang: AppLang) -> (text: String, yes: String) {
        guard expired else { return (L10n.caseJudgeNowConfirm(lang), L10n.caseJudgeNowYes(lang)) }
        if tier == .premium { return (L10n.caseJudgeExpiredConfirm(lang), L10n.caseJudgeExpiredYes(lang)) }
        return (L10n.caseJudgeExpiredConfirmFree(lang), L10n.caseJudgeNowYes(lang))
    }

    /// Whether the appeal form offers a screenshot: the deployment takes
    /// evidence and the case is premium (the server refuses it on a free one).
    static func appealEvidenceOn(_ view: CaseView, features: PremiumFeatures) -> Bool {
        features.evidence && view.tier == .premium
    }

    /// Whether the owner can remove their side right now.
    static func canRemove(_ view: CaseView) -> Bool {
        view.status != .judging && !view.appealJudging && view.removed == nil
    }

    /// The names to restore into a case's verdicts: the server's encrypted
    /// copy when it sent one, else what this phone kept.
    static func names(_ view: CaseView, local: [NameMapping]) -> [NameMapping] {
        if let names = view.names, !names.isEmpty { return names }
        return local
    }

    /// MIN_APPEAL_CHARS / MAX_APPEAL_CHARS (lib/case-types.ts).
    static let minAppeal = 20
    static let maxAppeal = 2000
    /// MAX_EVIDENCE_PER_APPEAL.
    static let maxAppealEvidence = 1

    /// Whether the appeal text is long enough and not too long (trimmed,
    /// counted in UTF-16 like the server).
    static func appealTextFits(_ text: String) -> Bool {
        let count = text.trimmingCharacters(in: .whitespacesAndNewlines).utf16.count
        return count >= minAppeal && count <= maxAppeal
    }

    /// Title of a list entry: the anonymized verdict headline, else the
    /// first words of the owner's side, else "Case from {date}".
    static func listTitle(_ summary: CaseSummary, lang: AppLang) -> String {
        if let headline = summary.headline, !headline.isEmpty { return headline }
        if let excerpt = summary.excerpt, !excerpt.isEmpty { return localizeLabels(excerpt, lang: ContentLang.of(excerpt)) }
        if let date = ErrorText.formatDate(summary.createdAt, lang: lang) { return L10n.caseListUntitled(lang, date: date) }
        return L10n.caseListUntitledSoon(lang)
    }

    /// "Party A" / "Person C" written in `lang` ("Taraf A" / "Kişi C" in
    /// Turkish), as localizeLabels does on the web. A word that is not a
    /// label ("Party C") stays as it is.
    static func localizeLabels(_ text: String, lang: AppLang) -> String {
        guard !text.isEmpty,
              let pattern = try? NSRegularExpression(pattern: "(?<!\\p{L})(Party|Taraf|Person|Kişi) ([A-Z])(?!\\p{L})")
        else { return text }
        let source = text as NSString
        let matches = pattern.matches(in: text, range: NSRange(location: 0, length: source.length))
        guard !matches.isEmpty else { return text }
        let out = NSMutableString(string: text)
        for match in matches.reversed() {
            let word = source.substring(with: match.range(at: 1))
            let letter = source.substring(with: match.range(at: 2))
            let party = word == "Party" || word == "Taraf"
            guard party == (letter == "A" || letter == "B") else { continue }
            let label = lang == .tr ? (party ? "Taraf" : "Kişi") : (party ? "Party" : "Person")
            out.replaceCharacters(in: match.range, with: "\(label) \(letter)")
        }
        return out as String
    }

    static func statusText(_ status: CaseStatus, lang: AppLang) -> String {
        switch status {
        case .awaitingRespondent: return L10n.caseStatusAwaiting(lang)
        case .judging: return L10n.caseStatusJudging(lang)
        case .judged: return L10n.caseStatusJudged(lang)
        case .failed: return L10n.caseStatusFailed(lang)
        case .expired, .unknown: return L10n.caseStatusExpired(lang)
        }
    }
}
