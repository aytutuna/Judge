package com.okjudge.judge.ui.history

import com.okjudge.judge.core.cases.CaseLogic
import com.okjudge.judge.core.display.Errors
import com.okjudge.judge.core.display.Party
import com.okjudge.judge.core.display.SealSide
import com.okjudge.judge.core.display.VerdictDisplay
import com.okjudge.judge.core.display.PartyNames
import com.okjudge.judge.core.display.RestoreNames
import com.okjudge.judge.core.data.SavedVerdict
import com.okjudge.judge.core.data.parseIso
import com.okjudge.judge.core.model.HistoryItem
import com.okjudge.judge.core.model.HistoryState
import com.okjudge.judge.core.model.Side
import com.okjudge.judge.i18n.AppLang
import com.okjudge.judge.i18n.Strings

/** Words of a Verdicts row from the viewer's side (stateLabel and fromRow in components/shell). */
object HistoryLabels {
    enum class Tone { YOURS, THEIRS, NEUTRAL, THINKING, WAITING, ATTENTION, MUTED }

    private fun text(item: HistoryItem): String? = item.headline ?: item.excerpt

    /** The row's state, with an invite whose time ran out read as expired (the cache may be older than that). */
    fun state(item: HistoryItem, now: Long = System.currentTimeMillis()): HistoryState? {
        val state = item.historyState
        val ends = item.expiresAt?.let(::parseIso)
        return if (state == HistoryState.WAITING && ends != null && ends <= now) HistoryState.EXPIRED else state
    }

    private fun parties(item: HistoryItem): Map<String, Party> =
        PartyNames.resolveParties(item.nameMap, CaseLogic.textLang(text(item).orEmpty()), item.party.uppercase(), item.manySides?.size ?: 2)

    private fun named(parties: Map<String, Party>, letter: String): String? =
        parties[letter]?.takeIf { !it.self }?.let { CaseLogic.firstNameOf(it.name) ?: it.name }

    /** The other party's first name, from the viewer's own names. */
    fun otherName(item: HistoryItem): String? =
        if (item.isMany) null else named(parties(item), if (item.party == "b") "A" else "B")

    /** The headline (or the start of the viewer's side) with their names put back. */
    fun title(item: HistoryItem, s: Strings, lang: AppLang): String {
        val text = text(item)
        if (text != null) {
            val textLang = CaseLogic.textLang(text)
            val sides = item.manySides?.size ?: 2
            return CaseLogic.localizeLabelsAuto(RestoreNames.restoreNames(text, parties(item), textLang, sides), sides)
        }
        return when {
            item.isCase -> Errors.formatDate(lang, item.at)?.let { s.caseListUntitled(it) } ?: s.caseListUntitledSoon
            item.historyState == HistoryState.REMOVED -> s.historyStateRemoved
            else -> s.shellUntitled
        }
    }

    fun title(entry: HistoryEntry, s: Strings, lang: AppLang): String = when (entry) {
        is HistoryEntry.Account -> title(entry.item, s, lang)
        is HistoryEntry.Phone -> title(entry.verdict, lang)
    }

    /** A verdict kept on the phone: its headline in the shown language. */
    fun title(verdict: SavedVerdict, lang: AppLang): String {
        val shown = verdict.translations[lang]?.result ?: verdict.original.result
        return RestoreNames.headline(shown, verdict.nameMap, verdict.lang)
    }

    /** The row's state in a few words; null when there is nothing to say. */
    fun status(item: HistoryItem, s: Strings, now: Long = System.currentTimeMillis()): String? {
        val other = otherName(item)
        return when (state(item, now)) {
            HistoryState.JUDGING -> s.historyStateJudging
            HistoryState.REJUDGING -> s.historyStateRejudging
            HistoryState.FAILED -> s.historyStateFailed
            HistoryState.REJUDGE_FAILED -> s.historyStateRejudgeFailed
            HistoryState.WAITING -> other?.let { s.historyStateWaiting(it) } ?: s.historyStateWaitingOther
            HistoryState.EXPIRED -> s.historyStateExpired
            // A removed verdict says so in its title already.
            HistoryState.REMOVED -> if (item.isCase) s.historyStateRemoved else null
            HistoryState.REMOVED_BY_OTHER -> other?.let { s.historyStateRemovedBy(it) } ?: s.historyStateRemovedByOther
            HistoryState.READY -> ruling(item, other, s)
            null -> null
        }
    }

    /** "You're right", "{name} is right", or the outcome itself. */
    private fun ruling(item: HistoryItem, other: String?, s: Strings): String {
        if (item.isMany) {
            // `verdict` is only the older projection here: the winner decides.
            val winner = Side.of(item.winner) ?: return s.verdictTooClose
            if (yours(item)) return s.verdictWinSelf
            return s.verdictWin(named(parties(item), winner.letter) ?: PartyNames.label(winner, s))
        }
        return rulingOf(item, other, s)
    }

    private fun rulingOf(item: HistoryItem, other: String?, s: Strings): String = when (item.verdict) {
        "side_a", "side_b" -> if (yours(item)) {
            // In a case the viewer is known to be their party: "You're right" even when they named themselves.
            val self = if (item.isCase) null else named(parties(item), if (item.party == "b") "B" else "A")
            self?.let { s.verdictWin(it) } ?: s.verdictWinSelf
        } else {
            s.verdictWin(other ?: if (item.party == "a") s.partyB else s.partyA)
        }
        "split" -> s.verdictSplit
        "conditional" -> s.verdictConditional
        "dissolved" -> s.verdictDissolved
        "too_close" -> s.verdictTooClose
        else -> s.historyStateReady
    }

    private fun yours(item: HistoryItem): Boolean {
        // For more than two sides `verdict` is only the older projection: the winner decides.
        if (item.isMany) return item.winner == item.party
        return item.verdict == (if (item.party == "b") "side_b" else "side_a")
    }

    fun tone(item: HistoryItem, now: Long = System.currentTimeMillis()): Tone = when (state(item, now)) {
        HistoryState.READY -> when {
            item.isMany -> if (item.winner == null) Tone.NEUTRAL else if (yours(item)) Tone.YOURS else Tone.THEIRS
            item.verdict == "side_a" || item.verdict == "side_b" -> if (yours(item)) Tone.YOURS else Tone.THEIRS
            else -> Tone.NEUTRAL
        }
        HistoryState.JUDGING, HistoryState.REJUDGING -> Tone.THINKING
        HistoryState.WAITING -> Tone.WAITING
        HistoryState.FAILED, HistoryState.REJUDGE_FAILED -> Tone.ATTENTION
        HistoryState.EXPIRED, HistoryState.REMOVED, HistoryState.REMOVED_BY_OTHER, null -> Tone.MUTED
    }

    /** What a row of either kind says about itself, for the side menu's cards. */
    fun status(entry: HistoryEntry, s: Strings, now: Long = System.currentTimeMillis()): String? = when (entry) {
        is HistoryEntry.Account -> status(entry.item, s, now)
        is HistoryEntry.Phone -> {
            val saved = entry.verdict
            val result = saved.original.result
            VerdictDisplay.verdictLabel(result, PartyNames.partyNames(saved.nameMap, saved.lang, s, result.sideCount), s)
        }
    }

    /** Whose way the ruling went; a phone row's Party A is the writer. */
    fun tone(entry: HistoryEntry, now: Long = System.currentTimeMillis()): Tone = when (entry) {
        is HistoryEntry.Account -> tone(entry.item, now)
        is HistoryEntry.Phone -> when (VerdictDisplay.sealOf(entry.verdict.original.result)) {
            SealSide.A -> Tone.YOURS
            SealSide.B, SealSide.C, SealSide.D -> Tone.THEIRS
            SealSide.NONE -> Tone.NEUTRAL
        }
    }

    /** Small tags after the date: "You answered", "After new context". */
    fun tags(item: HistoryItem, s: Strings): List<String> = listOfNotNull(
        s.historyAnswered.takeIf { item.isRespondent },
        s.historyContextAdded.takeIf { item.contextAdded && item.historyState == HistoryState.READY },
    )

    /** Removed and expired rows are drawn muted. */
    fun muted(item: HistoryItem, now: Long = System.currentTimeMillis()): Boolean = item.removed || state(item, now) == HistoryState.EXPIRED

    /** Whether tapping it opens something: the verdict, the case, or the answered case's page. */
    fun openable(item: HistoryItem): Boolean = when {
        !item.isCase -> !item.removed && item.historyState != HistoryState.JUDGING && item.historyState != HistoryState.FAILED
        item.isRespondent -> item.inviteToken != null
        else -> true
    }

    /** The confirm text for removing [picked]: account rows leave the account, phone rows only the phone. */
    fun removeConfirm(picked: List<HistoryEntry>, s: Strings): String {
        val account = picked.count { it is HistoryEntry.Account }
        val phone = picked.size - account
        if (account == 0) return s.appHistoryDeleteConfirm(phone)
        return listOfNotNull(s.appHistoryRemoveConfirm(account), if (phone > 0) s.appHistoryPhoneOnlyAlso(phone) else null).joinToString(" ")
    }
}
