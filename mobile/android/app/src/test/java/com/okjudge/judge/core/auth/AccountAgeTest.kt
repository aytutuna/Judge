package com.okjudge.judge.core.auth

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.okjudge.judge.core.api.ApiResult
import com.okjudge.judge.core.api.JudgeApi
import com.okjudge.judge.core.api.MemoryTokenStore
import com.okjudge.judge.core.auth.Routes.Companion.ME
import com.okjudge.judge.core.auth.Routes.Companion.SIGN_OUT
import com.okjudge.judge.core.auth.Routes.Companion.VERIFY_CODE
import com.okjudge.judge.core.auth.Routes.Companion.json
import com.okjudge.judge.core.display.Errors
import com.okjudge.judge.core.model.AgeStatus
import com.okjudge.judge.i18n.AppLang
import com.okjudge.judge.i18n.LocalizedStrings
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
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
class AccountAgeTest {
    private lateinit var server: MockWebServer
    private val routes = Routes()
    private val context: Context = ApplicationProvider.getApplicationContext()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Unconfined)
    private var phone = PlatformAge.UNKNOWN
    private var phoneAsked = 0
    private var phoneHangs = false
    private val signals = AgeSignalSource {
        phoneAsked++
        if (phoneHangs) awaitCancellation()
        phone
    }

    @Before
    fun setUp() {
        server = MockWebServer()
        server.dispatcher = routes
        server.start()
    }

    @After
    fun tearDown() {
        scope.cancel()
        server.close()
    }

    /** Signed in from the start (unless [token] is null), wired as in AppContainer. */
    private fun account(token: String? = "session-1", platformTimeoutMs: Long = 10_000): Pair<Account, JudgeApi> {
        val tokens = MemoryTokenStore(token)
        lateinit var account: Account
        val api = JudgeApi(
            server.url("/").toString(), OkHttpClient(), "Judge-Android/test (1)", tokens,
            onSignedOut = { account.onSessionExpired() },
            onAgeGate = { account.onAgeGate(it) },
        )
        account = Account(
            api, tokens, FakeGoogle(GoogleIdResult.Cancelled), scope, io = Dispatchers.IO,
            ageSignals = signals, platformTimeoutMs = platformTimeoutMs,
        )
        return account to api
    }

    private fun me(age: String?): mockwebserver3.MockResponse {
        val agePart = if (age == null) "" else ",\"age\":$age"
        return json(
            200,
            """{"user":{"id":"u1","email":"ada@example.com","name":"Ada","image":null},
               "entitlement":{"canUsePremium":false,"credits":0,"subscription":null,"resetsAt":null}$agePart}""",
        )
    }

    private fun ageBody(index: Int = 0) =
        Json.parseToJsonElement(routes.requestsTo(AGE)[index].body!!.utf8()).jsonObject

    private suspend fun Account.awaitGate(gate: AgeGate) = withTimeout(10_000) { ageGate.first { it == gate } }

    private suspend fun Account.awaitAge(check: (AgeStatus) -> Boolean) = withTimeout(10_000) {
        state.first { ((it as? Account.State.SignedIn)?.me?.age)?.let(check) == true }
    }

    private suspend fun Account.awaitPhone() = withTimeout(10_000) { platformAge.first { it != null } }

    @Test
    fun phoneSaysUnder18_reportsIt_andBlocks() = runBlocking {
        phone = PlatformAge.MINOR
        routes.always(ME, me("""{"confirmed":false,"blocked":false}"""))
        routes.on(AGE, json(200, """{"confirmed":false,"blocked":true}"""))
        val (account, _) = account()
        account.refresh()
        assertTrue(account.needsPlatformAge(onSignIn = false))
        account.checkPlatformAge(context)
        account.awaitAge { it.blocked }
        assertEquals(false, ageBody()["adult"]!!.jsonPrimitive.content.toBoolean())
        assertEquals("platform", ageBody()["source"]!!.jsonPrimitive.content)
        account.awaitGate(AgeGate.BLOCKED)
        Unit
    }

    @Test
    fun phoneSays18Plus_confirmsWithoutTheCheckbox() = runBlocking {
        phone = PlatformAge.ADULT
        routes.always(ME, me("""{"confirmed":false,"blocked":false}"""))
        routes.on(AGE, json(200, """{"age":{"confirmed":true,"blocked":false}}"""))
        val (account, _) = account()
        account.refresh()
        account.checkPlatformAge(context)
        account.awaitAge { it.confirmed }
        assertEquals("true", ageBody()["adult"]!!.jsonPrimitive.content)
        assertEquals("platform", ageBody()["source"]!!.jsonPrimitive.content)
        assertEquals(AgeGate.NONE, account.ageGate.value)
    }

    @Test
    fun unknownPhone_tickedBeforeSignIn_sendsTheCheckbox() = runBlocking {
        routes.always(ME, me("""{"confirmed":false,"blocked":false}"""))
        routes.on(AGE, json(200, """{"confirmed":true,"blocked":false}"""))
        val (account, _) = account()
        account.setAgeTicked(true)
        account.checkPlatformAge(context)
        account.awaitPhone()
        account.refresh()
        account.awaitAge { it.confirmed }
        assertEquals("checkbox", ageBody()["source"]!!.jsonPrimitive.content)
        assertEquals(AgeGate.NONE, account.ageGate.value)
    }

    @Test
    fun unknownPhone_unconfirmedAccount_getsTheSheet_untilItConfirms() = runBlocking {
        routes.always(ME, me("""{"confirmed":false,"blocked":false}"""))
        routes.on(AGE, json(200, """{"confirmed":true,"blocked":false}"""))
        val (account, _) = account()
        account.refresh()
        account.checkPlatformAge(context)
        account.awaitGate(AgeGate.CONFIRM)
        assertTrue(routes.requestsTo(AGE).isEmpty())

        account.confirmAge()
        assertTrue("nothing is sent before the box is ticked", routes.requestsTo(AGE).isEmpty())
        account.setAgeTicked(true)
        account.confirmAge()
        account.awaitGate(AgeGate.NONE)
        assertEquals("checkbox", ageBody()["source"]!!.jsonPrimitive.content)
        // A confirmed account never asks the phone again.
        assertFalse(account.needsPlatformAge(onSignIn = true))
    }

    @Test
    fun confirmedAccount_neverAsksThePhone() = runBlocking {
        routes.always(ME, me("""{"confirmed":true,"blocked":false}"""))
        val (account, _) = account()
        account.refresh()
        assertFalse(account.needsPlatformAge(onSignIn = false))
        assertEquals(AgeGate.NONE, account.ageGate.value)
        assertEquals(0, phoneAsked)
    }

    @Test
    fun serverWithoutTheAgeCheck_changesNothing() = runBlocking {
        routes.always(ME, me(null))
        val (account, _) = account()
        account.setAgeTicked(true)
        account.refresh()
        account.checkPlatformAge(context)
        account.awaitPhone()
        assertTrue(routes.requestsTo(AGE).isEmpty())
        assertEquals(AgeGate.NONE, account.ageGate.value)
    }

    @Test
    fun reportFailsOffline_theSheetShowsWhy() = runBlocking {
        routes.always(ME, me("""{"confirmed":false,"blocked":false}"""))
        routes.on(AGE, Routes.dropped())
        val (account, _) = account()
        account.setAgeTicked(true)
        account.refresh()
        account.checkPlatformAge(context)
        account.awaitGate(AgeGate.CONFIRM)
        withTimeout(10_000) { account.ageError.first { it != null } }
        Unit
    }

    @Test
    fun blocked403_fromAnyCall_opensTheBlockedScreen() = runBlocking {
        routes.always(ME, me("""{"confirmed":true,"blocked":false}"""))
        routes.on("GET /api/v1/me/history", json(403, """{"error":"age_blocked"}"""))
        val (account, api) = account()
        account.refresh()
        val res = api.history()
        account.awaitGate(AgeGate.BLOCKED)
        val s = LocalizedStrings(context).of(AppLang.EN)
        val message = Errors.message((res as ApiResult.Err).error, s, AppLang.EN)
        assertEquals(s.appAgeBlockedTitle, message)
    }

    @Test
    fun unconfirmed403_opensTheSheet_withItsOwnMessage() = runBlocking {
        routes.always(ME, me("""{"confirmed":true,"blocked":false}"""))
        routes.on("POST /api/v1/verdict", json(403, """{"error":"Confirm your age first","code":"age_unconfirmed"}"""))
        val (account, api) = account()
        account.refresh()
        account.checkPlatformAge(context)
        account.awaitPhone()
        val res = api.startVerdictBody("{}")
        account.awaitGate(AgeGate.CONFIRM)
        val s = LocalizedStrings(context).of(AppLang.EN)
        assertEquals(s.appAgeRequired, Errors.message((res as ApiResult.Err).error, s, AppLang.EN))
    }

    @Test
    fun tickedSignIn_reportsTheAgeBeforeThePendingVerdictRuns() = runBlocking {
        routes.on(VERIFY_CODE, Routes.grant("session-2"))
        routes.always(ME, me("""{"confirmed":false,"blocked":false}"""))
        routes.on(AGE, json(200, """{"confirmed":true,"blocked":false}"""))
        val (account, _) = account(token = null)
        account.checkPlatformAge(context)
        account.awaitPhone()
        account.setAgeTicked(true)
        // What a verdict waiting behind sign-in would see when it is let go.
        var refusalAtSignIn: String? = "not signed in"
        account.onSignedIn = { refusalAtSignIn = account.ageRefusal() }
        assertEquals(SignInResult.Success, account.verifyCode("ada@example.com", "123456"))
        assertNull(refusalAtSignIn)
        assertEquals("checkbox", ageBody()["source"]!!.jsonPrimitive.content)
        assertNull(account.ageRefusal())
        assertEquals(AgeGate.NONE, account.ageGate.value)
    }

    @Test
    fun tickedSignIn_reportFails_holdsThePendingVerdict_andShowsTheSheet() = runBlocking {
        routes.on(VERIFY_CODE, Routes.grant("session-2"))
        routes.always(ME, me("""{"confirmed":false,"blocked":false}"""))
        routes.on(AGE, json(503, """{"error":"down","code":"unavailable"}"""))
        val (account, _) = account(token = null)
        account.checkPlatformAge(context)
        account.awaitPhone()
        account.setAgeTicked(true)
        assertEquals(SignInResult.Success, account.verifyCode("ada@example.com", "123456"))
        assertEquals(AgeCheck.UNCONFIRMED, account.ageRefusal())
        account.awaitGate(AgeGate.CONFIRM)
        assertTrue(account.ageError.value != null)
    }

    @Test
    fun aPhoneThatNeverAnswers_timesOut_andTheSheetShows() = runBlocking {
        phoneHangs = true
        routes.always(ME, me("""{"confirmed":false,"blocked":false}"""))
        val (account, _) = account(platformTimeoutMs = 200)
        account.refresh()
        assertEquals(AgeCheck.UNCONFIRMED, account.ageRefusal())
        account.checkPlatformAge(context)
        assertEquals(PlatformAge.UNKNOWN, account.awaitPhone())
        account.awaitGate(AgeGate.CONFIRM)
        Unit
    }

    @Test
    fun under18WhileACheckboxReportIsInFlight_isSentAfterIt() = runBlocking {
        phone = PlatformAge.MINOR
        routes.always(ME, me("""{"confirmed":false,"blocked":false}"""))
        routes.on(AGE, json(200, """{"confirmed":true,"blocked":false}""").newBuilder().headersDelay(500, TimeUnit.MILLISECONDS).build())
        routes.on(AGE, json(200, """{"confirmed":true,"blocked":true}"""))
        val (account, _) = account()
        account.setAgeTicked(true)
        scope.launch { account.refresh() }
        withTimeout(10_000) { account.agePosting.first { it } }
        account.checkPlatformAge(context)
        account.awaitAge { it.blocked }
        assertEquals("checkbox", ageBody(0)["source"]!!.jsonPrimitive.content)
        assertEquals("false", ageBody(1)["adult"]!!.jsonPrimitive.content)
        account.awaitGate(AgeGate.BLOCKED)
        Unit
    }

    @Test
    fun purchasesAndVerdictsWait_untilTheAccountIsConfirmed() = runBlocking {
        routes.always(ME, me("""{"confirmed":false,"blocked":false}"""))
        val (account, _) = account()
        account.refresh()
        assertEquals(AgeCheck.UNCONFIRMED, account.ageRefusal())
        account.onAgeGate(AgeCheck.BLOCKED)
        assertEquals(AgeCheck.BLOCKED, account.ageRefusal())
    }

    @Test
    fun aFailedDeletion_isKeptForTheAgeCover() = runBlocking {
        routes.always(ME, me("""{"confirmed":false,"blocked":true}"""))
        routes.on(Routes.DELETE_ME, json(503, """{"error":"down","code":"unavailable"}"""))
        val (account, _) = account()
        account.refresh()
        assertFalse(account.deleteAccount())
        assertTrue(account.deleteFailed.value)
        assertEquals(AgeGate.BLOCKED, account.ageGate.value)
    }

    @Test
    fun signingOut_clearsTheTick() = runBlocking {
        routes.always(ME, me("""{"confirmed":true,"blocked":false}"""))
        routes.on(SIGN_OUT, json(200, """{"success":true}"""))
        val (account, _) = account()
        account.setAgeTicked(true)
        account.signOut()
        assertFalse(account.ageTicked.value)
    }

    private companion object {
        const val AGE = "POST /api/v1/me/age"
    }
}
