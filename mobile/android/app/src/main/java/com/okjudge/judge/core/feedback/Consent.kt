package com.okjudge.judge.core.feedback

import com.okjudge.judge.core.api.ApiResult
import com.okjudge.judge.core.api.JudgeApi
import com.okjudge.judge.core.model.ConsentState
import com.okjudge.judge.core.model.ConsentStatus
import com.okjudge.judge.i18n.AppLang
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * The "Help improve Judge" choice, shared by the verdict card and the settings switch; null until the server has answered.
 * [ask] is the server's call on when the card shows (after the second finished verdict).
 */
class Consent(private val api: JudgeApi, private val scope: CoroutineScope) {
    private val _state = MutableStateFlow<ConsentState?>(null)
    val state: StateFlow<ConsentState?> = _state.asStateFlow()

    private val _ask = MutableStateFlow(false)
    val ask: StateFlow<Boolean> = _ask.asStateFlow()

    // A refresh that lands while the card's answer is being saved must not bring the card back.
    private var cardPending = false

    fun refresh() {
        scope.launch {
            val res = api.consent()
            if (res is ApiResult.Ok) apply(res.value)
        }
    }

    fun clear() {
        _state.value = null
        _ask.value = false
    }

    private fun apply(status: ConsentStatus) {
        _state.value = status.state
        _ask.value = status.ask && !cardPending
    }

    /** [source] is "card" or "switch"; [wordingKey] names the text the person saw, in [lang]. */
    fun answer(on: Boolean, source: String, wordingKey: String, lang: AppLang) {
        // The card leaves at once and comes back if the save fails.
        val card = source == "card"
        if (card) {
            if (!_ask.value) return
            _ask.value = false
            cardPending = true
        }
        scope.launch {
            val res = api.setConsent(on, source, wordingKey, lang)
            if (card) cardPending = false
            // A save that fails after sign-out (clear() ran) leaves the card gone.
            if (res is ApiResult.Ok) apply(res.value) else if (card && _state.value != null) _ask.value = true
        }
    }

    companion object {
        const val CARD_WORDING = "consent.cardBody"
        const val SWITCH_WORDING = "consent.switchDetail"
    }
}
