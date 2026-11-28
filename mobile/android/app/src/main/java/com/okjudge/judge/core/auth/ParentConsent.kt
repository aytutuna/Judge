package com.okjudge.judge.core.auth

import com.okjudge.judge.core.api.ApiResult
import com.okjudge.judge.core.api.JudgeApi
import com.okjudge.judge.core.display.UiError
import com.okjudge.judge.core.model.ParentView
import com.okjudge.judge.i18n.AppLang
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** The parent step of the age check: what the server says about the request, and the calls that move it on. */
class ParentConsent(private val api: JudgeApi, private val refreshAccount: suspend () -> Unit) {
    data class State(val view: ParentView? = null, val busy: Boolean = false, val error: UiError? = null)

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state.asStateFlow()

    // Replies that belong to a session that has ended, or that were overtaken by a newer call, are dropped.
    private var epoch = 0
    private var changes = 0

    suspend fun load() {
        val asked = epoch
        val before = changes
        val res = api.parent()
        if (asked != epoch || before != changes || _state.value.busy) return
        if (res is ApiResult.Ok) _state.value = _state.value.copy(view = res.value, error = null)
    }

    /** Gives the parent's address, changes it, or (the same address) sends the link again, in [lang]. */
    suspend fun send(email: String, lang: AppLang) = act { api.sendParent(email.trim(), lang) }

    suspend fun resend(lang: AppLang) = act { api.resendParent(lang) }

    /** The account left: nothing of its request may show for the next one. */
    fun clear() {
        epoch++
        _state.value = State()
    }

    private suspend fun act(call: suspend () -> ApiResult<ParentView>) {
        if (_state.value.busy) return
        val asked = epoch
        changes++
        _state.value = _state.value.copy(busy = true, error = null)
        val res = call()
        if (asked != epoch) return
        changes++
        when (res) {
            is ApiResult.Ok -> {
                _state.value = State(view = res.value)
                // A revoked account that asked again becomes pending.
                refreshAccount()
            }
            is ApiResult.Err -> {
                _state.value = _state.value.copy(busy = false, error = res.error)
                // The request moved under us: show what it is now.
                if ((res.error as? UiError.Api)?.code in MOVED) {
                    load()
                    _state.value = _state.value.copy(error = res.error)
                    refreshAccount()
                }
            }
        }
    }

    private companion object {
        val MOVED = setOf("parent_conflict", "parent_declined", "parent_limit")
    }
}
