package com.okjudge.judge.core.auth

import android.content.Context
import com.okjudge.judge.core.api.ApiResult
import com.okjudge.judge.core.api.JudgeApi
import com.okjudge.judge.core.api.TokenStore
import com.okjudge.judge.core.display.UiError
import com.okjudge.judge.core.model.AgeStatus
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
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull

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
 *
 * It also runs the 18+ check: the phone's age signal ([ageSignals]) when
 * there is one, else the checkbox, reported to the server once the account
 * is known. [ageGate] is what the app shows for it.
 */
class Account(
    private val api: JudgeApi,
    private val tokens: TokenStore,
    private val google: GoogleIdTokenSource,
    private val scope: CoroutineScope,
    private val io: CoroutineDispatcher = Dispatchers.IO,
    private val ageSignals: AgeSignalSource = AgeSignalSource.None,
    /** A phone that hasn't answered by then counts as unknown, so the checkbox can take over. */
    private val platformTimeoutMs: Long = 10_000,
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

    /** Runs when the user signed out or deleted the account (not when the session expired). */
    var onEndedByUser: suspend () -> Unit = {}

    /** Runs after each successful sign-in. */
    var onSignedIn: () -> Unit = {}

    /** A sign-out or deletion is in flight: the account actions wait for it. */
    private val _working = MutableStateFlow(false)
    val working: StateFlow<Boolean> = _working.asStateFlow()

    /** The last deletion failed; the age cover shows it, since the snackbar sits under it. */
    private val _deleteFailed = MutableStateFlow(false)
    val deleteFailed: StateFlow<Boolean> = _deleteFailed.asStateFlow()

    /** The phone's answer, asked at most once per run; null until it answered. */
    private val _platformAge = MutableStateFlow<PlatformAge?>(null)
    val platformAge: StateFlow<PlatformAge?> = _platformAge.asStateFlow()
    private var askingPlatform = false

    /** The "I'm 18 or older" checkbox, on the sign-in screen and the sheet alike. */
    private val _ageTicked = MutableStateFlow(false)
    val ageTicked: StateFlow<Boolean> = _ageTicked.asStateFlow()

    /** A POST /api/v1/me/age is in flight. */
    private val _agePosting = MutableStateFlow(false)
    /** A report came up while another was in flight: settle again once it is done. */
    private var ageResettle = false
    val agePosting: StateFlow<Boolean> = _agePosting.asStateFlow()

    /** Why the last report failed; the sheet shows it. */
    private val _ageError = MutableStateFlow<UiError?>(null)
    val ageError: StateFlow<UiError?> = _ageError.asStateFlow()

    val ageGate: StateFlow<AgeGate> = combine(_state, _platformAge, _agePosting) { state, platform, posting ->
        AgeCheck.gate(platform, state is State.SignedIn, (state as? State.SignedIn)?.me?.age, posting)
    }.stateIn(scope, SharingStarted.Eagerly, AgeGate.NONE)

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
                tokens.setUser(res.value.user.id)
                if (_state.value is State.SignedIn) {
                    _state.value = State.SignedIn(res.value)
                    settleAge()
                }
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

    fun setAgeTicked(ticked: Boolean) {
        _ageTicked.value = ticked
        _ageError.value = null
    }

    /**
     * Whether the phone should be asked now: not asked yet, and either the
     * sign-in screen is up ([onSignIn]) or the signed-in account still has
     * to confirm. A confirmed account is not asked again.
     */
    fun needsPlatformAge(onSignIn: Boolean): Boolean {
        if (_platformAge.value != null || askingPlatform) return false
        return when (val state = _state.value) {
            State.SignedOut -> onSignIn
            is State.SignedIn -> state.me?.age?.let { !it.confirmed && !it.blocked } == true
        }
    }

    /** Asks the phone's age signal; [host] is the Activity its prompt may attach to. */
    fun checkPlatformAge(host: Context) {
        if (_platformAge.value != null || askingPlatform) return
        askingPlatform = true
        scope.launch {
            val answer = try {
                withTimeoutOrNull(platformTimeoutMs) { ageSignals.check(host) } ?: PlatformAge.UNKNOWN
            } finally {
                askingPlatform = false
            }
            _platformAge.value = answer
            settleAge()
        }
    }

    /**
     * Why a verdict or a purchase has to wait, or null when nothing about age
     * stands in the way: [AgeCheck.BLOCKED] for under 18 or a blocked account,
     * [AgeCheck.UNCONFIRMED] while unconfirmed or while the phone's check or
     * a report is still running. A server without the age check sends no age.
     */
    fun ageRefusal(): String? {
        val age = (_state.value as? State.SignedIn)?.me?.age
        return when {
            _platformAge.value == PlatformAge.MINOR || age?.blocked == true -> AgeCheck.BLOCKED
            age == null -> null
            askingPlatform || _agePosting.value || !age.confirmed -> AgeCheck.UNCONFIRMED
            else -> null
        }
    }

    /** The sheet's "Continue": confirms 18+ for the signed-in account. */
    suspend fun confirmAge() {
        if (!_ageTicked.value && _platformAge.value != PlatformAge.ADULT) return
        postAge(AgeCheck.confirmation(_platformAge.value))
    }

    /** JudgeApi saw a 403 age error: the account on screen is behind, so show what the server asks for. */
    fun onAgeGate(code: String) {
        val current = _state.value as? State.SignedIn ?: return
        val me = current.me ?: return
        val age = me.age ?: AgeStatus()
        val updated = if (code == AgeCheck.BLOCKED) age.copy(blocked = true) else age.copy(confirmed = false)
        _state.value = current.copy(me = me.copy(age = updated))
        scope.launch { settleAge() }
    }

    /** Tells the server what is known: the phone's answer, or the box ticked before signing in. */
    private suspend fun settleAge() {
        val me = (_state.value as? State.SignedIn)?.me ?: return
        val report = AgeCheck.report(_platformAge.value, me.age, _ageTicked.value) ?: return
        postAge(report)
    }

    private suspend fun postAge(report: AgeCheck.Report) {
        if (!_agePosting.compareAndSet(expect = false, update = true)) {
            ageResettle = true
            return
        }
        val asked = tokens.get()
        try {
            _ageError.value = null
            val res = api.reportAge(report.adult, report.source)
            if (tokens.get() != asked) return
            val current = _state.value as? State.SignedIn ?: return
            val me = current.me ?: return
            when (res) {
                is ApiResult.Ok -> _state.value = current.copy(me = me.copy(age = res.value))
                // A 403 age error already updated the account through onAgeGate.
                is ApiResult.Err -> if (!AgeCheck.isAgeError(res.error)) _ageError.value = res.error
            }
        } finally {
            _agePosting.value = false
        }
        if (ageResettle) {
            ageResettle = false
            settleAge()
        }
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
        // The verdict waiting behind sign-in needs the age on record first, so
        // the box ticked (or the phone's 18+) is reported before "signed in".
        val reportsAge = _ageTicked.value || _platformAge.value == PlatformAge.ADULT
        // Stored token and state change together, even if the screen goes away now.
        withContext(NonCancellable) {
            withContext(io) { tokens.set(grant.token) }
            _state.value = State.SignedIn()
            if (reportsAge) refresh()
            onSignedIn()
        }
        if (!reportsAge) refreshInBackground()
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

    /** Deletes the account; true when the server confirmed. */
    suspend fun deleteAccount(): Boolean {
        if (!_working.compareAndSet(expect = false, update = true)) return false
        _deleteFailed.value = false
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
            if (error == null || !error.isSigninRequired()) {
                _deleteFailed.value = true
                _notices.trySend(Notice.DELETE_FAILED)
            }
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
        forgetAgeAnswers()
        _state.value = State.SignedOut
        if (wasSignedIn) _notices.trySend(Notice.SESSION_EXPIRED)
    }

    private suspend fun endLocally(notice: Notice) {
        withContext(io) { tokens.clear() }
        forgetAgeAnswers()
        _state.value = State.SignedOut
        onEndedByUser()
        _notices.trySend(notice)
    }

    /** The next person to sign in on this phone ticks the box for themselves; the phone's own answer stays. */
    private fun forgetAgeAnswers() {
        _ageTicked.value = false
        _ageError.value = null
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
