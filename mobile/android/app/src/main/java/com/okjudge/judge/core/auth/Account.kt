package com.okjudge.judge.core.auth

import android.content.Context
import com.okjudge.judge.core.api.ApiResult
import com.okjudge.judge.core.api.JudgeApi
import com.okjudge.judge.core.api.TokenStore
import com.okjudge.judge.core.display.UiError
import com.okjudge.judge.core.model.AgeHint
import com.okjudge.judge.core.model.EmailMethod
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
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import java.time.LocalDate

/** Why a sign-in step failed, resolved to copy on the sign-in screen. */
enum class SignInError {
    INVALID_EMAIL,
    CODE_INVALID,
    CODE_EXPIRED,
    CODE_TOO_MANY,
    /** Wrong password, unknown address or an account without a password: the server answers alike. */
    PASSWORD_WRONG,
    PASSWORD_SHORT,
    PASSWORD_SAVE_FAILED,
    /** The server takes no password for this account (the review account): the sign-in stands without one. */
    PASSWORD_NOT_TAKEN,
    CURRENT_PASSWORD_WRONG,
    CURRENT_PASSWORD_REQUIRED,
    RATE_LIMITED,
    /** The method is off on the server (404) or the server is down. */
    UNAVAILABLE,
    /** Google sign-in cannot run on this device or build. */
    PROVIDER_UNAVAILABLE,
    OFFLINE,
    FAILED,
}

/** Why a deletion needs another step; the delete sheet shows it. Other failures are [Account.Notice.DELETE_FAILED]. */
enum class DeleteProblem {
    /** No password to check and the sign-in is too old: sign in again first. */
    REAUTH_REQUIRED,
    PASSWORD_WRONG,
    RATE_LIMITED,
}

sealed interface SignInResult {
    data object Success : SignInResult
    data object Cancelled : SignInResult
    data class Error(val error: SignInError) : SignInResult
}

/**
 * The session: whether the app is signed in, the account behind it, the
 * sign-in methods the server offers, and every way in and out (Google,
 * email code or password, sign-out, account deletion, an expired session).
 *
 * The token lives in [tokens]; [JudgeApi] reads it for every call. Local
 * verdict history is never touched here.
 *
 * It also runs the age check: the date of birth the server asks for, and the
 * phone's age signal ([ageSignals]), which is only reported and never acted
 * on here. [ageGate] is what the app shows for it.
 */
class Account(
    private val api: JudgeApi,
    private val tokens: TokenStore,
    private val google: GoogleIdTokenSource,
    private val scope: CoroutineScope,
    private val io: CoroutineDispatcher = Dispatchers.IO,
    private val ageSignals: AgeSignalSource = AgeSignalSource.None,
    /** A phone that hasn't answered by then counts as unknown. */
    private val platformTimeoutMs: Long = 10_000,
    private val ageHold: AgeHoldStore = AgeHoldStore.Memory(),
    /** The Play store's country (two letters), or null while the store has not said. */
    private val storeCountry: suspend () -> String? = { null },
) {
    sealed interface State {
        /** The stored token is still being read off the main thread. */
        data object Loading : State

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

    private val _state = MutableStateFlow<State>(State.Loading)
    val state: StateFlow<State> = _state.asStateFlow()

    private val _providers = MutableStateFlow<Providers>(Providers.Loading)
    val providers: StateFlow<Providers> = _providers.asStateFlow()

    private val _notices = Channel<Notice>(Channel.BUFFERED)
    val notices: Flow<Notice> = _notices.receiveAsFlow()

    val isSignedIn: Boolean get() = _state.value is State.SignedIn

    init {
        // The Keystore read is slow enough to be felt on the main thread.
        scope.launch {
            val signedIn = withContext(io) { tokens.get() } != null
            _state.compareAndSet(State.Loading, if (signedIn) State.SignedIn() else State.SignedOut)
        }
    }

    /** Runs when the user signed out or deleted the account (not when the session expired). */
    var onEndedByUser: suspend () -> Unit = {}

    /** Runs just before the account leaves SignedIn (sign-out, deletion, expiry). */
    var onLeaving: () -> Unit = {}

    /** Runs after the account was deleted. */
    var onDeleted: () -> Unit = {}

    /** The address the last session grant named; Google gives none of its own. */
    var grantEmail: String? = null
        private set

    /** Runs after each successful sign-in. */
    var onSignedIn: () -> Unit = {}

    /** A sign-out or deletion is in flight: the account actions wait for it. */
    private val _working = MutableStateFlow(false)
    val working: StateFlow<Boolean> = _working.asStateFlow()

    /** The last deletion failed; the age cover shows it, since the snackbar sits under it. */
    private val _deleteFailed = MutableStateFlow(false)
    val deleteFailed: StateFlow<Boolean> = _deleteFailed.asStateFlow()

    private val _deleteProblem = MutableStateFlow<DeleteProblem?>(null)
    val deleteProblem: StateFlow<DeleteProblem?> = _deleteProblem.asStateFlow()

    fun clearDeleteProblem() {
        _deleteProblem.value = null
    }

    /** The phone's answer, asked at most once per run; null until it answered. */
    private val _platformAge = MutableStateFlow<PlatformAge?>(null)
    private var askedThisRun = false

    /**
     * The approval cover is up. Seeded from the stored flag, so it drives only the gate and [ageRefusal];
     * what is reported to the server is only what Play answered on this run ([_platformAge]).
     */
    private val _held = MutableStateFlow(ageHold.held)
    val platformAge: StateFlow<PlatformAge?> = _platformAge.asStateFlow()
    val held: StateFlow<Boolean> = _held.asStateFlow()
    private val _askingPlatform = MutableStateFlow(false)
    private var askingPlatform: Boolean
        get() = _askingPlatform.value
        set(value) {
            _askingPlatform.value = value
        }

    /** A POST /api/v1/me/age is in flight. */
    private val _agePosting = MutableStateFlow(false)
    /** A signal came up while another post was in flight: settle again once it is done. */
    private var ageResettle = false
    val agePosting: StateFlow<Boolean> = _agePosting.asStateFlow()

    /** The last date could not be saved; the date step says so. */
    private val _ageFailed = MutableStateFlow(false)
    val ageFailed: StateFlow<Boolean> = _ageFailed.asStateFlow()

    /** The session whose store signal the server already has, so it is sent once per launch. */
    private var signalSentFor: String? = null

    /** The session whose store country the server already has. */
    private var storeCountrySentFor: String? = null

    val ageGate: StateFlow<AgeGate> = combine(_state, _held) { state, held ->
        AgeCheck.gate(state is State.SignedIn, (state as? State.SignedIn)?.me?.age, if (held) PlatformAge.MINOR_UNAPPROVED else null)
    }.stateIn(scope, SharingStarted.Eagerly, AgeGate.NONE)

    /** The phone's check or a report is running: actions wait a moment, with no change to the account. */
    val ageChecking: StateFlow<Boolean> = combine(_askingPlatform, _agePosting) { asking, posting -> asking || posting }
        .stateIn(scope, SharingStarted.Eagerly, false)

    /** The signed-in account is 13 to 17: usage statistics and the training card stay off. */
    val teen: StateFlow<Boolean> = _state.map { ((it as? State.SignedIn)?.me?.age)?.teen == true }
        .stateIn(scope, SharingStarted.Eagerly, false)

    /**
     * Usage statistics are off whatever the setting says: true for a teen, a blocked account or one that
     * needs a date; null while a signed-in account's /me has not answered (nothing is known, nothing is lost).
     */
    val statsLocked: StateFlow<Boolean?> = _state.map { state ->
        when (state) {
            State.Loading -> null
            State.SignedOut -> false
            is State.SignedIn -> state.me?.let { AgeCheck.usageStatsLocked(it.age) }
        }
    }.stateIn(scope, SharingStarted.Eagerly, null)

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
        _state.first { it !is State.Loading }
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
                    settleStoreCountry()
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

    /**
     * Whether the phone should be asked now: not asked yet, and either the
     * sign-in screen is up ([onSignIn]) or the signed-in account is known and
     * not finally blocked. The answer is sent on every launch, so a store
     * "adult" can later clear an earlier "minor".
     */
    fun needsPlatformAge(onSignIn: Boolean): Boolean {
        if (askedThisRun || askingPlatform) return false
        return when (val state = _state.value) {
            State.Loading -> false
            State.SignedOut -> onSignIn
            is State.SignedIn -> state.me?.age?.let { !(it.blocked && !it.needsDob) } == true
        }
    }

    /** Asks the phone's age signal; [host] is the Activity its prompt may attach to. */
    fun checkPlatformAge(host: Context) {
        if (askedThisRun) return
        askPlatformAge(host)
    }

    /**
     * Asks again while the approval cover is up. The hold ends only on a shared answer that is not a held minor;
     * declining to share, errors, timeouts and dismissed prompts leave it up.
     */
    fun recheckPlatformAge(host: Context) {
        if (_held.value) askPlatformAge(host)
    }

    private fun askPlatformAge(host: Context) {
        if (askingPlatform) return
        askingPlatform = true
        askedThisRun = true
        scope.launch {
            val answer = try {
                withTimeoutOrNull(platformTimeoutMs) { ageSignals.check(host) } ?: PlatformAge.UNKNOWN
            } finally {
                askingPlatform = false
            }
            _platformAge.value = answer
            // Only a definite answer moves the hold; an error, timeout or dismissed prompt leaves it as it was.
            if (answer != PlatformAge.UNKNOWN) {
                _held.value = answer == PlatformAge.MINOR_UNAPPROVED
                ageHold.held = _held.value
            }
            settleAge()
        }
    }

    /**
     * Why a verdict or a purchase has to wait, or null when nothing about age
     * stands in the way: [AgeCheck.BLOCKED] for a blocked account,
     * [AgeCheck.UNCONFIRMED] until the server has confirmed it, and
     * [AgeCheck.CHECKING] while the phone's check or a report is still running. A server without the age
     * check sends no age. Only the server's word counts; the phone's signal is
     * reported, never used here.
     */
    fun ageRefusal(): String? {
        val age = (_state.value as? State.SignedIn)?.me?.age ?: return null
        return when {
            age.blocked || age.restricted || age.parent != null || _held.value -> AgeCheck.BLOCKED
            !age.confirmed -> AgeCheck.UNCONFIRMED
            askingPlatform || _agePosting.value -> AgeCheck.CHECKING
            else -> null
        }
    }

    /** Sends [dob]. The answer, or a refetch of /me when the account moved on, decides what shows next. */
    suspend fun submitDob(dob: LocalDate, country: String? = null, quebec: Boolean? = null) {
        if (!_agePosting.compareAndSet(expect = false, update = true)) return
        val asked = tokens.get()
        var refetch = false
        var liftedBlock = false
        try {
            _ageFailed.value = false
            val store = storeCountry()
            val res = api.submitDob(dob.toString(), store, country, quebec)
            if (tokens.get() != asked) return
            val current = _state.value as? State.SignedIn ?: return
            val me = current.me ?: return
            when (res) {
                is ApiResult.Ok -> {
                    liftedBlock = me.age?.blocked == true && !res.value.blocked
                    if (store != null) storeCountrySentFor = asked
                    _state.value = current.copy(me = me.copy(age = res.value))
                }
                is ApiResult.Err -> {
                    val e = res.error
                    // The account moved on (another device, a retry that landed): see what the server says now.
                    if (e is UiError.Api && (e.code == AgeCheck.AGE_SET || e.code == AgeCheck.BLOCKED)) refetch = true else _ageFailed.value = true
                }
            }
        } finally {
            _agePosting.value = false
        }
        if (refetch) {
            refresh()
            if ((_state.value as? State.SignedIn)?.me?.age?.needsDob == true) _ageFailed.value = true
        }
        if (liftedBlock) {
            // The server ignored the store signal while the account was blocked: send it again now.
            signalSentFor = null
            settleAge()
        } else {
            settleLater()
        }
    }

    /** The request IP's guess for the date step's country and Quebec questions; null when it could not be read. */
    suspend fun ageHint(): AgeHint? = (api.ageHint() as? ApiResult.Ok)?.value

    /** The date step went back to the picker: the old failure no longer applies. */
    fun clearAgeFailed() {
        _ageFailed.value = false
    }

    /** JudgeApi saw a 403 age error: the account on screen is behind, so read what the server says now. */
    fun onAgeGate(@Suppress("UNUSED_PARAMETER") code: String) {
        scope.launch { refresh() }
    }

    /** Tells the server the store's answer, once per launch. */
    private suspend fun settleAge() {
        val me = (_state.value as? State.SignedIn)?.me ?: return
        val report = AgeCheck.report(_platformAge.value, me.age) ?: return
        val asked = tokens.get() ?: return
        if (signalSentFor == asked) return
        postSignal(report, asked)
    }

    private suspend fun postSignal(report: AgeCheck.Report, asked: String) {
        if (!_agePosting.compareAndSet(expect = false, update = true)) {
            ageResettle = true
            return
        }
        try {
            val res = api.reportAge(report.adult, report.under13)
            if (tokens.get() != asked) return
            val current = _state.value as? State.SignedIn ?: return
            val me = current.me ?: return
            if (res is ApiResult.Ok) {
                // A blocked account's signal is dropped by the server, so it does not count as sent.
                if (me.age?.blocked != true) signalSentFor = asked
                _state.value = current.copy(me = me.copy(age = res.value))
            }
        } finally {
            _agePosting.value = false
        }
        settleLater()
    }

    /**
     * Tells the server the Play store's country once per launch, for an account with a date on file. It can
     * only add the parent step or the Brazil refusal. The date step sends it itself.
     */
    suspend fun settleStoreCountry() {
        val age = (_state.value as? State.SignedIn)?.me?.age ?: return
        if (age.needsDob || (age.blocked && !age.needsDob)) return
        val asked = tokens.get() ?: return
        if (storeCountrySentFor == asked) return
        val code = storeCountry() ?: return
        if (!_agePosting.compareAndSet(expect = false, update = true)) {
            ageResettle = true
            return
        }
        try {
            val res = api.reportStoreCountry(code)
            if (tokens.get() != asked) return
            val current = _state.value as? State.SignedIn ?: return
            val me = current.me ?: return
            if (res is ApiResult.Ok) {
                storeCountrySentFor = asked
                _state.value = current.copy(me = me.copy(age = res.value))
            }
        } finally {
            _agePosting.value = false
        }
        settleLater()
    }

    private suspend fun settleLater() {
        if (ageResettle) {
            ageResettle = false
            settleAge()
            settleStoreCountry()
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

    /**
     * Which sign-in the address takes. A server without the lookup (404) has
     * no passwords, so it is the code; any other failure falls back to the
     * password screen, which still offers the code.
     */
    suspend fun emailMethod(email: String): EmailMethod =
        when (val res = api.lookupEmail(email.trim())) {
            is ApiResult.Ok -> res.value
            is ApiResult.Err -> if (res.error is UiError.Api && res.error.status == 404) EmailMethod.CODE else EmailMethod.PASSWORD
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

    /** Debug builds only: the local server's test sign-in. */
    suspend fun signInDev(): SignInResult =
        when (val res = api.devLogin()) {
            is ApiResult.Ok -> complete(res.value)
            is ApiResult.Err -> SignInResult.Error(passwordSignInError(res.error))
        }

    /** The account that just signed in by code has no password and the server wants one. */
    val needsPassword: Boolean get() = (_state.value as? State.SignedIn)?.me?.needsPassword == true

    suspend fun signInWithPassword(email: String, password: String): SignInResult =
        when (val res = api.signInWithPassword(email.trim(), password)) {
            is ApiResult.Ok -> complete(res.value)
            is ApiResult.Err -> SignInResult.Error(passwordSignInError(res.error))
        }

    /**
     * Sets or replaces the password of the signed-in account; null when saved.
     * [current] replaces a password on a session that is not a fresh code sign-in.
     */
    suspend fun setPassword(password: String, current: String?, lang: AppLang): SignInError? {
        val asked = tokens.get()
        return when (val res = api.setPassword(password, current, lang)) {
            is ApiResult.Ok -> {
                if (tokens.get() == asked) {
                    val signedIn = _state.value as? State.SignedIn
                    val me = signedIn?.me
                    if (signedIn != null && me != null) _state.value = signedIn.copy(me = me.copy(hasPassword = true, needsPassword = false))
                }
                null
            }
            is ApiResult.Err -> passwordSaveError(res.error)
        }
    }

    private suspend fun complete(grant: SessionGrant): SignInResult {
        // The verdict waiting behind sign-in needs the age state first (the date
        // step may come before it), so /me is read before "signed in" is announced.
        grantEmail = grant.user?.email?.takeIf { it.isNotBlank() }
        // Stored token and state change together, even if the screen goes away now.
        withContext(NonCancellable) {
            withContext(io) { tokens.set(grant.token) }
            forgetDeleteState()
            _state.value = State.SignedIn()
            refresh()
            onSignedIn()
        }
        return SignInResult.Success
    }

    /**
     * After the store's restore: asks the server to read the account's store plans and shows the balance
     * it answers with. Any failure (503 not_configured, a rate limit, offline) is left alone: /me is read
     * again by the caller.
     */
    suspend fun syncPurchases() {
        val asked = tokens.get() ?: return
        val res = api.syncPurchases()
        if (tokens.get() != asked) return
        (res as? ApiResult.Ok)?.value?.entitlement?.let(::applyEntitlement)
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

    /**
     * Deletes the account; true when the server confirmed. [password] goes along for an account that has
     * one. A refusal that the person can fix lands in [deleteProblem] instead of the failure notice.
     */
    suspend fun deleteAccount(password: String? = null): Boolean {
        if (!_working.compareAndSet(expect = false, update = true)) return false
        _deleteFailed.value = false
        _deleteProblem.value = null
        try {
            val res = api.deleteAccount(password)
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
                onDeleted()
                return true
            }
            // An expired session was already handled (and announced) by onSessionExpired.
            val error = (res as? ApiResult.Err)?.error
            val problem = error?.let(::deleteProblemOf)
            if (problem != null) {
                _deleteProblem.value = problem
            } else if (error == null || !error.isSigninRequired()) {
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
        forgetDeleteState()
        if (wasSignedIn) onLeaving()
        _state.value = State.SignedOut
        if (wasSignedIn) _notices.trySend(Notice.SESSION_EXPIRED)
    }

    private suspend fun endLocally(notice: Notice) {
        withContext(io) { tokens.clear() }
        forgetAgeAnswers()
        forgetDeleteState()
        onLeaving()
        _state.value = State.SignedOut
        onEndedByUser()
        _notices.trySend(notice)
    }

    /** A refusal or failure from an earlier session must not greet the next one. */
    private fun forgetDeleteState() {
        _deleteProblem.value = null
        _deleteFailed.value = false
    }

    /** The next person to sign in on this phone is reported afresh; the phone's own answer stays. */
    private fun forgetAgeAnswers() {
        _ageFailed.value = false
        signalSentFor = null
    }

    companion object {
        private val EMAIL = Regex("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$")

        fun looksLikeEmail(email: String): Boolean = EMAIL.matches(email.trim())

        fun deleteProblemOf(e: UiError): DeleteProblem? {
            if (e !is UiError.Api) return null
            return when {
                e.status == 429 -> DeleteProblem.RATE_LIMITED
                e.status == 403 && e.code == "reauth_required" -> DeleteProblem.REAUTH_REQUIRED
                e.status == 403 && e.code == "password_wrong" -> DeleteProblem.PASSWORD_WRONG
                else -> null
            }
        }

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

        fun passwordSignInError(e: UiError): SignInError =
            if (e is UiError.Api && e.status == 401) SignInError.PASSWORD_WRONG
            else common(e) ?: if ((e as UiError.Api).status == 404) SignInError.UNAVAILABLE else SignInError.FAILED

        fun passwordSaveError(e: UiError): SignInError = common(e) ?: (e as UiError.Api).let {
            when (it.code) {
                "invalid" -> if (it.status == 403) SignInError.PASSWORD_NOT_TAKEN else SignInError.PASSWORD_SAVE_FAILED
                "too_short", "too_long" -> SignInError.PASSWORD_SHORT
                "password_wrong" -> SignInError.CURRENT_PASSWORD_WRONG
                "password_required" -> SignInError.CURRENT_PASSWORD_REQUIRED
                else -> SignInError.PASSWORD_SAVE_FAILED
            }
        }

        fun socialError(e: UiError): SignInError = common(e) ?: when ((e as UiError.Api).status) {
            404 -> SignInError.PROVIDER_UNAVAILABLE
            else -> SignInError.FAILED
        }
    }
}
