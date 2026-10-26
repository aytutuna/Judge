package com.okjudge.judge.ui.cases

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.okjudge.judge.core.api.ApiResult
import com.okjudge.judge.core.api.JudgeApi
import com.okjudge.judge.core.cases.CaseLogic
import com.okjudge.judge.core.cases.CaseNamesStore
import com.okjudge.judge.core.display.Errors
import com.okjudge.judge.core.display.UiError
import com.okjudge.judge.core.evidence.EvidenceController
import com.okjudge.judge.core.evidence.EvidenceState
import com.okjudge.judge.core.evidence.ImageSource
import com.okjudge.judge.core.model.AppealRequest
import com.okjudge.judge.core.model.CaseStatus
import com.okjudge.judge.core.model.CaseView
import com.okjudge.judge.core.model.Entitlement
import com.okjudge.judge.core.model.NameMapping
import com.okjudge.judge.core.model.WireJson
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.util.UUID

enum class CaseLoadStatus { LOADING, READY, MISSING, SIGNIN, ERROR }

/** The judging animation on the case screen: shown while judging, finishing its reveal once judged. */
data class CaseOverlay(val done: Boolean)

data class CaseUiState(
    val status: CaseLoadStatus = CaseLoadStatus.LOADING,
    /** The last good view; kept through a failed refresh. */
    val view: CaseView? = null,
    /** This phone's names for the case (from creating it), used when the server has none. */
    val localNames: List<NameMapping> = emptyList(),
    val busy: Boolean = false,
    val actionError: UiError? = null,
    val resetDone: Boolean = false,
    val removedNow: Boolean = false,
    val overlay: CaseOverlay? = null,
    /** The verdict just replaced the judging animation. */
    val fresh: Boolean = false,
    val appealText: String = "",
    val appealSending: Boolean = false,
    val appealError: UiError? = null,
    val appealEvidence: EvidenceState = EvidenceState(max = CaseLogic.MAX_EVIDENCE_PER_APPEAL),
    val namesBusy: Boolean = false,
    /** The display-name form's message: an error, or the saved note. */
    val namesError: NamesError? = null,
    val namesSaved: Boolean = false,
    val typedName: String? = null,
) {
    /** Party A's names: the server's copy, else this phone's (owner view only). */
    val names: List<NameMapping>
        get() = if (view?.yourParty == "a") view.names ?: localNames else emptyList()

    val appealDraft: AppealDraft get() = AppealDraft(appealText, appealSending, appealError, appealEvidence)

    val appealCanSubmit: Boolean get() = appealDraft.canSubmit
}

/** What the appeal form holds (useAppealDraft), for a case or a one-sided verdict. */
data class AppealDraft(
    val text: String = "",
    val sending: Boolean = false,
    val error: UiError? = null,
    val evidence: EvidenceState = EvidenceState(max = CaseLogic.MAX_EVIDENCE_PER_APPEAL),
) {
    val canSubmit: Boolean
        get() = text.trim().length in CaseLogic.MIN_APPEAL_CHARS..CaseLogic.MAX_APPEAL_CHARS && !sending && !evidence.busy
}

sealed interface NamesError {
    data object Invalid : NamesError
    data object Failed : NamesError
    data class Api(val error: UiError) : NamesError
}

/**
 * One case for its owner (CaseScreen.tsx + lib/use-case.ts): loads
 * GET /api/v1/cases/{id}, polls while something is judging (the server's
 * pollAfterMs, backing off to 30 s on failures), and runs the owner's
 * actions; each answers with a fresh view that replaces the shown one.
 */
class CaseViewModel(
    val caseId: String,
    private val api: JudgeApi,
    private val names: CaseNamesStore,
    private val onEntitlement: (Entitlement) -> Unit = {},
    private val refreshAccount: suspend () -> Unit = {},
    private val sleep: suspend (Long) -> Unit = { delay(it) },
    private val newKey: () -> String = { UUID.randomUUID().toString() },
) : ViewModel() {

    private val _state = MutableStateFlow(CaseUiState(localNames = names.get(caseId)))

    val evidence = EvidenceController(viewModelScope, CaseLogic.MAX_EVIDENCE_PER_APPEAL) { api.uploadEvidence(it) }

    val state: StateFlow<CaseUiState> = combine(_state, evidence.state) { s, ev -> s.copy(appealEvidence = ev) }
        .stateIn(viewModelScope, SharingStarted.Eagerly, _state.value)

    private var failures = 0
    private var pollJob: Job? = null
    private var appealKey: Pair<String, String>? = null

    init {
        viewModelScope.launch { refresh() }
    }

    /** GET the case again (also "Try again" after a failed load). */
    fun reload() {
        pollJob?.cancel()
        viewModelScope.launch { refresh() }
    }

    private suspend fun refresh() {
        when (val res = api.getCase(caseId)) {
            is ApiResult.Ok -> {
                failures = 0
                show(res.value)
            }
            is ApiResult.Err -> {
                failures += 1
                val e = res.error as? UiError.Api
                _state.update { s ->
                    when {
                        e?.status == 404 || e?.code == "not_found" -> s.copy(status = CaseLoadStatus.MISSING, view = null)
                        e?.status == 401 || e?.code == "signin_required" -> s.copy(status = CaseLoadStatus.SIGNIN, view = null)
                        s.view != null -> s
                        else -> s.copy(status = CaseLoadStatus.ERROR)
                    }
                }
                schedule()
            }
        }
    }

    /** A new view (from a load or an action): updates the overlay and restarts polling. */
    private fun show(view: CaseView, fromAction: Boolean = false) {
        if (fromAction) failures = 0
        _state.update { s ->
            val judging = view.status == CaseStatus.JUDGING
            val overlay = when {
                judging -> CaseOverlay(done = false)
                view.status == CaseStatus.JUDGED && s.overlay != null -> CaseOverlay(done = true)
                else -> null
            }
            s.copy(status = CaseLoadStatus.READY, view = view, overlay = overlay)
        }
        schedule()
    }

    private fun schedule() {
        pollJob?.cancel()
        val wait = CaseLogic.nextPollDelay(_state.value.view, failures) ?: return
        pollJob = viewModelScope.launch {
            sleep(wait)
            refresh()
        }
    }

    /** The judging animation finished its reveal: the verdict takes over. */
    fun finishOverlay() {
        _state.update { it.copy(overlay = null, fresh = true) }
    }

    private suspend fun <T> action(call: suspend () -> ApiResult<T>): T? {
        _state.update { it.copy(busy = true, actionError = null) }
        val res = call()
        _state.update { it.copy(busy = false) }
        return when (res) {
            is ApiResult.Ok -> res.value
            is ApiResult.Err -> {
                _state.update { it.copy(actionError = res.error) }
                if (Errors.isAccountError(res.error)) viewModelScope.launch { refreshAccount() }
                null
            }
        }
    }

    /** "Judge now" with only the owner's side ([onlyMine]), or "Try again" after a failure. */
    fun judge(onlyMine: Boolean) {
        if (_state.value.busy) return
        viewModelScope.launch { action { api.judgeCase(caseId, onlyMine) }?.let { show(it, fromAction = true) } }
    }

    /** "Make a new link": the old one stops working. */
    fun resetInvite() {
        if (_state.value.busy) return
        _state.update { it.copy(resetDone = false) }
        viewModelScope.launch {
            val res = action { api.resetInvite(caseId) } ?: return@launch
            val view = _state.value.view ?: return@launch
            _state.update { it.copy(view = view.copy(inviteUrl = res.inviteUrl), resetDone = true) }
        }
    }

    /** Removes the owner's side (soft: blanked, every link closed). */
    fun remove() {
        if (_state.value.busy) return
        viewModelScope.launch {
            val res = action { api.removeCase(caseId) } ?: return@launch
            val view = res.case ?: return@launch
            names.forget(caseId)
            _state.update { it.copy(localNames = emptyList(), removedNow = true) }
            show(view, fromAction = true)
        }
    }

    // --- Names on the share pages (CaseNames) ------------------------------------------

    fun onTypedName(name: String) {
        _state.update { it.copy(typedName = name.take(CaseLogic.MAX_DISPLAY_NAME), namesSaved = false) }
    }

    fun saveDisplayName() {
        val s = _state.value
        val value = (s.typedName ?: s.view?.display?.a ?: "").trim()
        patchDisplay(setName = true, name = value.ifEmpty { null }, visible = null)
    }

    fun setNamesVisible(visible: Boolean) = patchDisplay(setName = false, name = null, visible = visible)

    private fun patchDisplay(setName: Boolean, name: String?, visible: Boolean?) {
        if (_state.value.namesBusy) return
        _state.update { it.copy(namesBusy = true, namesError = null, namesSaved = false) }
        viewModelScope.launch {
            val res = api.patchCaseDisplay(caseId, setName, name, visible)
            when (res) {
                is ApiResult.Ok -> {
                    _state.update { it.copy(namesBusy = false, typedName = null, namesSaved = true) }
                    show(res.value, fromAction = true)
                }
                is ApiResult.Err -> {
                    val e = res.error
                    val shown = when {
                        e is UiError.Api && e.code == "invalid" -> NamesError.Invalid
                        e is UiError.Api -> NamesError.Api(e)
                        else -> NamesError.Failed
                    }
                    _state.update { it.copy(namesBusy = false, namesError = shown) }
                }
            }
        }
    }

    // --- Appeals (useAppealDraft) ------------------------------------------------------

    fun onAppealText(text: String) {
        _state.update { it.copy(appealText = text.take(CaseLogic.MAX_APPEAL_CHARS)) }
    }

    fun onAddAppealEvidence(sources: List<ImageSource>) = evidence.add(sources)

    fun onRemoveAppealEvidence(id: String) = evidence.remove(id)

    /**
     * POST the appeal with an Idempotency-Key (kept while the same body is
     * retried), keep the returned names, swap in the re-judging view (polling
     * resumes) and the new balance.
     */
    fun submitAppeal() {
        val s = state.value
        if (!s.appealCanSubmit) return
        val tokens = s.appealEvidence.tokens
        val body = WireJson.json.encodeToString(
            AppealRequest.serializer(),
            AppealRequest(text = s.appealText.trim(), evidence = tokens.takeIf { it.isNotEmpty() }),
        )
        val key = appealKey?.takeIf { it.first == body }?.second ?: newKey().also { appealKey = body to it }
        _state.update { it.copy(appealSending = true, appealError = null) }
        viewModelScope.launch {
            when (val res = api.appeal(caseId, body, key)) {
                is ApiResult.Ok -> {
                    appealKey = null
                    val created = res.value
                    names.save(caseId, created.nameMap)
                    created.entitlement?.let(onEntitlement)
                    evidence.clear()
                    _state.update { it.copy(appealSending = false, appealText = "", localNames = names.get(caseId)) }
                    show(created.case, fromAction = true)
                }
                is ApiResult.Err -> {
                    _state.update { it.copy(appealSending = false, appealError = res.error) }
                    if (Errors.isAccountError(res.error)) viewModelScope.launch { refreshAccount() }
                }
            }
        }
    }

    companion object {
        /** A loaded state without network, for previews and screenshots (CaseScreen is stateless). */
        fun preview(view: CaseView, localNames: List<NameMapping> = emptyList()): CaseUiState =
            CaseUiState(status = CaseLoadStatus.READY, view = view, localNames = localNames)
    }
}
