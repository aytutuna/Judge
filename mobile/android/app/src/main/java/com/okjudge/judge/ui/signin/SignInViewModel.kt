package com.okjudge.judge.ui.signin

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.okjudge.judge.core.auth.Account
import com.okjudge.judge.core.auth.LastSignInStore
import com.okjudge.judge.core.auth.SignInError
import com.okjudge.judge.core.auth.SignInMethod
import com.okjudge.judge.core.auth.SignInResult
import com.okjudge.judge.core.model.EmailMethod
import com.okjudge.judge.i18n.AppLang
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * EMAIL: Google and the address. PASSWORD: the address is known and takes a
 * password (sign in, or create one). CHOOSE_PASSWORD: signed in by the code,
 * offered a password.
 */
enum class SignInStep { EMAIL, PASSWORD, CODE, CHOOSE_PASSWORD }

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
    /** Seconds until another code may be asked for. */
    val resendIn: Int = 0,
    val lastUsed: SignInMethod? = null,
) {
    private val providerFlags get() = (providers as? Account.Providers.Ready)?.config?.signIn

    /** Apple sign-in is iOS only: Android never offers it, whatever the server says. */
    val showGoogle: Boolean get() = providerFlags?.google == true
    val showEmail: Boolean get() = providerFlags?.emailCode == true
    val noneAvailable: Boolean get() = providers is Account.Providers.Ready && !showGoogle && !showEmail

    val passwordSignIn: Boolean get() = (providers as? Account.Providers.Ready)?.config?.passwordSignIn == true

    /** The mode in effect: a server without passwords only has the code. */
    val flow: SignInMode get() = if (passwordSignIn) mode else SignInMode.CODE

    val canGoogle: Boolean get() = busy == null
    val canContinue: Boolean get() = busy == null && email.isNotBlank()
    val canRequestCode: Boolean get() = canContinue && (flow != SignInMode.CREATE || password.isNotEmpty())
    val canSignInWithPassword: Boolean get() = canContinue && password.isNotEmpty()
    val canSavePassword: Boolean get() = busy == null && password.isNotEmpty()
    val canSubmitCode: Boolean get() = busy == null && code.length == CODE_LENGTH

    companion object {
        const val CODE_LENGTH = 6
        const val PASSWORD_MIN = 8
        const val PASSWORD_MAX = 128
        const val RESEND_SECONDS = 30
    }
}

/** The sign-in screen: Google, a password, or an emailed six-digit code. */
class SignInViewModel(private val account: Account, private val last: LastSignInStore) : ViewModel() {
    private val _state = MutableStateFlow(
        SignInUiState(providers = account.providers.value, email = last.email, lastUsed = last.method),
    )
    val state: StateFlow<SignInUiState> = _state.asStateFlow()

    init {
        viewModelScope.launch { account.providers.collect { p -> _state.update { it.copy(providers = p) } } }
        account.loadProviders()
    }

    fun retryProviders() = account.loadProviders(force = true)

    fun onEmailChange(text: String) {
        _state.update { it.copy(email = text.take(MAX_EMAIL), error = null) }
    }

    fun onPasswordChange(text: String) {
        _state.update { it.copy(password = text.take(SignInUiState.PASSWORD_MAX), error = null) }
    }

    /** The email screen's Continue: the server says whether the address takes a password or the code. */
    fun continueWithEmail(lang: AppLang) {
        val s = _state.value
        if (!s.canContinue) return
        if (!Account.looksLikeEmail(s.email)) {
            _state.update { it.copy(error = SignInError.INVALID_EMAIL) }
            return
        }
        if (!s.passwordSignIn) return send(lang, SignInMode.CODE)
        _state.update { it.copy(busy = SignInBusy.SEND, error = null) }
        viewModelScope.launch {
            when (account.emailMethod(s.email)) {
                EmailMethod.CODE -> send(lang, SignInMode.CODE)
                EmailMethod.PASSWORD -> _state.update { it.copy(busy = null, step = SignInStep.PASSWORD, mode = SignInMode.PASSWORD, password = "") }
                EmailMethod.NEW -> _state.update { it.copy(busy = null, step = SignInStep.PASSWORD, mode = SignInMode.CREATE, password = "") }
            }
        }
    }

    fun forgotPassword(lang: AppLang) {
        if (_state.value.busy == null) send(lang, SignInMode.FORGOT)
    }

    fun useCode(lang: AppLang) {
        if (_state.value.busy == null) send(lang, SignInMode.CODE)
    }

    fun onCodeChange(text: String) {
        val digits = text.filter { it in '0'..'9' }.take(SignInUiState.CODE_LENGTH)
        val complete = digits.length == SignInUiState.CODE_LENGTH && digits != _state.value.code
        _state.update { it.copy(code = digits, error = null) }
        if (complete) submitCode()
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
        send(lang, s.flow)
    }

    fun signInWithPassword() {
        val s = _state.value
        if (!s.canSignInWithPassword) return
        if (!Account.looksLikeEmail(s.email)) {
            _state.update { it.copy(error = SignInError.INVALID_EMAIL) }
            return
        }
        _state.update { it.copy(busy = SignInBusy.PASSWORD, error = null) }
        account.setAgeTicked(true)
        viewModelScope.launch { finish(account.signInWithPassword(s.email, s.password), SignInMethod.EMAIL, s.email.trim()) }
    }

    fun resend(lang: AppLang) {
        val s = _state.value
        if (s.busy == null && s.resendIn == 0) send(lang, s.mode)
    }

    private fun send(lang: AppLang, mode: SignInMode) {
        val email = _state.value.email.trim()
        _state.update { it.copy(busy = SignInBusy.SEND, error = null) }
        // Continuing is the consent the screen's last line states.
        account.setAgeTicked(true)
        viewModelScope.launch {
            val error = account.sendCode(email, lang)
            _state.update {
                // Create keeps the password typed for after the code; the others start the next one empty.
                if (error == null) {
                    it.copy(busy = null, step = SignInStep.CODE, mode = mode, code = "", email = email, password = if (mode == SignInMode.CREATE) it.password else "")
                } else {
                    it.copy(busy = null, error = error)
                }
            }
            if (error == null) startCountdown() else account.setAgeTicked(false)
        }
    }

    private var countdown: Job? = null

    private fun startCountdown() {
        countdown?.cancel()
        countdown = viewModelScope.launch {
            for (n in SignInUiState.RESEND_SECONDS downTo 1) {
                _state.update { it.copy(resendIn = n) }
                delay(1000)
            }
            _state.update { it.copy(resendIn = 0) }
        }
    }

    fun submitCode() {
        val s = _state.value
        if (!s.canSubmitCode) return
        _state.update { it.copy(busy = SignInBusy.VERIFY, error = null) }
        account.setAgeTicked(true)
        val setsPassword = s.flow == SignInMode.CREATE || s.flow == SignInMode.FORGOT
        viewModelScope.launch {
            val result = account.verifyCode(s.email, s.code)
            if (result != SignInResult.Success || !(setsPassword || account.needsPassword)) {
                return@launch finish(result, SignInMethod.EMAIL, s.email.trim())
            }
            rememberSignIn(SignInMethod.EMAIL, s.email.trim())
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
                    null, SignInError.PASSWORD_NOT_TAKEN -> it.copy(busy = null, password = "", done = true)
                    // This sign-in is too old to replace a password: back to the code step for a fresh one.
                    SignInError.CURRENT_PASSWORD_REQUIRED ->
                        it.copy(busy = null, step = SignInStep.CODE, code = "", error = SignInError.CODE_EXPIRED)
                    else -> it.copy(busy = null, error = error)
                }
            }
        }
    }

    /** Stays signed in without a password. */
    fun skipPassword() {
        if (_state.value.step != SignInStep.CHOOSE_PASSWORD) return
        _state.update { it.copy(password = "", done = true) }
    }

    fun changeEmail() {
        if (_state.value.busy != null) return
        countdown?.cancel()
        _state.update { it.copy(step = SignInStep.EMAIL, mode = SignInMode.PASSWORD, code = "", password = "", resendIn = 0, error = null) }
    }

    /** [host] is the Activity the account picker attaches to. */
    fun google(host: Context) {
        if (!_state.value.canGoogle) return
        _state.update { it.copy(busy = SignInBusy.GOOGLE, error = null) }
        account.setAgeTicked(true)
        viewModelScope.launch {
            val result = account.signInWithGoogle(host)
            finish(result, SignInMethod.GOOGLE, account.grantEmail)
        }
    }

    fun signInDev() {
        if (_state.value.busy != null) return
        _state.update { it.copy(busy = SignInBusy.PASSWORD, error = null) }
        viewModelScope.launch { finish(account.signInDev()) }
    }

    private fun rememberSignIn(method: SignInMethod, email: String?) {
        last.save(method, email)
        _state.update { it.copy(lastUsed = method) }
    }

    private fun finish(result: SignInResult, method: SignInMethod? = null, email: String? = null) {
        if (result == SignInResult.Success && method != null) rememberSignIn(method, email)
        if (result == SignInResult.Cancelled || result is SignInResult.Error) account.setAgeTicked(false)
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
