import Foundation

/// Words of a Verdicts row from the viewer's side (stateLabel and fromRow in
/// components/shell on the web).
enum HistoryLabels {
    enum Tone: Equatable {
        case yours, theirs, neutral, thinking, waiting, attention, muted
    }

    private static func text(_ item: HistoryItem) -> String? { item.headline ?? item.excerpt }

    private static func parties(_ item: HistoryItem) -> [String: Names.Resolved] {
        Names.resolveParties(item.nameMap, selfLang: ContentLang.of(text(item) ?? ""), selfParty: item.party == "b" ? "B" : "A")
    }

    private static func named(_ parties: [String: Names.Resolved], _ letter: String) -> String? {
        guard let party = parties[letter], !party.isSelf else { return nil }
        return Names.firstName(party.name) ?? party.name
    }

    /// The other party's first name, from the viewer's own names.
    static func otherName(_ item: HistoryItem) -> String? {
        named(parties(item), item.party == "b" ? "A" : "B")
    }

    /// The row's state, with an invite whose time ran out read as expired
    /// (the cached list may be older than that).
    static func state(_ item: HistoryItem, now: Date) -> HistoryState? {
        let state = item.historyState
        if state == .waiting, let ends = item.expiresAt.flatMap(ErrorText.parseISO), ends <= now { return .expired }
        return state
    }

    /// The headline (or the start of the viewer's side) with their names put back.
    static func title(_ item: HistoryItem, lang: AppLang) -> String {
        if let text = text(item), !text.isEmpty {
            let textLang = ContentLang.of(text)
            let restored = Names.restoreNames(text, parties: parties(item), textLang: textLang)
            return CaseLogic.localizeLabels(restored, lang: ContentLang.of(restored))
        }
        if item.isCase {
            if let date = ErrorText.formatDate(item.at, lang: lang) { return L10n.caseListUntitled(lang, date: date) }
            return L10n.caseListUntitledSoon(lang)
        }
        return item.historyState == .removed ? L10n.historyStateRemoved(lang) : L10n.shellUntitled(lang)
    }

    /// The row's state in a few words; nil when there is nothing to say.
    static func status(_ item: HistoryItem, lang: AppLang, now: Date) -> String? {
        let other = otherName(item)
        switch state(item, now: now) {
        case .judging: return L10n.historyStateJudging(lang)
        case .rejudging: return L10n.historyStateRejudging(lang)
        case .failed: return L10n.historyStateFailed(lang)
        case .rejudgeFailed: return L10n.historyStateRejudgeFailed(lang)
        case .waiting: return other.map { L10n.historyStateWaiting(lang, name: $0) } ?? L10n.historyStateWaitingOther(lang)
        case .expired: return L10n.historyStateExpired(lang)
        // A removed verdict says so in its title already.
        case .removed: return item.isCase ? L10n.historyStateRemoved(lang) : nil
        case .removedByOther: return other.map { L10n.historyStateRemovedBy(lang, name: $0) } ?? L10n.historyStateRemovedByOther(lang)
        case .ready: return ruling(item, other: other, lang: lang)
        case nil: return nil
        }
    }

    private static func yours(_ item: HistoryItem) -> Bool {
        item.verdict == (item.party == "b" ? "side_b" : "side_a")
    }

    /// "You're right", "{name} is right", or the outcome itself.
    private static func ruling(_ item: HistoryItem, other: String?, lang: AppLang) -> String {
        switch item.finalVerdict {
        case .sideA, .sideB:
            if yours(item) {
                // In a case the viewer is known to be their party: "You're right" even when they named themselves.
                let own = item.isCase ? nil : named(parties(item), item.party == "b" ? "B" : "A")
                return own.map { L10n.verdictWin(lang, name: $0) } ?? L10n.verdictWinSelf(lang)
            }
            return L10n.verdictWin(lang, name: other ?? (item.party == "a" ? L10n.partyB(lang) : L10n.partyA(lang)))
        case .split: return L10n.verdictSplit(lang)
        case .conditional: return L10n.verdictConditional(lang)
        case .dissolved: return L10n.verdictDissolved(lang)
        case .tooClose: return L10n.verdictTooClose(lang)
        case .unknown, nil: return L10n.historyStateReady(lang)
        }
    }

    static func tone(_ item: HistoryItem, now: Date) -> Tone {
        switch state(item, now: now) {
        case .ready:
            switch item.finalVerdict {
            case .sideA, .sideB: return yours(item) ? .yours : .theirs
            default: return .neutral
            }
        case .judging, .rejudging: return .thinking
        case .waiting: return .waiting
        case .failed, .rejudgeFailed: return .attention
        case .expired, .removed, .removedByOther, nil: return .muted
        }
    }

    /// Small tags after the date: "You answered", "After new context".
    static func tags(_ item: HistoryItem, lang: AppLang) -> [String] {
        var tags: [String] = []
        if item.isRespondent { tags.append(L10n.historyAnswered(lang)) }
        if item.contextAdded, item.historyState == .ready { tags.append(L10n.historyContextAdded(lang)) }
        return tags
    }

    /// Removed and expired rows are drawn muted.
    static func muted(_ item: HistoryItem, now: Date) -> Bool {
        item.removed || state(item, now: now) == .expired
    }

    /// Whether tapping it opens something: the verdict, the case, or the
    /// answered case's page on the website.
    static func openable(_ item: HistoryItem) -> Bool {
        if !item.isCase { return !item.removed && item.historyState != .judging && item.historyState != .failed }
        if item.isRespondent { return item.inviteToken != nil }
        return true
    }

    /// The confirm text for removing `picked`: account rows leave the
    /// account, phone rows only the phone.
    static func removeConfirm(_ picked: [HistoryEntry], lang: AppLang) -> String {
        let phone = picked.filter(\.isPhone).count
        let account = picked.count - phone
        if account == 0 { return L10n.appHistoryDeleteConfirm(lang, n: phone) }
        let removing = L10n.appHistoryRemoveConfirm(lang, n: account)
        return phone > 0 ? removing + " " + L10n.appHistoryPhoneOnlyAlso(lang, n: phone) : removing
    }
}
