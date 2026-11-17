package com.okjudge.judge.core.feedback

import com.okjudge.judge.core.api.ApiResult
import com.okjudge.judge.core.api.JudgeApi
import com.okjudge.judge.i18n.AppLang
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * The one-time private details tick. The API asks [ask] when the server refuses
 * a verdict or case side with `agreement_required`; the sheet answers through
 * [confirm] or [decline]. Calls that refuse at the same time wait on one answer.
 */
class Agreement(private val api: JudgeApi, private val scope: CoroutineScope) {
    data class State(val open: Boolean = false, val busy: Boolean = false, val failed: Boolean = false)

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state.asStateFlow()

    private var waiting: CompletableDeferred<Boolean>? = null

    /** True once the person agreed, false when they declined or the session ended. */
    suspend fun ask(): Boolean {
        val answer = waiting ?: CompletableDeferred<Boolean>().also {
            waiting = it
            _state.value = State(open = true)
        }
        return answer.await()
    }

    fun confirm(lang: AppLang) {
        if (waiting == null || _state.value.busy) return
        _state.value = State(open = true, busy = true)
        scope.launch {
            if (api.agree(lang) is ApiResult.Ok) finish(true) else _state.value = State(open = true, failed = true)
        }
    }

    fun decline() = finish(false)

    /** A session that ends answers "no" to whoever waits. */
    fun cancel() = finish(false)

    private fun finish(agreed: Boolean) {
        _state.value = State()
        waiting?.complete(agreed)
        waiting = null
    }
}
