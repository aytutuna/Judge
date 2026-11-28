package com.okjudge.judge.core.auth

import com.okjudge.judge.core.api.ApiResult
import com.okjudge.judge.core.api.JudgeApi
import com.okjudge.judge.core.display.UiError
import com.okjudge.judge.core.model.ParentView
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** The parent step of the age check: what the server says about the request, and the calls that move it on. */
class ParentConsent(private val api: JudgeApi, private val refreshAccount: suspend () -> Unit) {
    data class State(val view: ParentView? = null, val busy: Boolean = false, val error: UiError? = null)

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state.asStateFlow()

    suspend fun load() {
        val res = api.parent()
        if (res is ApiResult.Ok) _state.value = _state.value.copy(view = res.value)
    }

    /** Gives the parent's address, changes it, or (the same address) sends the link again. */
    suspend fun send(email: String) = act { api.sendParent(email.trim()) }

    suspend fun resend() = act { api.resendParent() }

    fun clear() {
        _state.value = State()
    }

    private suspend fun act(call: suspend () -> ApiResult<ParentView>) {
        if (_state.value.busy) return
        _state.value = _state.value.copy(busy = true, error = null)
        when (val res = call()) {
            is ApiResult.Ok -> {
                _state.value = State(view = res.value)
                // A revoked account that asked again becomes pending.
                refreshAccount()
            }
            is ApiResult.Err -> {
                _state.value = _state.value.copy(busy = false, error = res.error)
                // The request moved under us: show what it is now.
                if ((res.error as? UiError.Api)?.code == "parent_conflict") load()
            }
        }
    }
}
