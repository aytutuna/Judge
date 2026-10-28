package com.okjudge.judge.core.auth

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.okjudge.judge.core.api.JudgeApi
import com.okjudge.judge.core.api.TokenStore
import com.okjudge.judge.core.auth.Routes.Companion.CONFIG
import com.okjudge.judge.core.auth.Routes.Companion.DELETE_ME
import com.okjudge.judge.core.auth.Routes.Companion.GOOGLE
import com.okjudge.judge.core.auth.Routes.Companion.ME
import com.okjudge.judge.core.auth.Routes.Companion.SEND_CODE
import com.okjudge.judge.core.auth.Routes.Companion.SIGN_OUT
import com.okjudge.judge.core.auth.Routes.Companion.VERIFY_CODE
import com.okjudge.judge.core.auth.Routes.Companion.json
import com.okjudge.judge.core.model.MeResponse
import com.okjudge.judge.core.model.WireJson
import com.okjudge.judge.i18n.AppLang
import com.okjudge.judge.ui.signin.SignInUiState
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import mockwebserver3.MockWebServer
import okhttp3.OkHttpClient
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.util.concurrent.TimeUnit

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class AccountTest {
    private lateinit var server: MockWebServer
    private val routes = Routes()
    private val context: Context = ApplicationProvider.getApplicationContext()
    private val prefs by lazy { context.getSharedPreferences(KeystoreTokenStore.FILE, Context.MODE_PRIVATE) }
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Unconfined)
    private val google = FakeGoogle(GoogleIdResult.Token("google-id-token"))

    @Before
    fun setUp() {
        prefs.edit().clear().commit()
        server = MockWebServer()
        server.dispatcher = routes
        server.start()
    }

    @After
    fun tearDown() {
        scope.cancel()
        server.close()
    }

    private fun store(): TokenStore = KeystoreTokenStore(prefs, FakeCipher())

    /** Wired as in AppContainer: JudgeApi's 401 hook ends the Account's session. */
    private fun account(
        tokens: TokenStore = store(),
        base: String = server.url("/").toString(),
        timeouts: JudgeApi.Timeouts = JudgeApi.Timeouts(),
    ): Account {
        lateinit var account: Account
        val api = JudgeApi(base, OkHttpClient(), "Judge-Android/test (1)", tokens, onSignedOut = { account.onSessionExpired() }, timeouts = timeouts)
        account = Account(api, tokens, google, scope, io = Dispatchers.IO)
        return account
    }

    private fun bodyOf(route: String, index: Int = 0) =
        Json.parseToJsonElement(routes.requestsTo(route)[index].body!!.utf8()).jsonObject

    private suspend fun Account.awaitMe(): MeResponse =
        withTimeout(10_000) { (state.first { (it as? Account.State.SignedIn)?.me != null } as Account.State.SignedIn).me!! }

    private suspend fun Account.nextNotice(): Account.Notice? = withTimeoutOrNull(5_000) { notices.first() }

    // --- config gating ---

    @Test
    fun config_showsOnlyTheProvidersTheServerOffers_andNeverApple() = runBlocking {
        routes.on(CONFIG, Routes.config(google = true, emailCode = false, apple = true))
        val account = account()
        account.loadProviders()
        val ready = withTimeout(10_000) { account.providers.first { it is Account.Providers.Ready } } as Account.Providers.Ready
        assertTrue(ready.config.signIn.apple)
        val ui = SignInUiState(providers = ready)
        assertTrue(ui.showGoogle)
        assertFalse(ui.showEmail)
        assertFalse(ui.noneAvailable)

        val emailOnly = SignInUiState(providers = Account.Providers.Ready(WireJson.json.decodeFromString(
            com.okjudge.judge.core.model.ServerConfig.serializer(),
            """{"signIn":{"apple":true,"google":false,"email":true,"emailCode":true,"dev":false},"premiumEnabled":false}""",
        )))
        assertFalse(emailOnly.showGoogle)
        assertTrue(emailOnly.showEmail)

        // Apple alone is nothing on Android.
        val appleOnly = SignInUiState(providers = Account.Providers.Ready(
            com.okjudge.judge.core.model.ServerConfig(com.okjudge.judge.core.model.SignInProviders(apple = true)),
        ))
        assertTrue(appleOnly.noneAvailable)
        assertFalse(SignInUiState(providers = Account.Providers.Loading).noneAvailable)
    }

    @Test
    fun config_failure_isFailed_andALaterSuccessRecovers() = runBlocking {
        routes.on(CONFIG, json(503, """{"error":"down","code":"unavailable"}"""))
        routes.on(CONFIG, Routes.config(google = false, emailCode = true))
        val account = account()
        account.loadProviders()
        withTimeout(10_000) { account.providers.first { it is Account.Providers.Failed } }
        account.loadProviders(force = true)
        val ready = withTimeout(10_000) { account.providers.first { it is Account.Providers.Ready } } as Account.Providers.Ready
        assertTrue(ready.config.signIn.emailCode)
    }

    // --- Google ---

    @Test
    fun google_exchangesTheIdToken_andPersistsTheSession() = runBlocking {
        routes.on(GOOGLE, Routes.grant("session-g"))
        routes.always(ME, Routes.me(credits = 2))
        val account = account()
        assertFalse(account.isSignedIn)

        assertEquals(SignInResult.Success, account.signInWithGoogle(context))
        assertEquals(1, google.calls)
        val body = bodyOf(GOOGLE)
        assertEquals("google", body["provider"]!!.jsonPrimitive.content)
        assertEquals("google-id-token", body["idToken"]!!.jsonObject["token"]!!.jsonPrimitive.content)
        assertNull(routes.requestsTo(GOOGLE)[0].headers["Authorization"])

        assertTrue(account.isSignedIn)
        assertEquals("ada@example.com", account.awaitMe().user!!.email)
        assertEquals("Bearer session-g", routes.requestsTo(ME).last().headers["Authorization"])

        // Persisted encrypted, and a fresh store (next launch) reads it back.
        assertEquals("sealed:" + "session-g".reversed(), prefs.getString(KeystoreTokenStore.KEY, null))
        assertEquals("session-g", store().get())
        assertTrue(account(store()).isSignedIn)
        assertEquals("the account /me named, for the next launch", "u1", store().user())
    }

    @Test
    fun google_cancelled_sendsNothing() = runBlocking {
        google.result = GoogleIdResult.Cancelled
        val account = account()
        assertEquals(SignInResult.Cancelled, account.signInWithGoogle(context))
        assertTrue(routes.requests.isEmpty())
        assertFalse(account.isSignedIn)
    }

    @Test
    fun google_unavailableOnTheDevice_orRejectedByTheServer() = runBlocking {
        google.result = GoogleIdResult.Unavailable
        val account = account()
        assertEquals(SignInResult.Error(SignInError.PROVIDER_UNAVAILABLE), account.signInWithGoogle(context))

        google.result = GoogleIdResult.Token("bad")
        routes.on(GOOGLE, json(401, """{"message":"Invalid token","code":"INVALID_TOKEN"}"""))
        assertEquals(SignInResult.Error(SignInError.FAILED), account.signInWithGoogle(context))
        assertNull(store().get())
        assertFalse(account.isSignedIn)
    }

    // --- email code ---

    @Test
    fun emailCode_happyPath() = runBlocking {
        routes.on(SEND_CODE, json(200, """{"success":true}"""))
        routes.on(VERIFY_CODE, Routes.grant("session-e", "coder@example.com"))
        routes.always(ME, Routes.me("coder@example.com"))
        val account = account()

        assertNull(account.sendCode("  coder@example.com ", AppLang.TR))
        val send = routes.requestsTo(SEND_CODE).single()
        assertEquals("tr", send.url.queryParameter("lang"))
        assertEquals("coder@example.com", bodyOf(SEND_CODE)["email"]!!.jsonPrimitive.content)
        assertEquals("sign-in", bodyOf(SEND_CODE)["type"]!!.jsonPrimitive.content)

        assertEquals(SignInResult.Success, account.verifyCode("coder@example.com", "482913"))
        assertEquals("482913", bodyOf(VERIFY_CODE)["otp"]!!.jsonPrimitive.content)
        assertEquals("coder@example.com", bodyOf(VERIFY_CODE)["email"]!!.jsonPrimitive.content)
        assertEquals("session-e", store().get())
        assertEquals("coder@example.com", account.awaitMe().user!!.email)
    }

    @Test
    fun emailCode_wrongCode_isInvalid_andNothingIsStored() = runBlocking {
        routes.on(VERIFY_CODE, json(400, """{"message":"Invalid OTP","code":"INVALID_OTP"}"""))
        val account = account()
        assertEquals(SignInResult.Error(SignInError.CODE_INVALID), account.verifyCode("a@example.com", "000000"))
        assertNull(store().get())
        assertFalse(account.isSignedIn)
    }

    @Test
    fun emailCode_expiredAndTooManyAttempts() = runBlocking {
        routes.on(VERIFY_CODE, json(400, """{"message":"OTP expired","code":"OTP_EXPIRED"}"""))
        routes.on(VERIFY_CODE, json(403, """{"message":"Too many attempts","code":"TOO_MANY_ATTEMPTS"}"""))
        val account = account()
        assertEquals(SignInResult.Error(SignInError.CODE_EXPIRED), account.verifyCode("a@example.com", "111111"))
        assertEquals(SignInResult.Error(SignInError.CODE_TOO_MANY), account.verifyCode("a@example.com", "111111"))
        assertNull(store().get())
    }

    @Test
    fun emailCode_rateLimited_onSendAndOnVerify() = runBlocking {
        routes.on(SEND_CODE, json(429, """{"message":"Too many requests. Please try again later."}"""))
        routes.on(VERIFY_CODE, json(429, """{"message":"Too many requests. Please try again later."}"""))
        val account = account()
        assertEquals(SignInError.RATE_LIMITED, account.sendCode("a@example.com", AppLang.EN))
        assertEquals(SignInResult.Error(SignInError.RATE_LIMITED), account.verifyCode("a@example.com", "123456"))
    }

    @Test
    fun emailCode_offOnTheServer_orABadAddress() = runBlocking {
        routes.on(SEND_CODE, json(404, ""))
        routes.on(SEND_CODE, json(400, """{"message":"Invalid email","code":"INVALID_EMAIL"}"""))
        val account = account()
        assertEquals(SignInError.UNAVAILABLE, account.sendCode("a@example.com", AppLang.EN))
        assertEquals(SignInError.INVALID_EMAIL, account.sendCode("a@b", AppLang.EN))
        assertFalse(Account.looksLikeEmail("a@b"))
        assertTrue(Account.looksLikeEmail(" coder@example.com "))
    }

    // --- /me ---

    @Test
    fun me_parsesTheAccountAndEntitlement() = runBlocking {
        routes.on(
            ME,
            json(
                200,
                """{"user":{"id":"u9","email":"sub@example.com","name":"","image":null},
                   "entitlement":{"canUsePremium":true,"blockedReason":null,"credits":0,
                   "subscription":{"source":"play_store","productId":"monthly","periodStart":"2026-10-01T00:00:00.000Z",
                   "periodEnd":"2026-11-01T00:00:00.000Z","willRenew":true,"used":12,"cap":100},"resetsAt":null}}""",
            ),
        )
        val tokens = store().apply { set("session-m") }
        val account = account(tokens)
        account.refresh()
        val me = (account.state.value as Account.State.SignedIn).me!!
        assertEquals("u9", me.user!!.id)
        assertEquals("sub@example.com", me.user.email)
        val e = me.entitlement!!
        assertTrue(e.canUsePremium)
        assertTrue("a subscription makes the plan Premium", e.isPremium)
        assertEquals(12, e.subscription!!.used)
        assertEquals(100, e.subscription.cap)
        assertTrue(e.subscription.willRenew)
        assertEquals("2026-11-01T00:00:00.000Z", e.subscription.periodEnd)
        assertEquals("Bearer session-m", routes.requestsTo(ME).single().headers["Authorization"])
    }

    @Test
    fun me_failure_keepsTheSession_andFlagsTheLoad() = runBlocking {
        routes.on(ME, json(503, """{"error":"Your account is unavailable right now.","code":"unavailable"}"""))
        val tokens = store().apply { set("session-m") }
        val account = account(tokens)
        account.refresh()
        assertEquals(Account.State.SignedIn(me = null, loadFailed = true), account.state.value)
        assertEquals("session-m", tokens.get())
    }

    @Test
    fun me_withoutAUser_endsAStaleSession() = runBlocking {
        routes.on(ME, Routes.signedOutMe)
        val tokens = store().apply { set("stale") }
        val account = account(tokens)
        account.refresh()
        assertEquals(Account.State.SignedOut, account.state.value)
        assertNull(tokens.get())
        assertNull(prefs.getString(KeystoreTokenStore.KEY, null))
        assertEquals(Account.Notice.SESSION_EXPIRED, account.nextNotice())
    }

    @Test
    fun signedOut_refresh_makesNoRequest() = runBlocking {
        account().refresh()
        assertTrue(routes.requests.isEmpty())
    }

    // --- sign-out ---

    @Test
    fun signOut_tellsTheServer_withTheBearer_thenClears() = runBlocking {
        routes.on(SIGN_OUT, json(200, """{"success":true}"""))
        val tokens = store().apply { set("session-o") }
        val account = account(tokens)
        account.signOut()
        assertEquals("Bearer session-o", routes.requestsTo(SIGN_OUT).single().headers["Authorization"])
        assertEquals(Account.State.SignedOut, account.state.value)
        assertNull(tokens.get())
        assertNull(store().get())
        assertEquals(Account.Notice.SIGNED_OUT, account.nextNotice())
    }

    @Test
    fun signOut_clearsTheToken_evenOnANetworkError() = runBlocking {
        routes.on(SIGN_OUT, Routes.dropped())
        val tokens = store().apply { set("session-o") }
        val account = account(tokens)
        account.signOut()
        assertNull(tokens.get())
        assertNull(store().get())
        assertEquals(Account.State.SignedOut, account.state.value)
        assertEquals(Account.Notice.SIGNED_OUT, account.nextNotice())
    }

    @Test
    fun signOut_clearsTheToken_whenTheServerIsUnreachable() = runBlocking {
        val tokens = store().apply { set("session-o") }
        val account = account(tokens, base = "http://127.0.0.1:1/")
        account.signOut()
        assertNull(tokens.get())
        assertEquals(Account.State.SignedOut, account.state.value)
    }

    // --- delete account ---

    @Test
    fun deleteAccount_confirmsWithTheServer_andClearsTheSession() = runBlocking {
        routes.on(DELETE_ME, json(200, """{"deleted":true}"""))
        val tokens = store().apply { set("session-d") }
        val account = account(tokens)

        assertTrue(account.deleteAccount())
        val req = routes.requestsTo(DELETE_ME).single()
        assertEquals("Bearer session-d", req.headers["Authorization"])
        assertEquals("delete", Json.parseToJsonElement(req.body!!.utf8()).jsonObject["confirm"]!!.jsonPrimitive.content)
        assertNull(tokens.get())
        assertEquals(Account.State.SignedOut, account.state.value)
        assertEquals(Account.Notice.DELETED, account.nextNotice())
    }

    @Test
    fun deleteAccount_failure_keepsTheSession() = runBlocking {
        routes.on(DELETE_ME, json(503, """{"error":"Deleting the account failed. Try again.","code":"unavailable"}"""))
        val tokens = store().apply { set("session-d") }
        val account = account(tokens)
        assertFalse(account.deleteAccount())
        assertEquals("session-d", tokens.get())
        assertTrue(account.isSignedIn)
        assertEquals(Account.Notice.DELETE_FAILED, account.nextNotice())
    }

    @Test
    fun deleteAccount_timedOut_butTheServerFinished_countsAsDeleted() = runBlocking {
        routes.on(DELETE_ME, json(200, """{"deleted":true}""").newBuilder().headersDelay(3, TimeUnit.SECONDS).build())
        routes.on(ME, Routes.signedOutMe)
        val tokens = store().apply { set("session-d") }
        val account = account(tokens, timeouts = JudgeApi.Timeouts(deleteSec = 1))
        assertTrue(account.deleteAccount())
        assertNull(tokens.get())
        assertEquals(Account.Notice.DELETED, account.nextNotice())
        assertFalse(account.working.value)
    }

    @Test
    fun deleteAccount_timedOut_andTheAccountStillThere_failed() = runBlocking {
        routes.on(DELETE_ME, json(200, """{"deleted":true}""").newBuilder().headersDelay(3, TimeUnit.SECONDS).build())
        routes.on(ME, Routes.me())
        val tokens = store().apply { set("session-d") }
        val account = account(tokens, timeouts = JudgeApi.Timeouts(deleteSec = 1))
        assertFalse(account.deleteAccount())
        assertEquals("session-d", tokens.get())
        assertEquals(Account.Notice.DELETE_FAILED, account.nextNotice())
    }

    @Test
    fun aSecondDelete_whileOneIsInFlight_isIgnored() = runBlocking {
        routes.on(DELETE_ME, json(200, """{"deleted":true}""").newBuilder().headersDelay(1, TimeUnit.SECONDS).build())
        val tokens = store().apply { set("session-d") }
        val account = account(tokens)
        val first = async(Dispatchers.IO) { account.deleteAccount() }
        withTimeout(5_000) { account.working.first { it } }
        assertFalse(account.deleteAccount())
        assertTrue(first.await())
        assertEquals(1, routes.requestsTo(DELETE_ME).size)
    }

    @Test
    fun aStaleMeAnswer_doesNotTouchANewerSession() = runBlocking {
        routes.on(ME, Routes.signedOutMe.newBuilder().headersDelay(1, TimeUnit.SECONDS).build())
        val tokens = store().apply { set("old") }
        val account = account(tokens)
        val refresh = async(Dispatchers.IO) { account.refresh() }
        withTimeout(5_000) { while (routes.requestsTo(ME).isEmpty()) kotlinx.coroutines.delay(10) }
        tokens.set("new")
        refresh.await()
        assertEquals("new", tokens.get())
        assertTrue(account.isSignedIn)
    }

    // --- 401 ---

    @Test
    fun signinRequired401_signsOut_andAnnouncesIt() = runBlocking {
        routes.on(DELETE_ME, json(401, """{"error":"Sign in first.","code":"signin_required"}"""))
        val tokens = store().apply { set("expired") }
        val account = account(tokens)
        assertFalse(account.deleteAccount())
        assertEquals(Account.State.SignedOut, account.state.value)
        assertNull(tokens.get())
        assertNull(store().get())
        assertEquals("only the expiry is announced", Account.Notice.SESSION_EXPIRED, account.nextNotice())
        assertNull(account.nextNoticeQuick())
    }

    private suspend fun Account.nextNoticeQuick(): Account.Notice? = withTimeoutOrNull(300) { notices.first() }
}
