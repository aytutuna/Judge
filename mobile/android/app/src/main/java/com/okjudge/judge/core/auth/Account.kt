package com.okjudge.judge.core.auth

import android.content.Context
import com.okjudge.judge.core.api.ApiResult
import com.okjudge.judge.core.api.JudgeApi
import com.okjudge.judge.core.api.TokenStore
import com.okjudge.judge.core.display.UiError
import com.okjudge.judge.core.model.Entitlement
import com.okjudge.judge.core.model.MeResponse
import com.okjudge.judge.core.model.ServerConfig
import com.okjudge.judge.core.model.SessionGrant
import com.okjudge.judge.i18n.AppLang
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Why a sign-in step failed, resolved to copy on the sign-in screen. */
enum class SignInError {
    INVALID_EMAIL,
    CODE_INVALID,
    CODE_EXPIRED,
    CODE_TOO_MANY,
    RATE_LIMITED,
    /** The method is off on the server (404) or the server is down. */
    UNAVAILABLE,
    /** Google sign-in cannot run on this device or build. */
    PROVIDER_UNAVAILABLE,
    OFFLINE,
    FAILED,
}

sealed interface SignInResult {
    data object Success : SignInResult
    data object Cancelled : SignInResult
    data class Error(val error: SignInError) : SignInResult
}

/**
 * The session: whether the app is signed in, the account behind it, the
 * sign-in methods the server offers, and every way in and out (Google,
 * email code, sign-out, account deletion, an expired session).
 *
 * The token lives in [tokens]; [JudgeApi] reads it for every call. Local
 * verdict history is never touched here.
 */
class Account(
    private val api: JudgeApi,
    private val tokens: TokenStore,
    private val google: GoogleIdTokenSource,
    private val scope: CoroutineScope,
    private val io: CoroutineDispatcher = Dispatchers.IO,
) {
    sealed interface State {
        data object SignedOut : State

        /** [me] is null until /api/v1/me answers; [loadFailed] when the last lookup failed. */
        data class SignedIn(val me: MeResponse? = null, val loadFailed: Boolean = false) : State
    }

    sealed interface Providers {
        data object Loading : Providers
        data class Ready(val config: ServerConfig) : Providers
        data object Failed : Providers
    }

    /** One-off messages for the app shell (snackbar, routing to sign-in). */
    enum class Notice { SIGNED_OUT, SESSION_EXPIRED, DELETED, DELETE_FAILED }

    private val _state = MutableStateFlow<State>(if (tokens.get() != null) State.SignedIn() else State.SignedOut)
    val state: StateFlow<State> = _state.asStateFlow()

    private val _providers = MutableStateFlow<Providers>(Providers.Loading)
    val providers: StateFlow<Providers> = _providers.asStateFlow()

    private val _notices = Channel<Notice>(Channel.BUFFERED)
    val notices: Flow<Notice> = _notices.receiveAsFlow()

    val isSignedIn: Boolean get() = _state.value is State.SignedIn

    /** A sign-out or deletion is in flight: the account actions wait for it. */
    private val _working = MutableStateFlow(false)
    val working: StateFlow<Boolean> = _working.asStateFlow()

    /** Loads /api/v1/config unless it is already known (or [force]). */
    fun loadProviders(force: Boolean = false) {
        if (!force && _providers.value is Providers.Ready) return
        scope.launch {
            val had = _providers.value as? Providers.Ready
            if (had == null) _providers.value = Providers.Loading
            _providers.value = when (val res = api.config()) {
                is ApiResult.Ok -> Providers.Ready(res.value)
                is ApiResult.Err -> had ?: Providers.Failed
            }
        }
    }

    /** Re-reads the account. A token the server no longer knows ends the session. */
    suspend fun refresh() {
        if (_state.value !is State.SignedIn) return
        val asked = tokens.get() ?: return
        val res = api.me()
        // An answer about an older session (signed out or in again meanwhile) is dropped.
        if (tokens.get() != asked) return
        when (res) {
            is ApiResult.Ok -> if (res.value.user == null) {
                expire()
            } else {
                if (_state.value is State.SignedIn) _state.value = State.SignedIn(res.value)
            }
            is ApiResult.Err -> {
                val current = _state.value as? State.SignedIn ?: return
                _state.value = current.copy(loadFailed = true)
            }
        }
    }

    fun refreshInBackground() {
        scope.launch { refresh() }
    }

    /** A balance a premium response carried (applyEntitlement): shown at once, before /me is read again. */
    fun applyEntitlement(entitlement: Entitlement) {
        val current = _state.value as? State.SignedIn ?: return
        val me = current.me ?: return
        if (me.user == null) return
        _state.value = current.copy(me = me.copy(entitlement = entitlement))
    }

    suspend fun signInWithGoogle(host: Context): SignInResult =
        when (val got = google.idToken(host)) {
            GoogleIdResult.Cancelled -> SignInResult.Cancelled
            GoogleIdResult.Unavailable -> SignInResult.Error(SignInError.PROVIDER_UNAVAILABLE)
            GoogleIdResult.Failed -> SignInResult.Error(SignInError.FAILED)
            is GoogleIdResult.Token -> when (val res = api.signInWithGoogle(got.idToken)) {
                is ApiResult.Ok -> complete(res.value)
                is ApiResult.Err -> SignInResult.Error(socialError(res.error))
            }
        }

    /** Emails a sign-in code; null when it was sent. */
    suspend fun sendCode(email: String, lang: AppLang): SignInError? =
        when (val res = api.sendSignInCode(email.trim(), lang)) {
            is ApiResult.Ok -> null
            is ApiResult.Err -> codeSendError(res.error)
        }

    suspend fun verifyCode(email: String, code: String): SignInResult =
        when (val res = api.signInWithCode(email.trim(), code.trim())) {
            is ApiResult.Ok -> complete(res.value)
            is ApiResult.Err -> SignInResult.Error(codeVerifyError(res.error))
        }

    private suspend fun complete(grant: SessionGrant): SignInResult {
        // Stored token and state change together, even if the screen goes away now.
        withContext(NonCancellable) {
            withContext(io) { tokens.set(grant.token) }
            _state.value = State.SignedIn()
        }
        refreshInBackground()
        return SignInResult.Success
    }

    /** Ends the session on the server when it can, and on the phone always. */
    suspend fun signOut() {
        if (!_working.compareAndSet(expect = false, update = true)) return
        try {
            api.signOut()
        } finally {
            withContext(NonCancellable) { endLocally(Notice.SIGNED_OUT) }
            _working.value = false
        }
    }

    /** Deletes the account; true when the server confirmed. History on the phone stays. */
    suspend fun deleteAccount(): Boolean {
        if (!_working.compareAndSet(expect = false, update = true)) return false
        try {
            val res = api.deleteAccount()
            val deleted = when {
                res is ApiResult.Ok -> true
                // No answer in time: the server may have finished anyway. A session
                // that no longer has a user means it did.
                res is ApiResult.Err && res.error == UiError.Timeout ->
                    (api.me() as? ApiResult.Ok)?.value?.let { it.user == null } == true
                else -> false
            }
            if (deleted) {
                withContext(NonCancellable) { endLocally(Notice.DELETED) }
                return true
            }
            // An expired session was already handled (and announced) by onSessionExpired.
            val error = (res as? ApiResult.Err)?.error
            if (error == null || !error.isSigninRequired()) _notices.trySend(Notice.DELETE_FAILED)
            return false
        } finally {
            _working.value = false
        }
    }

    /** JudgeApi saw a 401 `signin_required` and has cleared the token. */
    fun onSessionExpired() = expire()

    private fun expire() {
        val wasSignedIn = _state.value is State.SignedIn
        tokens.clear()
        _state.value = State.SignedOut
        if (wasSignedIn) _notices.trySend(Notice.SESSION_EXPIRED)
    }

    private suspend fun endLocally(notice: Notice) {
        withContext(io) { tokens.clear() }
        _state.value = State.SignedOut
        _notices.trySend(notice)
    }

    companion object {
        private val EMAIL = Regex("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$")

        fun looksLikeEmail(email: String): Boolean = EMAIL.matches(email.trim())

        private fun UiError.isSigninRequired() = this is UiError.Api && status == 401 && code == "signin_required"

        private fun common(e: UiError): SignInError? = when (e) {
            UiError.Offline -> SignInError.OFFLINE
            UiError.Timeout, UiError.Unknown -> SignInError.FAILED
            is UiError.Api -> when {
                e.status == 429 -> SignInError.RATE_LIMITED
                e.status >= 500 -> SignInError.UNAVAILABLE
                else -> null
            }
        }

        fun codeSendError(e: UiError): SignInError = common(e) ?: when ((e as UiError.Api).status) {
            404 -> SignInError.UNAVAILABLE
            400 -> SignInError.INVALID_EMAIL
            else -> SignInError.FAILED
        }

        fun codeVerifyError(e: UiError): SignInError = common(e) ?: (e as UiError.Api).let {
            when {
                it.code == "OTP_EXPIRED" -> SignInError.CODE_EXPIRED
                it.code == "TOO_MANY_ATTEMPTS" || it.status == 403 -> SignInError.CODE_TOO_MANY
                it.status == 404 -> SignInError.UNAVAILABLE
                it.status == 400 -> SignInError.CODE_INVALID
                else -> SignInError.FAILED
            }
        }

        fun socialError(e: UiError): SignInError = common(e) ?: when ((e as UiError.Api).status) {
            404 -> SignInError.PROVIDER_UNAVAILABLE
            else -> SignInError.FAILED
        }
    }
}
