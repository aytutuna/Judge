package com.okjudge.judge.ui.verdict

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.okjudge.judge.core.api.ApiResult
import com.okjudge.judge.core.api.JudgeApi
import com.okjudge.judge.core.api.PollOutcome
import com.okjudge.judge.core.cases.AppealArea
import com.okjudge.judge.core.cases.CaseLogic
import com.okjudge.judge.core.data.HistoryRepository
import com.okjudge.judge.core.display.Errors
import com.okjudge.judge.core.display.UiError
import com.okjudge.judge.core.evidence.EvidenceController
import com.okjudge.judge.core.evidence.ImageSource
import com.okjudge.judge.core.model.AppealGate
import com.okjudge.judge.core.model.AppealRequest
import com.okjudge.judge.core.model.Entitlement
import com.okjudge.judge.core.model.VerdictAccepted
import com.okjudge.judge.core.model.VerdictOutcome
import com.okjudge.judge.core.model.VerdictPoll
import com.okjudge.judge.core.model.VerdictRounds
import com.okjudge.judge.core.model.WireJson
import com.okjudge.judge.ui.cases.AppealDraft
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.util.UUID
import kotlin.math.min

data class VerdictAppealUiState(
    /** Null until read, and the gate inside is null for anyone but the writer. */
    val rounds: VerdictRounds? = null,
    /** "Add context & appeal" was tapped (or the last round failed): the sheet is out. */
    val open: Boolean = false,
    val draft: AppealDraft = AppealDraft(),
    /** A round just finished: its verdict is the saved one now. */
    val finished: Boolean = false,
) {
    val area: AppealArea get() = rounds?.let(CaseLogic::appealArea) ?: AppealArea.None

    /** The card's "Add context": the writer only, and only when the panel has something to do. */
    val offered: Boolean get() = area is AppealArea.Form || area is AppealArea.Upsell || area is AppealArea.Blocked

    /** Something to show for the appeal: opened, or while the judges re-judge. */
    val panel: Boolean get() = area != AppealArea.None && (open || area == AppealArea.Judging)

    /** Rounds this verdict can still take, counted the way the server limits them. */
    val left: Int
        get() = (CaseLogic.MAX_VERDICT_APPEALS - rounds?.appeals.orEmpty().count { it.status == "judged" }).coerceAtLeast(0)
}

/**
 * "Add context" on the writer's one-sided verdict (useVerdictAppeal in
 * components/VerdictAppeal.tsx): reads the rounds and the writer's gate from
 * GET /api/v1/verdicts/{id}, sends the context, polls the round like an
 * async verdict and saves its verdict into the history entry, which the
 * verdict screen then shows.
 */
class VerdictAppealViewModel(
    private val id: String,
    private val api: JudgeApi,
    private val history: HistoryRepository,
    private val onEntitlement: (Entitlement) -> Unit = {},
    private val refreshAccount: suspend () -> Unit = {},
    private val newKey: () -> String = { UUID.randomUUID().toString() },
) : ViewModel() {

    private val _state = MutableStateFlow(VerdictAppealUiState())

    val evidence = EvidenceController(viewModelScope, CaseLogic.MAX_EVIDENCE_PER_APPEAL) { api.uploadEvidence(it) }

    val state: StateFlow<VerdictAppealUiState> =
        combine(_state, evidence.state) { s, ev -> s.copy(draft = s.draft.copy(evidence = ev)) }
            .stateIn(viewModelScope, SharingStarted.Eagerly, _state.value)

    private var key: Pair<String, String>? = null

    init {
        viewModelScope.launch { load(follow = true) }
    }

    /**
     * Reads the rounds (false when they could not be read); with [follow], a round still judging is polled to its end.
     * [sent] is this session's 202, whose names the round's verdict still needs.
     */
    private suspend fun load(follow: Boolean, sent: VerdictAccepted? = null): Boolean {
        val rounds = (api.verdictRounds(id) as? ApiResult.Ok)?.value ?: return false
        _state.update { it.copy(rounds = rounds) }
        val judging = rounds.appeals.lastOrNull { it.status == "judging" }
        if (judging != null) {
            // Without our own 202, its names belonged to an earlier session.
            if (follow) await(VerdictAccepted(judging.id, pollAfterMs = 0, nameMap = namesFor(judging.id, sent)))
        } else {
            catchUp(rounds, sent)
        }
        return true
    }

    private fun namesFor(roundId: String, sent: VerdictAccepted?) = sent?.takeIf { it.id == roundId }?.nameMap.orEmpty()

    /** A round that finished while the app was away, or on the website: the entry takes its verdict. */
    private suspend fun catchUp(rounds: VerdictRounds, sent: VerdictAccepted? = null) {
        val latest = rounds.appeals.lastOrNull { it.status == "judged" } ?: return
        val saved = history.observe(id).first() ?: return
        if (saved.rulingId == latest.id) return
        val ready = (api.pollVerdict(latest.id, null) as? ApiResult.Ok)?.value as? VerdictPoll.Ready ?: return
        history.saveRuling(id, VerdictOutcome(latest.id, ready.result, namesFor(latest.id, sent)))
    }

    private suspend fun await(accepted: VerdictAccepted) {
        when (val end = api.awaitAccepted(accepted)) {
            is PollOutcome.Ready -> {
                history.saveRuling(id, end.outcome)
                _state.update { it.copy(open = false, finished = true) }
            }
            is PollOutcome.Ended -> {
                if (end.resumable) {
                    // Out of touch for a while, not failed: the round may still be judging.
                    // Read it again (until the network is back) and follow it from there.
                    var tries = 0
                    while (!load(follow = true, sent = accepted)) delay(min(CaseLogic.MAX_POLL_BACKOFF_MS, 1000L shl min(tries++, 5)))
                    when (_state.value.rounds?.appeals?.firstOrNull { it.id == accepted.id }?.status) {
                        "judged" -> _state.update { it.copy(open = false, finished = true) }
                        "failed" -> _state.update { it.copy(open = true) }
                    }
                    return
                }
                // The form says it didn't go through and that the credit is back.
                _state.update { it.copy(open = true) }
            }
        }
        load(follow = false)
    }

    fun open() {
        _state.update { it.copy(open = true) }
    }

    fun close() {
        _state.update { it.copy(open = false) }
    }

    /** The screen went back up to the new ruling; a later recomposition must not do it again. */
    fun consumeFinished() {
        _state.update { it.copy(finished = false) }
    }

    fun onText(text: String) {
        _state.update { it.copy(draft = it.draft.copy(text = text.take(CaseLogic.MAX_APPEAL_CHARS))) }
    }

    fun onAddEvidence(sources: List<ImageSource>) = evidence.add(sources)

    fun onRemoveEvidence(id: String) = evidence.remove(id)

    /**
     * POST the context with an Idempotency-Key (kept while the same body is
     * retried), then wait for the round's verdict.
     */
    fun submit() {
        // Not state.value: the combined copy can trail text typed a moment ago.
        val draft = _state.value.draft.copy(evidence = evidence.state.value)
        if (!draft.canSubmit) return
        val tokens = draft.evidence.tokens
        val body = WireJson.json.encodeToString(
            AppealRequest.serializer(),
            AppealRequest(text = draft.text.trim(), evidence = tokens.takeIf { it.isNotEmpty() }),
        )
        val k = key?.takeIf { it.first == body }?.second ?: newKey().also { key = body to it }
        _state.update { it.copy(draft = it.draft.copy(sending = true, error = null), finished = false) }
        viewModelScope.launch {
            when (val res = api.appealVerdict(id, body, k)) {
                is ApiResult.Ok -> {
                    key = null
                    val sent = res.value
                    sent.entitlement?.let(onEntitlement)
                    evidence.clear()
                    _state.update {
                        it.copy(rounds = VerdictRounds(sent.appeals, AppealGate(allowed = false, blockedBy = "busy")), draft = AppealDraft())
                    }
                    await(sent.accepted())
                }
                is ApiResult.Err -> {
                    _state.update { it.copy(draft = it.draft.copy(sending = false, error = res.error)) }
                    if (Errors.isAccountError(res.error)) launch { refreshAccount() }
                    // Another round or the limit got there first: the gate says so now.
                    val code = (res.error as? UiError.Api)?.code
                    if (code == "appeal_limit" || code == "in_progress") load(follow = true)
                }
            }
        }
    }
}
