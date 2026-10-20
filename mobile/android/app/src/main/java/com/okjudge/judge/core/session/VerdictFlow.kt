package com.okjudge.judge.core.session

import com.okjudge.judge.core.api.ApiResult
import com.okjudge.judge.core.api.BotCheck
import com.okjudge.judge.core.api.BotCheckException
import com.okjudge.judge.core.api.JudgeApi
import com.okjudge.judge.core.data.HistoryRepository
import com.okjudge.judge.core.display.Errors
import com.okjudge.judge.core.display.Preset
import com.okjudge.judge.core.display.UiError
import com.okjudge.judge.core.model.FrameworkChoice
import com.okjudge.judge.core.model.VerdictOutcome
import com.okjudge.judge.core.model.VerdictRequest
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
 * sent once: "Try again" is always a new user action, never automatic.
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

    fun start(argument: String, preset: Preset, lang: AppLang): Boolean {
        if (_state.value is State.Running) return false
        val until = _blockedUntil.value
        if (until != null && until > clock()) return false
        _lastError.value = null
        _state.value = State.Running(clock())
        job = scope.launch {
            val token = try {
                botCheck.token()
            } catch (_: BotCheckException) {
                fail(UiError.BotCheck)
                return@launch
            }
            val request = VerdictRequest(
                argument = argument.trim(),
                framework = FrameworkChoice(preset = preset.id),
                lang = lang.tag,
                turnstileToken = token,
            )
            when (val result = api.submitVerdict(request)) {
                is ApiResult.Ok -> {
                    history.save(result.value, preset.id)
                    _state.value = State.Succeeded(result.value)
                }
                is ApiResult.Err -> fail(result.error)
            }
        }
        return true
    }

    private fun fail(error: UiError) {
        _lastError.value = error
        Errors.blockSeconds(error)?.let { _blockedUntil.value = clock() + (it * 1000).toLong() }
        _state.value = State.Failed(error)
    }

    /** Abandons the request (the server may still finish and save it). */
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
}
