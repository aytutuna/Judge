package com.okjudge.judge.ui.signin

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.okjudge.judge.core.auth.Account
import com.okjudge.judge.core.auth.SignInError
import com.okjudge.judge.core.auth.SignInResult
import com.okjudge.judge.i18n.AppLang
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

enum class SignInStep { EMAIL, CODE }

enum class SignInBusy { GOOGLE, SEND, VERIFY }

data class SignInUiState(
    val providers: Account.Providers = Account.Providers.Loading,
    val step: SignInStep = SignInStep.EMAIL,
    val email: String = "",
    val code: String = "",
    val busy: SignInBusy? = null,
    val error: SignInError? = null,
    /** Signed in: the screen hands over to where the user was going. */
    val done: Boolean = false,
) {
    private val providerFlags get() = (providers as? Account.Providers.Ready)?.config?.signIn

    /** Apple sign-in is iOS only: Android never offers it, whatever the server says. */
    val showGoogle: Boolean get() = providerFlags?.google == true
    val showEmail: Boolean get() = providerFlags?.emailCode == true
    val noneAvailable: Boolean get() = providers is Account.Providers.Ready && !showGoogle && !showEmail

    val canRequestCode: Boolean get() = busy == null && email.isNotBlank()
    val canSubmitCode: Boolean get() = busy == null && code.length == CODE_LENGTH

    companion object {
        const val CODE_LENGTH = 6
    }
}

/** The sign-in screen: Google, or an emailed six-digit code. */
class SignInViewModel(private val account: Account) : ViewModel() {
    private val _state = MutableStateFlow(SignInUiState(providers = account.providers.value))
    val state: StateFlow<SignInUiState> = _state.asStateFlow()

    init {
        viewModelScope.launch { account.providers.collect { p -> _state.update { it.copy(providers = p) } } }
        account.loadProviders()
    }

    fun retryProviders() = account.loadProviders(force = true)

    fun onEmailChange(text: String) {
        _state.update { it.copy(email = text.take(MAX_EMAIL), error = null) }
    }

    fun onCodeChange(text: String) {
        val digits = text.filter { it in '0'..'9' }.take(SignInUiState.CODE_LENGTH)
        _state.update { it.copy(code = digits, error = null) }
    }

    fun requestCode(lang: AppLang) {
        val s = _state.value
        if (!s.canRequestCode) return
        if (!Account.looksLikeEmail(s.email)) {
            _state.update { it.copy(error = SignInError.INVALID_EMAIL) }
            return
        }
        send(lang)
    }

    fun resend(lang: AppLang) {
        if (_state.value.busy != null) return
        send(lang)
    }

    private fun send(lang: AppLang) {
        val email = _state.value.email.trim()
        _state.update { it.copy(busy = SignInBusy.SEND, error = null) }
        viewModelScope.launch {
            val error = account.sendCode(email, lang)
            _state.update {
                if (error == null) it.copy(busy = null, step = SignInStep.CODE, code = "", email = email)
                else it.copy(busy = null, error = error)
            }
        }
    }

    fun submitCode() {
        val s = _state.value
        if (!s.canSubmitCode) return
        _state.update { it.copy(busy = SignInBusy.VERIFY, error = null) }
        viewModelScope.launch { finish(account.verifyCode(s.email, s.code)) }
    }

    fun changeEmail() {
        if (_state.value.busy != null) return
        _state.update { it.copy(step = SignInStep.EMAIL, code = "", error = null) }
    }

    /** [host] is the Activity the account picker attaches to. */
    fun google(host: Context) {
        if (_state.value.busy != null) return
        _state.update { it.copy(busy = SignInBusy.GOOGLE, error = null) }
        viewModelScope.launch { finish(account.signInWithGoogle(host)) }
    }

    private fun finish(result: SignInResult) {
        _state.update {
            when (result) {
                SignInResult.Success -> it.copy(busy = null, done = true)
                SignInResult.Cancelled -> it.copy(busy = null)
                is SignInResult.Error -> it.copy(busy = null, error = result.error)
            }
        }
    }

    private companion object {
        const val MAX_EMAIL = 254
    }
}
