package com.okjudge.judge.core.session

import com.okjudge.judge.core.api.ApiResult
import com.okjudge.judge.core.api.BotCheck
import com.okjudge.judge.core.api.BotCheckException
import com.okjudge.judge.core.api.JudgeApi
import com.okjudge.judge.core.api.PollOutcome
import com.okjudge.judge.core.data.HistoryRepository
import com.okjudge.judge.core.display.Errors
import com.okjudge.judge.core.display.Preset
import com.okjudge.judge.core.display.UiError
import com.okjudge.judge.core.model.FrameworkChoice
import com.okjudge.judge.core.model.VerdictAccepted
import com.okjudge.judge.core.model.VerdictOutcome
import com.okjudge.judge.core.model.VerdictRequest
import com.okjudge.judge.core.model.VerdictSubmission
import com.okjudge.judge.i18n.AppLang
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * One verdict request at a time, owned by the app scope so it survives
 * configuration changes while the judging screen animates. The request is
 * sent once: "Try again" is always a new user action, never automatic, and
 * when the same request was already accepted it polls that verdict again
 * instead of asking (and paying) for a second one.
 */
class VerdictFlow(
    private val api: JudgeApi,
    private val botCheck: BotCheck,
    private val history: HistoryRepository,
    private val scope: CoroutineScope,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    sealed interface State {
        data object Idle : State
        data class Running(val startedAt: Long) : State
        data class Succeeded(val outcome: VerdictOutcome) : State
        data class Failed(val error: UiError) : State
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

    /** What was asked: the same request resumes its verdict. */
    private data class RequestKey(val text: String, val preset: String, val lang: AppLang)

    /**
     * A verdict the server accepted (202) but the app has not received:
     * kept when polling stopped short (network, server hiccups, the
     * deadline, cancel), dropped once the server settled it.
     */
    private data class PendingVerdict(val accepted: VerdictAccepted, val key: RequestKey, val since: Long)

    @Volatile private var pending: PendingVerdict? = null

    fun start(argument: String, preset: Preset, lang: AppLang): Boolean {
        if (_state.value is State.Running) return false
        val until = _blockedUntil.value
        if (until != null && until > clock()) return false
        _lastError.value = null
        _state.value = State.Running(clock())
        val text = argument.trim()
        val key = RequestKey(text, preset.id, lang)
        val held = pending?.takeIf { it.key == key && clock() - it.since < RESUME_WINDOW_MS }
        if (held == null) pending = null
        job = scope.launch {
            val accepted = held?.accepted ?: run {
                val token = try {
                    botCheck.token()
                } catch (_: BotCheckException) {
                    fail(UiError.BotCheck)
                    return@launch
                }
                val request = VerdictRequest(
                    argument = text,
                    framework = FrameworkChoice(preset = preset.id),
                    lang = lang.tag,
                    turnstileToken = token,
                )
                when (val started = api.startVerdict(request)) {
                    is ApiResult.Err -> {
                        fail(started.error)
                        return@launch
                    }
                    is ApiResult.Ok -> when (val submission = started.value) {
                        is VerdictSubmission.Done -> {
                            succeed(submission.outcome, preset)
                            return@launch
                        }
                        is VerdictSubmission.Accepted -> submission.accepted.also {
                            pending = PendingVerdict(it, key, clock())
                        }
                    }
                }
            }
            when (val end = api.awaitAccepted(accepted)) {
                is PollOutcome.Ready -> {
                    dropPending(accepted)
                    succeed(end.outcome, preset)
                }
                is PollOutcome.Ended -> {
                    if (!end.resumable) dropPending(accepted)
                    fail(end.error)
                }
            }
        }
        return true
    }

    private fun dropPending(accepted: VerdictAccepted) {
        if (pending?.accepted?.id == accepted.id) pending = null
    }

    private suspend fun succeed(outcome: VerdictOutcome, preset: Preset) {
        history.save(outcome, preset.id)
        _state.value = State.Succeeded(outcome)
    }

    private fun fail(error: UiError) {
        _lastError.value = error
        Errors.blockSeconds(error)?.let { _blockedUntil.value = clock() + (it * 1000).toLong() }
        _state.value = State.Failed(error)
    }

    /** Abandons the request (the server may still finish and save it; an
     * accepted verdict stays pending, so the same request resumes it). */
    fun cancel() {
        job?.cancel()
        job = null
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
        /** After this long a pending verdict is dropped and a new one is asked
         * for; the server settles every verdict within about 10 minutes. */
        const val RESUME_WINDOW_MS = 15 * 60_000L
    }
}
