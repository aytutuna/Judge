package com.okjudge.judge.core.auth

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.okjudge.judge.core.api.JudgeApi
import com.okjudge.judge.core.analytics.Analytics
import com.okjudge.judge.core.analytics.AnalyticsContext
import com.okjudge.judge.core.analytics.AnalyticsTransport
import com.okjudge.judge.core.analytics.Delivery
import com.okjudge.judge.core.api.MemoryTokenStore
import com.okjudge.judge.core.auth.Routes.Companion.ME
import com.okjudge.judge.core.auth.Routes.Companion.SIGN_OUT
import com.okjudge.judge.core.auth.Routes.Companion.VERIFY_CODE
import com.okjudge.judge.core.auth.Routes.Companion.json
import com.okjudge.judge.core.model.AgeStatus
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.launch
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
import java.time.LocalDate
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

    private fun age(confirmed: Boolean = false, blocked: Boolean = false, teen: Boolean = false, needsDob: Boolean = false) =
        """{"confirmed":$confirmed,"blocked":$blocked,"teen":$teen,"needsDob":$needsDob}"""

    private fun ageBody(index: Int = 0) =
        Json.parseToJsonElement(routes.requestsTo(AGE)[index].body!!.utf8()).jsonObject

    private suspend fun Account.awaitGate(gate: AgeGate) = withTimeout(10_000) { ageGate.first { it == gate } }

    private suspend fun Account.awaitAge(check: (AgeStatus) -> Boolean) = withTimeout(10_000) {
        state.first { ((it as? Account.State.SignedIn)?.me?.age)?.let(check) == true }
    }

    private suspend fun Account.awaitPhone() = withTimeout(10_000) { platformAge.first { it != null } }

    private suspend fun awaitSignal() = withTimeout(10_000) { while (routes.requestsTo(AGE).isEmpty()) delay(20) }

    private val needsDate get() = me(age(needsDob = true))
    private val finished get() = me(age(confirmed = true))
    private val finalBlock get() = me(age(blocked = true))

    @Test
    fun adultSignal_isSentEvenForAConfirmedAccount() = runBlocking {
        phone = PlatformAge.ADULT
        routes.always(ME, finished)
        routes.on(AGE, json(200, age(confirmed = true)))
        val (account, _) = account()
        account.refresh()
        assertTrue(account.needsPlatformAge(onSignIn = false))
        account.checkPlatformAge(context)
        awaitSignal()
        assertEquals("true", ageBody()["adult"]!!.jsonPrimitive.content)
        assertEquals("platform", ageBody()["source"]!!.jsonPrimitive.content)
        assertNull(ageBody()["under13"])
        assertEquals(AgeGate.NONE, account.ageGate.value)
    }

    @Test
    fun minorSignal_isOnlyReported_theServerDecides() = runBlocking {
        phone = PlatformAge.MINOR
        routes.always(ME, needsDate)
        routes.on(AGE, json(200, age(confirmed = true, teen = true, needsDob = true)))
        val (account, _) = account()
        account.refresh()
        account.checkPlatformAge(context)
        account.awaitAge { it.teen }
        assertEquals("false", ageBody()["adult"]!!.jsonPrimitive.content)
        assertNull(ageBody()["under13"])
        assertTrue(account.teen.value)
        assertEquals(true, account.statsLocked.value)
        withTimeout(10_000) { account.agePosting.first { !it } }
        // Never closed by the phone's word: the date step is what shows.
        assertEquals(AgeGate.DATE, account.ageGate.value)
        assertNull(account.ageRefusal())
    }

    @Test
    fun minorSignal_whenTheReportFails_blocksNothing() = runBlocking {
        phone = PlatformAge.MINOR
        routes.always(ME, finished)
        routes.on(AGE, Routes.dropped())
        val (account, _) = account()
        account.refresh()
        account.checkPlatformAge(context)
        account.awaitPhone()
        withTimeout(10_000) { account.agePosting.first { !it } }
        assertNull(account.ageRefusal())
        assertEquals(AgeGate.NONE, account.ageGate.value)
    }

    @Test
    fun under13Signal_isSentWithTheFlag() = runBlocking {
        phone = PlatformAge.UNDER13
        routes.always(ME, needsDate)
        routes.on(AGE, json(200, age(blocked = true)))
        val (account, _) = account()
        account.refresh()
        account.checkPlatformAge(context)
        account.awaitGate(AgeGate.BLOCKED)
        assertEquals("false", ageBody()["adult"]!!.jsonPrimitive.content)
        assertEquals("true", ageBody()["under13"]!!.jsonPrimitive.content)
    }

    @Test
    fun signal_isSentOncePerLaunch() = runBlocking {
        phone = PlatformAge.ADULT
        routes.always(ME, finished)
        routes.always(AGE, json(200, age(confirmed = true)))
        val (account, _) = account()
        account.refresh()
        account.checkPlatformAge(context)
        awaitSignal()
        account.refresh()
        account.refresh()
        assertEquals(1, routes.requestsTo(AGE).size)
    }

    @Test
    fun finalBlock_isNeitherAskedNorReported() = runBlocking {
        phone = PlatformAge.ADULT
        routes.always(ME, finalBlock)
        val (account, _) = account()
        account.refresh()
        assertFalse(account.needsPlatformAge(onSignIn = false))
        assertEquals(AgeGate.BLOCKED, account.ageGate.value)
        assertTrue(routes.requestsTo(AGE).isEmpty())
        assertEquals(0, phoneAsked)
    }

    @Test
    fun serverWithoutTheAgeCheck_changesNothing() = runBlocking {
        routes.always(ME, me(null))
        val (account, _) = account()
        account.refresh()
        account.checkPlatformAge(context)
        account.awaitPhone()
        assertTrue(routes.requestsTo(AGE).isEmpty())
        assertEquals(AgeGate.NONE, account.ageGate.value)
        assertNull(account.ageRefusal())
    }

    @Test
    fun aPhoneThatNeverAnswers_timesOut_andNothingIsSent() = runBlocking {
        phoneHangs = true
        routes.always(ME, finished)
        val (account, _) = account(platformTimeoutMs = 200)
        account.refresh()
        account.checkPlatformAge(context)
        assertEquals(PlatformAge.UNKNOWN, account.awaitPhone())
        assertTrue(routes.requestsTo(AGE).isEmpty())
    }

    @Test
    fun verdictsAndPurchasesWait_whileThePhoneIsAsked() = runBlocking {
        phoneHangs = true
        routes.always(ME, finished)
        val (account, _) = account(platformTimeoutMs = 300)
        account.refresh()
        assertNull(account.ageRefusal())
        account.checkPlatformAge(context)
        assertEquals(AgeCheck.CHECKING, account.ageRefusal())
        account.awaitPhone()
        assertNull(account.ageRefusal())
    }

    @Test
    fun verdictsAndPurchasesWait_whileTheSignalIsReported() = runBlocking {
        phone = PlatformAge.MINOR
        routes.always(ME, finished)
        routes.on(AGE, json(200, age(confirmed = true, teen = true)).newBuilder().headersDelay(500, TimeUnit.MILLISECONDS).build())
        val (account, _) = account()
        account.refresh()
        account.checkPlatformAge(context)
        withTimeout(10_000) { account.agePosting.first { it } }
        assertEquals(AgeCheck.CHECKING, account.ageRefusal())
        account.awaitAge { it.teen }
        withTimeout(10_000) { account.agePosting.first { !it } }
        assertNull(account.ageRefusal())
    }

    @Test
    fun aBlockedAccountsSignal_isNotCountedAsSent_andGoesAgainOnceTheBlockLifts() = runBlocking {
        phone = PlatformAge.MINOR
        routes.always(ME, me(age(blocked = true, needsDob = true)))
        // The server answers 200 but ignores the signal while the block stands.
        routes.on(AGE, json(200, age(blocked = true, needsDob = true)))
        routes.on(AGE, json(200, age(confirmed = true)))
        routes.on(AGE, json(200, age(confirmed = true, teen = true)))
        val (account, _) = account()
        account.refresh()
        account.checkPlatformAge(context)
        awaitSignal()
        withTimeout(10_000) { account.agePosting.first { !it } }
        account.submitDob(LocalDate.of(1990, 5, 17))
        account.awaitAge { it.teen }
        assertEquals(3, routes.requestsTo(AGE).size)
        assertEquals("1990-05-17", ageBody(1)["dob"]!!.jsonPrimitive.content)
        assertEquals("false", ageBody(2)["adult"]!!.jsonPrimitive.content)
        assertTrue(account.teen.value)
    }

    @Test
    fun aSignedInAccountWhoseMeHasNotAnswered_isNeitherLockedNorOpen() = runBlocking {
        routes.on(ME, json(503, """{"error":"down","code":"unavailable"}"""))
        routes.on(ME, finished)
        val (account, _) = account()
        withTimeout(10_000) { account.state.first { it is Account.State.SignedIn } }
        assertNull(account.statsLocked.value)
        account.refresh()
        assertNull("a failed lookup is still unknown", account.statsLocked.value)
        account.refresh()
        assertEquals(false, account.statsLocked.value)
    }

    @Test
    fun ageChecking_followsTheStoreCheckAndTheReport() = runBlocking {
        phoneHangs = true
        routes.always(ME, finished)
        val (account, _) = account(platformTimeoutMs = 300)
        account.refresh()
        assertFalse(account.ageChecking.value)
        account.checkPlatformAge(context)
        assertTrue(account.ageChecking.value)
        account.awaitPhone()
        withTimeout(10_000) { account.ageChecking.first { !it } }
        Unit
    }

    @Test
    fun usageStatsStayLocked_untilTheAgeIsKnownAndAdult() = runBlocking {
        routes.on(ME, needsDate)
        routes.on(ME, finished)
        val (account, _) = account()
        account.refresh()
        assertEquals(true, account.statsLocked.value)
        account.refresh()
        assertEquals(false, account.statsLocked.value)
    }

    @Test
    fun analytics_sendsNothingForATeen_orForAnUnknownAge() = runBlocking {
        val sent = mutableListOf<String>()
        val transport = object : AnalyticsTransport {
            override suspend fun send(body: String): Delivery {
                sent += body
                return Delivery.SENT
            }
        }
        val analytics = Analytics(
            transport, AnalyticsContext("0.1.0_1", "anon", "dev", "15", "Pixel_8", "en-US"), null, scope,
            io = Dispatchers.Unconfined, now = { 1_800_000_000_000L }, log = {},
        )
        analytics.setServerOn(true)
        routes.on(ME, needsDate)
        routes.on(ME, me(age(confirmed = true, teen = true)))
        routes.on(ME, finished)
        val (account, _) = account()
        scope.launch { combine(flowOf(true), account.statsLocked, AgeCheck::usageStatsOn).collect { analytics.allowed = it } }

        account.refresh()
        analytics.track("app_open")
        analytics.flush()
        account.refresh()
        analytics.track("screen_view", mapOf("screen" to "home"))
        analytics.flush()
        assertTrue("a teen and an unknown age send nothing", sent.isEmpty())

        account.refresh()
        analytics.track("app_open")
        analytics.flush()
        assertEquals(1, sent.size)
    }

    @Test
    fun clearingTheFailure_dropsTheNote() = runBlocking {
        routes.always(ME, needsDate)
        routes.on(AGE, Routes.dropped())
        val (account, _) = account()
        account.refresh()
        account.submitDob(LocalDate.of(1990, 5, 17))
        assertTrue(account.ageFailed.value)
        account.clearAgeFailed()
        assertFalse(account.ageFailed.value)
    }

    @Test
    fun noDateYet_showsTheDateStep_untilItIsAccepted() = runBlocking {
        routes.always(ME, needsDate)
        routes.on(AGE, json(200, age(confirmed = true)))
        val (account, _) = account()
        account.refresh()
        assertEquals(AgeGate.DATE, account.ageGate.value)
        assertEquals(AgeCheck.UNCONFIRMED, account.ageRefusal())
        account.submitDob(LocalDate.of(1990, 5, 17))
        account.awaitGate(AgeGate.NONE)
        assertEquals(setOf("dob"), ageBody().keys)
        assertEquals("1990-05-17", ageBody()["dob"]!!.jsonPrimitive.content)
        assertNull(account.ageRefusal())
        assertFalse(account.ageFailed.value)
    }

    @Test
    fun anUnder13Date_endsInTheFinalRefusal() = runBlocking {
        routes.always(ME, needsDate)
        routes.on(AGE, json(200, age(blocked = true)))
        val (account, _) = account()
        account.refresh()
        account.submitDob(LocalDate.now().minusYears(10))
        account.awaitGate(AgeGate.BLOCKED)
        assertEquals(AgeCheck.BLOCKED, account.ageRefusal())
    }

    @Test
    fun aTeenDate_unlocksTheAccount_asATeen() = runBlocking {
        routes.always(ME, needsDate)
        routes.on(AGE, json(200, age(confirmed = true, teen = true)))
        val (account, _) = account()
        account.refresh()
        account.submitDob(LocalDate.now().minusYears(15))
        account.awaitGate(AgeGate.NONE)
        assertTrue(account.teen.value)
    }

    @Test
    fun anOldAdultsOnlyBlock_takesADate_andLifts() = runBlocking {
        routes.always(ME, me(age(blocked = true, needsDob = true)))
        routes.on(AGE, json(200, age(confirmed = true)))
        val (account, _) = account()
        account.refresh()
        assertEquals(AgeGate.DATE, account.ageGate.value)
        account.submitDob(LocalDate.of(1985, 1, 1))
        account.awaitGate(AgeGate.NONE)
        assertNull(account.ageRefusal())
    }

    @Test
    fun dateAlreadySet_409_refetchesAndMovesOn() = runBlocking {
        routes.on(ME, needsDate)
        routes.on(ME, finished)
        routes.on(AGE, json(409, """{"error":"set","code":"age_set"}"""))
        val (account, _) = account()
        account.refresh()
        account.submitDob(LocalDate.of(1990, 5, 17))
        account.awaitGate(AgeGate.NONE)
        assertFalse(account.ageFailed.value)
    }

    @Test
    fun dateAlreadySet_butStillAsked_saysItFailed() = runBlocking {
        routes.always(ME, needsDate)
        routes.on(AGE, json(409, """{"error":"set","code":"age_set"}"""))
        val (account, _) = account()
        account.refresh()
        account.submitDob(LocalDate.of(1990, 5, 17))
        assertEquals(AgeGate.DATE, account.ageGate.value)
        assertTrue(account.ageFailed.value)
    }

    @Test
    fun blocked403_onTheDate_refetchesIntoTheRefusal() = runBlocking {
        routes.on(ME, needsDate)
        routes.always(ME, finalBlock)
        routes.on(AGE, json(403, """{"error":"blocked","code":"age_blocked"}"""))
        val (account, _) = account()
        account.refresh()
        account.submitDob(LocalDate.of(1990, 5, 17))
        account.awaitGate(AgeGate.BLOCKED)
        assertFalse(account.ageFailed.value)
    }

    @Test
    fun otherFailures_keepTheStep() = runBlocking {
        routes.always(ME, needsDate)
        routes.on(AGE, json(503, """{"error":"down","code":"unavailable"}"""))
        routes.on(AGE, Routes.dropped())
        routes.on(AGE, json(400, """{"error":"bad","code":"invalid"}"""))
        val (account, _) = account()
        account.refresh()
        repeat(3) {
            account.submitDob(LocalDate.of(1990, 5, 17))
            assertTrue(account.ageFailed.value)
            assertEquals(AgeGate.DATE, account.ageGate.value)
        }
        assertEquals(3, routes.requestsTo(AGE).size)
    }

    @Test
    fun blocked403_fromAnyCall_refetchesIntoTheRefusal() = runBlocking {
        routes.on(ME, finished)
        routes.always(ME, finalBlock)
        routes.on("GET /api/v1/me/history", json(403, """{"error":"age_blocked"}"""))
        val (account, api) = account()
        account.refresh()
        api.history()
        account.awaitGate(AgeGate.BLOCKED)
        Unit
    }

    @Test
    fun unconfirmed403_refetchesIntoTheDateStep() = runBlocking {
        routes.on(ME, finished)
        routes.always(ME, needsDate)
        routes.on("POST /api/v1/verdict", json(403, """{"error":"Confirm your age first","code":"age_unconfirmed"}"""))
        val (account, api) = account()
        account.refresh()
        api.startVerdictBody("{}")
        account.awaitGate(AgeGate.DATE)
        Unit
    }

    @Test
    fun signingIn_readsTheAgeBeforeThePendingVerdictRuns() = runBlocking {
        routes.on(VERIFY_CODE, Routes.grant("session-2"))
        routes.always(ME, needsDate)
        val (account, _) = account(token = null)
        var refusalAtSignIn: String? = "not signed in"
        account.onSignedIn = { refusalAtSignIn = account.ageRefusal() }
        assertEquals(SignInResult.Success, account.verifyCode("ada@example.com", "123456"))
        assertEquals(AgeCheck.UNCONFIRMED, refusalAtSignIn)
        assertEquals(AgeGate.DATE, account.ageGate.value)
    }

    @Test
    fun aFailedDeletion_isKeptForTheAgeCover() = runBlocking {
        routes.always(ME, finalBlock)
        routes.on(Routes.DELETE_ME, json(503, """{"error":"down","code":"unavailable"}"""))
        val (account, _) = account()
        account.refresh()
        assertFalse(account.deleteAccount())
        assertTrue(account.deleteFailed.value)
        assertEquals(AgeGate.BLOCKED, account.ageGate.value)
    }

    @Test
    fun signingOut_clearsTheCoverAndTheFailure() = runBlocking {
        routes.always(ME, needsDate)
        routes.on(AGE, Routes.dropped())
        routes.on(SIGN_OUT, json(200, """{"success":true}"""))
        val (account, _) = account()
        account.refresh()
        account.submitDob(LocalDate.of(1990, 5, 17))
        assertTrue(account.ageFailed.value)
        account.signOut()
        assertFalse(account.ageFailed.value)
        assertEquals(AgeGate.NONE, account.ageGate.value)
    }

    private companion object {
        const val AGE = "POST /api/v1/me/age"
    }
}
