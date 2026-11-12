package com.okjudge.judge.core.session

import com.okjudge.judge.core.api.ApiResult
import com.okjudge.judge.core.api.JudgeApi
import com.okjudge.judge.core.api.PollOutcome
import com.okjudge.judge.core.data.HistoryRepository
import com.okjudge.judge.core.display.Errors
import com.okjudge.judge.core.display.UiError
import com.okjudge.judge.core.cases.CaseNamesStore
import com.okjudge.judge.core.cases.MemoryCaseNames
import com.okjudge.judge.core.model.Clarification
import com.okjudge.judge.core.model.CreateCaseRequest
import com.okjudge.judge.core.model.ClarifyQuestion
import com.okjudge.judge.core.model.Entitlement
import com.okjudge.judge.core.model.WireJson
import com.okjudge.judge.core.model.VerdictAccepted
import com.okjudge.judge.core.model.VerdictOutcome
import com.okjudge.judge.core.model.VerdictRequest
import com.okjudge.judge.core.model.VerdictSide
import com.okjudge.judge.core.model.VerdictSubmission
import com.okjudge.judge.i18n.AppLang
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.receiveAsFlow
import java.security.MessageDigest
import java.util.UUID
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * One verdict request at a time, owned by the app scope so it survives
 * configuration changes while the judging screen animates. Every verdict
 * is a premium one. The request is sent once: "Try again" is always a new
 * user action, never automatic, and the same request reuses its
 * Idempotency-Key so the server joins it instead of charging again.
 */
class VerdictFlow(
    private val api: JudgeApi,
    private val history: HistoryRepository,
    private val scope: CoroutineScope,
    private val clock: () -> Long = System::currentTimeMillis,
    /** A premium response carried the account's new balance. */
    private val onEntitlement: (Entitlement) -> Unit = {},
    /** Reads /api/v1/me again (after every premium outcome and account errors). */
    private val refreshAccount: suspend () -> Unit = {},
    private val sleep: suspend (Long) -> Unit = { delay(it) },
    private val newKey: () -> String = { UUID.randomUUID().toString() },
    private val caseNames: CaseNamesStore = MemoryCaseNames(),
    /** Picks where a new request's court is drawn; null leaves it to the server (the court). */
    private val pickVenue: () -> String? = { null },
    /** Keeps the held key, venue and accepted verdict across a restart of the app. */
    private val pending: PendingStore = MemoryPending(),
) {
    sealed interface State {
        data object Idle : State
        /** [argument] is what was sent; [sides] what was written, for the judging screen's tiles. */
        data class Running(
            val startedAt: Long,
            val premium: Boolean = false,
            val argument: String = "",
            val sides: List<Side> = emptyList(),
            val venue: String? = null,
        ) : State
        data class Succeeded(val outcome: VerdictOutcome, val argument: String = "", val sides: List<Side> = emptyList(), val venue: String? = null) : State
        data class Failed(val error: UiError) : State
    }

    /**
     * One written side as the judging screen shows it; an empty [name] reads "Your side" / "Their side".
     * [extra] is C or D on a verdict with more than two sides.
     */
    data class Side(val mine: Boolean, val name: String, val text: String, val extra: com.okjudge.judge.core.model.Side? = null) {
        val party: com.okjudge.judge.core.model.Side get() = if (mine) com.okjudge.judge.core.model.Side.A else extra ?: com.okjudge.judge.core.model.Side.B
    }

    private val _state = MutableStateFlow<State>(State.Idle)
    val state: StateFlow<State> = _state.asStateFlow()

    /** The last failure, shown on Home until the next submit or a dismiss. */
    private val _lastError = MutableStateFlow<UiError?>(null)
    val lastError: StateFlow<UiError?> = _lastError.asStateFlow()

    /** Epoch millis until which "Get the verdict" stays disabled (rate limit, daily cap). */
    private val _blockedUntil = MutableStateFlow<Long?>(null)
    val blockedUntil: StateFlow<Long?> = _blockedUntil.asStateFlow()

    private var job: Job? = null

    /** Premium's step before judging: checking for questions, then the questions. */
    sealed interface PremiumStep {
        data object None : PremiumStep
        data object Checking : PremiumStep
        data class Clarify(val questions: List<ClarifyQuestion>) : PremiumStep
    }

    /** Where the app shell should go next. */
    sealed interface Nav {
        data object Clarify : Nav
        data object Judging : Nav
        /** Nothing left to spend: the pricing screen. */
        data object Pricing : Nav
        data object SignIn : Nav
    }

    private val _creating = MutableStateFlow(false)
    /** A two-sided case is being created (POST /api/v1/cases). */
    val creating: StateFlow<Boolean> = _creating.asStateFlow()

    private val _premiumStep = MutableStateFlow<PremiumStep>(PremiumStep.None)
    val premiumStep: StateFlow<PremiumStep> = _premiumStep.asStateFlow()

    private val _navigation = Channel<Nav>(Channel.BUFFERED)
    val navigation: Flow<Nav> = _navigation.receiveAsFlow()

    private val _shareLink = Channel<String>(Channel.BUFFERED)

    /** The one link of a case just created, once, for the share sheet. */
    val shareLink: Flow<String> = _shareLink.receiveAsFlow()

    /** What a premium request judges, fixed when it is submitted. */
    private data class PremiumInput(val text: String, val lang: AppLang, val evidence: List<String>, val sides: List<Side>)

    @Volatile private var premiumInput: PremiumInput? = null

    /**
     * One Idempotency-Key per exact request body: a retry of the same request
     * reuses it, so the server replays or joins instead of charging again. A
     * success or a different body gets a new key.
     */
    @Volatile private var heldKey: Pair<String, String>? = null

    /** The verdict the server accepted for the request being judged, until it settles. */
    @Volatile private var acceptedId: String? = null

    fun keyFor(body: String): String {
        val hash = hashOf(body)
        heldKey?.let { (h, k) -> if (h == hash) return k }
        val key = newKey()
        heldKey = hash to key
        persist()
        return key
    }

    fun clearKey(key: String) {
        if (heldKey?.second == key) {
            heldKey = null
            persist()
        }
    }

    /**
     * The place picked for a request, kept with its Idempotency-Key's body so a retry sends the
     * same one. [bare] is the body without a venue.
     */
    @Volatile private var heldVenue: Pair<String, String?>? = null

    private fun venueFor(bare: String): String? {
        val hash = hashOf(bare)
        heldVenue?.let { (h, v) -> if (h == hash) return v }
        val venue = pickVenue()
        heldVenue = hash to venue
        persist()
        return venue
    }

    init {
        val saved = pending.load()
        if (saved != null && clock() - saved.savedAt < SAVED_LIFETIME_MS) {
            if (saved.venueHash != null) heldVenue = saved.venueHash to saved.venue
            if (saved.keyHash != null && saved.key != null) heldKey = saved.keyHash to saved.key
            acceptedId = saved.acceptedId
        } else if (saved != null) {
            pending.save(null)
        }
    }

    private fun persist() {
        val venue = heldVenue
        val key = heldKey
        if (venue == null && key == null) {
            pending.save(null)
        } else {
            pending.save(SavedRequest(venue?.first, venue?.second, key?.first, key?.second, acceptedId, clock()))
        }
    }

    private suspend fun succeed(outcome: VerdictOutcome) {
        history.save(outcome)
        val running = _state.value as? State.Running
        heldVenue = null
        persist()
        _state.value = State.Succeeded(outcome, running?.argument.orEmpty(), running?.sides.orEmpty(), outcome.venue ?: running?.venue)
    }

    private fun fail(error: UiError) {
        report(error)
        _state.value = State.Failed(error)
    }

    /**
     * Shows [error] on Home (and blocks the button for a rate limit) without
     * a judging screen. Out of units or signed out opens pricing or sign-in
     * instead of a banner.
     */
    fun report(error: UiError) {
        when (Errors.opens(error)) {
            null -> _lastError.value = error
            Errors.Opens.PRICING -> _navigation.trySend(Nav.Pricing)
            Errors.Opens.SIGN_IN -> _navigation.trySend(Nav.SignIn)
        }
        Errors.blockSeconds(error)?.let { _blockedUntil.value = clock() + (it * 1000).toLong() }
        if (Errors.isAccountError(error)) scope.launch { refreshAccount() }
    }

    /** Whether a new request may start now (nothing running, no rate-limit block). */
    fun canStart(): Boolean {
        if (_state.value is State.Running || _premiumStep.value == PremiumStep.Checking || _creating.value) return false
        val until = _blockedUntil.value
        return until == null || until <= clock()
    }

    /**
     * Premium step 1 (submitPremium): ask whether key facts are missing.
     * Network trouble, a rate limit or a server error never blocks the
     * verdict: it goes ahead without questions. Account problems (401, 402),
     * a refusal (403) and bad input (400) stop on Home with the error.
     */
    fun startPremium(argument: String, lang: AppLang, evidence: List<String>, sides: List<Side> = emptyList()): Boolean {
        if (!canStart()) return false
        _lastError.value = null
        val input = PremiumInput(argument.trim(), lang, evidence.toList(), sides)
        premiumInput = input
        _premiumStep.value = PremiumStep.Checking
        job = scope.launch {
            val found = when (val res = api.clarify(input.text, lang)) {
                is ApiResult.Ok -> res.value.questions.take(MAX_QUESTIONS)
                is ApiResult.Err -> if (stopsClarify(res.error)) {
                    _premiumStep.value = PremiumStep.None
                    report(res.error)
                    return@launch
                } else {
                    emptyList()
                }
            }
            if (found.isNotEmpty()) {
                _premiumStep.value = PremiumStep.Clarify(found)
                _navigation.trySend(Nav.Clarify)
            } else {
                _premiumStep.value = PremiumStep.None
                judgePremium(input, null)
            }
        }
        return true
    }

    /** Premium step 2 after the questions: the answers, or every answer empty when [skip]. */
    fun finishClarify(answers: Map<String, String>, skip: Boolean) {
        val step = _premiumStep.value as? PremiumStep.Clarify ?: return
        val input = premiumInput ?: return
        _premiumStep.value = PremiumStep.None
        judgePremium(input, buildClarifications(step.questions, answers, skip))
    }

    /**
     * Both sides (createCase): the case with the owner's side, or without
     * one when [argument] is blank (it is written on the case screen),
     * holding one verdict. The returned names stay on this phone. No clarifying step:
     * the other side fills the gaps.
     */
    fun createCase(
        argument: String,
        lang: AppLang,
        evidence: List<String>,
        displayName: String?,
        otherName: String? = null,
        sides: Int = 2,
    ): Boolean {
        if (!canStart()) return false
        _lastError.value = null
        _creating.value = true
        val request = CreateCaseRequest(
            text = argument.trim().takeIf { it.isNotEmpty() },
            lang = lang.tag,
            evidence = evidence.takeIf { it.isNotEmpty() },
            displayName = displayName?.trim()?.takeIf { it.isNotEmpty() },
            sides = sides.takeIf { it > 2 }?.coerceAtMost(4),
        )
        val venue = venueFor(WireJson.json.encodeToString(CreateCaseRequest.serializer(), request))
        val body = WireJson.json.encodeToString(CreateCaseRequest.serializer(), request.copy(venue = venue))
        val key = keyFor(body)
        job = scope.launch {
            when (val res = api.createCase(body, key)) {
                is ApiResult.Err -> {
                    _creating.value = false
                    report(res.error)
                }
                is ApiResult.Ok -> {
                    heldVenue = null
                    clearKey(key)
                    val created = res.value
                    caseNames.save(created.case.id, created.nameMap)
                    val other = otherName?.trim()?.takeIf { it.isNotEmpty() }
                    other?.let { caseNames.saveOtherName(created.case.id, it) }
                    created.entitlement?.let(onEntitlement)
                    _creating.value = false
                    created.case.inviteUrl?.let { _shareLink.trySend(it) }
                }
            }
        }
        return true
    }

    /** "Back" from the questions: the form again, nothing sent. */
    fun leaveClarify() {
        if (_premiumStep.value is PremiumStep.Clarify) _premiumStep.value = PremiumStep.None
    }

    /** Premium step 2 (judgePremium): the verdict itself. */
    private fun judgePremium(input: PremiumInput, clarifications: List<Clarification>?) {
        _lastError.value = null
        acceptedId = null
        val request = VerdictRequest(
            argument = input.text,
            lang = input.lang.tag,
            tier = "premium",
            clarifications = clarifications,
            evidence = input.evidence.takeIf { it.isNotEmpty() },
            // Three or four sides go as typed; `argument` is all of them joined.
            sides = input.sides.takeIf { it.size > 2 }?.map { VerdictSide(it.text, it.name.ifEmpty { null }) },
        )
        val venue = venueFor(WireJson.json.encodeToString(VerdictRequest.serializer(), request))
        _state.value = State.Running(clock(), premium = true, argument = input.text, sides = input.sides, venue = venue)
        _navigation.trySend(Nav.Judging)
        val body = WireJson.json.encodeToString(VerdictRequest.serializer(), request.copy(venue = venue))
        val key = keyFor(body)
        job = scope.launch {
            val waitUntil = clock() + IN_PROGRESS_WAIT_MS
            while (true) {
                when (val res = api.startVerdictBody(body, key)) {
                    is ApiResult.Err -> {
                        val e = res.error
                        if (e is UiError.Api && e.status == 409 && e.code == "in_progress" && clock() < waitUntil) {
                            sleep(IN_PROGRESS_POLL_MS)
                            continue
                        }
                        fail(e)
                        return@launch
                    }
                    is ApiResult.Ok -> when (val submission = res.value) {
                        is VerdictSubmission.Done -> {
                            clearKey(key)
                            submission.outcome.entitlement?.let(onEntitlement)
                            succeed(submission.outcome)
                            scope.launch { refreshAccount() }
                            return@launch
                        }
                        is VerdictSubmission.Accepted -> {
                            submission.accepted.entitlement?.let(onEntitlement)
                            acceptedId = submission.accepted.id
                            persist()
                            settle(submission.accepted, key)
                            return@launch
                        }
                    }
                }
            }
        }
    }

    /** Polls an accepted verdict to its end and shows the outcome. */
    private suspend fun settle(accepted: VerdictAccepted, key: String?) {
        val end = api.awaitAccepted(accepted)
        // A refused or failed verdict gave the unit back.
        scope.launch { refreshAccount() }
        acceptedId = null
        when (end) {
            is PollOutcome.Ready -> {
                key?.let(::clearKey)
                // A retry that joined a running verdict got no name map: the writer's view has it.
                val outcome = if (accepted.replayed && end.outcome.nameMap.isEmpty()) {
                    val mine = (api.mineNameMap(end.outcome.id) as? ApiResult.Ok)?.value.orEmpty()
                    end.outcome.copy(nameMap = mine)
                } else {
                    end.outcome
                }
                succeed(outcome)
            }
            is PollOutcome.Ended -> {
                persist()
                fail(end.error)
            }
        }
    }

    /**
     * Picks up the verdict the server accepted before the app was killed: the
     * judging screen opens on it as after any restart (no text to show).
     */
    fun resume() {
        val id = acceptedId ?: return
        if (!canStart()) return
        _lastError.value = null
        _state.value = State.Running(clock(), premium = true, venue = heldVenue?.second)
        _navigation.trySend(Nav.Judging)
        val key = heldKey?.second
        job = scope.launch { settle(VerdictAccepted(id, pollAfterMs = 2000, nameMap = emptyList(), replayed = true), key) }
    }

    /** Abandons the request (the server may still finish and save it; the
     * same request again keeps its key, so the server joins that verdict). */
    fun cancel() {
        job?.cancel()
        job = null
        _premiumStep.value = PremiumStep.None
        _state.value = State.Idle
    }

    /** The judging screen has handed the outcome or the failure over. */
    fun acknowledge() {
        if (_state.value !is State.Running) _state.value = State.Idle
    }

    fun dismissError() {
        _lastError.value = null
    }

    companion object {
        /** While the server answers 409 in_progress, ask again this often, for at most the route's 300 s. */
        const val IN_PROGRESS_POLL_MS = 4000L
        const val IN_PROGRESS_WAIT_MS = 300_000L
        const val MAX_QUESTIONS = 2
        const val MAX_ANSWER = 500

        /** A kept request older than this is forgotten. */
        const val SAVED_LIFETIME_MS = 30 * 60_000L

        private fun hashOf(text: String): String =
            MessageDigest.getInstance("SHA-256").digest(text.toByteArray()).joinToString("") { "%02x".format(it) }

        /** Clarify failures that stop on the form; anything else judges without questions. */
        fun stopsClarify(error: UiError): Boolean = error is UiError.Api && error.status in setOf(400, 401, 402, 403)

        /**
         * The request's clarifications (buildClarifications): one per question,
         * answered or not; skip sends every answer empty. Null without questions.
         */
        fun buildClarifications(questions: List<ClarifyQuestion>, answers: Map<String, String>, skip: Boolean): List<Clarification>? {
            if (questions.isEmpty()) return null
            return questions.take(MAX_QUESTIONS).map { q ->
                Clarification(
                    question = q.text.trim().take(300),
                    answer = if (skip) "" else (answers[q.id] ?: "").trim().take(MAX_ANSWER),
                )
            }
        }
    }
}
