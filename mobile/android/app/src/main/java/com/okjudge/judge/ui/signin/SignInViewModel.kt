package com.okjudge.judge.ui.signin

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.okjudge.judge.core.auth.Account
import com.okjudge.judge.core.auth.AgeCheck
import com.okjudge.judge.core.auth.SignInError
import com.okjudge.judge.core.auth.SignInResult
import com.okjudge.judge.i18n.AppLang
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** CHOOSE_PASSWORD: signed in by the code, choosing a password; leaving it skips the password. */
enum class SignInStep { EMAIL, CODE, CHOOSE_PASSWORD }

/**
 * What the email area is doing: sign in with a password, make an account
 * (password first, then the code), reset a password (code first, then the
 * password) or sign in by code alone.
 */
enum class SignInMode { PASSWORD, CREATE, FORGOT, CODE }

enum class SignInBusy { GOOGLE, SEND, VERIFY, PASSWORD }

data class SignInUiState(
    val providers: Account.Providers = Account.Providers.Loading,
    val step: SignInStep = SignInStep.EMAIL,
    val email: String = "",
    val code: String = "",
    /** Kept in memory only, until the account has it or the screen is left. */
    val password: String = "",
    val mode: SignInMode = SignInMode.PASSWORD,
    val busy: SignInBusy? = null,
    val error: SignInError? = null,
    /** Signed in: the screen hands over to where the user was going. */
    val done: Boolean = false,
    /** The "I'm 18 or older" box, required unless the phone already said 18+. */
    val ageNeeded: Boolean = true,
    val ageTicked: Boolean = false,
) {
    private val providerFlags get() = (providers as? Account.Providers.Ready)?.config?.signIn

    /** Apple sign-in is iOS only: Android never offers it, whatever the server says. */
    val showGoogle: Boolean get() = providerFlags?.google == true
    val showEmail: Boolean get() = providerFlags?.emailCode == true
    val noneAvailable: Boolean get() = providers is Account.Providers.Ready && !showGoogle && !showEmail

    val passwordSignIn: Boolean get() = (providers as? Account.Providers.Ready)?.config?.passwordSignIn == true

    /** The mode in effect: a server without passwords only has the code. */
    val flow: SignInMode get() = if (passwordSignIn) mode else SignInMode.CODE

    val ageOk: Boolean get() = !ageNeeded || ageTicked
    val canGoogle: Boolean get() = busy == null && ageOk
    val canRequestCode: Boolean
        get() = busy == null && ageOk && email.isNotBlank() && (flow != SignInMode.CREATE || password.isNotEmpty())
    val canSignInWithPassword: Boolean get() = busy == null && ageOk && email.isNotBlank() && password.isNotEmpty()
    val canSavePassword: Boolean get() = busy == null && password.isNotEmpty()
    val canSubmitCode: Boolean get() = busy == null && code.length == CODE_LENGTH

    companion object {
        const val CODE_LENGTH = 6
        const val PASSWORD_MIN = 8
        const val PASSWORD_MAX = 128
    }
}

/** The sign-in screen: Google, a password, or an emailed six-digit code. */
class SignInViewModel(private val account: Account) : ViewModel() {
    private val _state = MutableStateFlow(SignInUiState(providers = account.providers.value))
    val state: StateFlow<SignInUiState> = _state.asStateFlow()

    init {
        viewModelScope.launch { account.providers.collect { p -> _state.update { it.copy(providers = p) } } }
        viewModelScope.launch { account.platformAge.collect { p -> _state.update { it.copy(ageNeeded = AgeCheck.needsCheckbox(p)) } } }
        viewModelScope.launch { account.ageTicked.collect { t -> _state.update { it.copy(ageTicked = t) } } }
        account.loadProviders()
    }

    fun retryProviders() = account.loadProviders(force = true)

    fun onEmailChange(text: String) {
        _state.update { it.copy(email = text.take(MAX_EMAIL), error = null) }
    }

    fun onAgeTicked(ticked: Boolean) = account.setAgeTicked(ticked)

    fun onPasswordChange(text: String) {
        _state.update { it.copy(password = text.take(SignInUiState.PASSWORD_MAX), error = null) }
    }

    fun setMode(mode: SignInMode) {
        if (_state.value.busy != null) return
        _state.update { it.copy(mode = mode, step = SignInStep.EMAIL, code = "", password = "", error = null) }
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
        if (s.flow == SignInMode.CREATE && s.password.length < SignInUiState.PASSWORD_MIN) {
            _state.update { it.copy(error = SignInError.PASSWORD_SHORT) }
            return
        }
        send(lang)
    }

    fun signInWithPassword() {
        val s = _state.value
        if (!s.canSignInWithPassword) return
        if (!Account.looksLikeEmail(s.email)) {
            _state.update { it.copy(error = SignInError.INVALID_EMAIL) }
            return
        }
        _state.update { it.copy(busy = SignInBusy.PASSWORD, error = null) }
        viewModelScope.launch { finish(account.signInWithPassword(s.email, s.password)) }
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
        val setsPassword = s.flow == SignInMode.CREATE || s.flow == SignInMode.FORGOT
        viewModelScope.launch {
            val result = account.verifyCode(s.email, s.code)
            if (!setsPassword || result != SignInResult.Success) return@launch finish(result)
            // The address is proven and the account exists: ask for the password, or save the one typed for create.
            _state.update { it.copy(busy = null, step = SignInStep.CHOOSE_PASSWORD, code = "", error = null) }
            if (s.flow == SignInMode.CREATE) savePassword()
        }
    }

    /** The choose-password step: saves what was typed, then hands over. */
    fun savePassword() {
        val s = _state.value
        if (s.step != SignInStep.CHOOSE_PASSWORD || !s.canSavePassword) return
        if (s.password.length < SignInUiState.PASSWORD_MIN) {
            _state.update { it.copy(error = SignInError.PASSWORD_SHORT) }
            return
        }
        _state.update { it.copy(busy = SignInBusy.PASSWORD, error = null) }
        viewModelScope.launch {
            val error = account.setPassword(s.password, null)
            _state.update {
                when (error) {
                    null -> it.copy(busy = null, password = "", done = true)
                    // This sign-in is too old to replace a password: back to the code step for a fresh one.
                    SignInError.CURRENT_PASSWORD_REQUIRED ->
                        it.copy(busy = null, step = SignInStep.CODE, code = "", error = SignInError.CODE_EXPIRED)
                    else -> it.copy(busy = null, error = error)
                }
            }
        }
    }

    fun skipPassword() {
        if (_state.value.busy != null) return
        _state.update { it.copy(password = "", error = null, done = true) }
    }

    fun changeEmail() {
        if (_state.value.busy != null) return
        _state.update { it.copy(step = SignInStep.EMAIL, code = "", error = null) }
    }

    /** [host] is the Activity the account picker attaches to. */
    fun google(host: Context) {
        if (!_state.value.canGoogle) return
        _state.update { it.copy(busy = SignInBusy.GOOGLE, error = null) }
        viewModelScope.launch { finish(account.signInWithGoogle(host)) }
    }

    private fun finish(result: SignInResult) {
        _state.update {
            when (result) {
                SignInResult.Success -> it.copy(busy = null, password = "", done = true)
                SignInResult.Cancelled -> it.copy(busy = null)
                is SignInResult.Error -> it.copy(busy = null, error = result.error)
            }
        }
    }

    private companion object {
        const val MAX_EMAIL = 254
    }
}
