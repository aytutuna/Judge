package com.okjudge.judge.core.feedback

import com.okjudge.judge.core.api.ApiResult
import com.okjudge.judge.core.api.JudgeApi
import com.okjudge.judge.core.model.ConsentState
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** The "Help improve Judge" choice, shared by the verdict card and the settings switch; null until the server has answered. */
class Consent(private val api: JudgeApi, private val scope: CoroutineScope) {
    private val _state = MutableStateFlow<ConsentState?>(null)
    val state: StateFlow<ConsentState?> = _state.asStateFlow()

    fun refresh() {
        scope.launch {
            val res = api.consent()
            if (res is ApiResult.Ok) _state.value = res.value
        }
    }

    fun clear() {
        _state.value = null
    }

    /** [source] is "card" or "switch"; [wordingKey] names the text the person saw. */
    fun answer(on: Boolean, source: String, wordingKey: String) {
        scope.launch {
            val res = api.setConsent(on, source, wordingKey)
            if (res is ApiResult.Ok) _state.value = res.value
        }
    }

    companion object {
        const val CARD_WORDING = "consent.cardBody"
        const val SWITCH_WORDING = "consent.switchDetail"
    }
}
