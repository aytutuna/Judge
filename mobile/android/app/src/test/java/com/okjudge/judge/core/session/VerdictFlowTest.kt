package com.okjudge.judge.core.session

import com.okjudge.judge.FakeHistory
import com.okjudge.judge.Fixtures
import com.okjudge.judge.core.api.BotCheck
import com.okjudge.judge.core.api.BotCheckException
import com.okjudge.judge.core.api.JudgeApi
import com.okjudge.judge.core.api.NoBotCheck
import com.okjudge.judge.core.api.PollPolicy
import com.okjudge.judge.core.display.Preset
import com.okjudge.judge.core.display.UiError
import com.okjudge.judge.i18n.AppLang
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.RecordedRequest
import mockwebserver3.SocketEffect
import okhttp3.OkHttpClient
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class VerdictFlowTest {
    private lateinit var server: MockWebServer
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private var now = 10_000L
    private val history = FakeHistory()

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
    }

    @After
    fun tearDown() {
        scope.cancel()
        server.close()
    }

    /** The real backoff shape with millisecond waits, so polling tests run fast. */
    private val fastPolls = PollPolicy(firstMs = 5, maxMs = 10, errorMaxMs = 20, maxErrors = 3, deadlineMs = 10_000)

    private fun flow(botCheck: BotCheck = NoBotCheck) = VerdictFlow(
        JudgeApi(server.url("/").toString(), OkHttpClient(), "ua", pollPolicy = fastPolls),
        botCheck, history, scope, clock = { now },
    )

    private fun json(code: Int, body: String) =
        MockResponse.Builder().code(code).addHeader("Content-Type", "application/json").body(body).build()

    /** The 202 for the win_b_named fixture, with its name map and an owner token. */
    private fun accepted(ownerToken: String? = OWNER_TOKEN): String {
        val sample = Fixtures.verdicts["verdictResponses"]!!.jsonObject["win_b_named"]!!.jsonObject
        val fields = mutableMapOf(
            "id" to JsonPrimitive(ID),
            "status" to JsonPrimitive("judging"),
            "pollAfterMs" to JsonPrimitive(1),
            "poll" to JsonPrimitive("/api/v1/verdicts/$ID"),
            "name_map" to sample["name_map"]!!,
        )
        ownerToken?.let { fields["owner_token"] = JsonPrimitive(it) }
        return JsonObject(fields).toString()
    }

    private val judging = """{"id":"$ID","status":"judging","pollAfterMs":1}"""

    /** storedVerdictResponse (the same verdict as win_b_named) as a ready poll answer. */
    private val ready: String
        get() = JsonObject(
            Fixtures.verdicts["storedVerdictResponse"]!!.jsonObject + ("status" to JsonPrimitive("ready")),
        ).toString()

    private fun requests(): List<RecordedRequest> = List(server.requestCount) { server.takeRequest() }

    private suspend fun VerdictFlow.settled(): VerdictFlow.State =
        withTimeout(10_000) { state.first { it is VerdictFlow.State.Succeeded || it is VerdictFlow.State.Failed } }

    @Test
    fun success_savesToHistoryBeforeReporting() = runBlocking {
        server.enqueue(MockResponse.Builder().code(200).body(Fixtures.sampleJson("win_a_self")).build())
        val f = flow()
        assertTrue(f.start("  My friend Sam says a hot dog is a sandwich.  ", Preset.LOYALTY, AppLang.TR))
        val done = f.settled() as VerdictFlow.State.Succeeded
        assertEquals("abc123DEF0", done.outcome.id)
        assertEquals("loyalty", history.rows.value.single().preset)
        val body = Json.parseToJsonElement(server.takeRequest().body!!.utf8()).jsonObject
        assertEquals("My friend Sam says a hot dog is a sandwich.", body["argument"]!!.jsonPrimitive.content)
        assertEquals("tr", body["lang"]!!.jsonPrimitive.content)
        f.acknowledge()
        assertEquals(VerdictFlow.State.Idle, f.state.value)
    }

    @Test
    fun rateLimit_blocksTheButtonForTheWait_andNeverRetries() = runBlocking {
        server.enqueue(MockResponse.Builder().code(429).body("""{"error":"x","code":"rate_limited","retryAfterSec":120}""").build())
        val f = flow()
        f.start("an argument that is long enough", Preset.BALANCED, AppLang.EN)
        val failed = f.settled() as VerdictFlow.State.Failed
        assertEquals("rate_limited", (failed.error as UiError.Api).code)
        assertEquals(now + 120_000, f.blockedUntil.value)
        assertEquals(failed.error, f.lastError.value)
        assertEquals(1, server.requestCount)
        f.acknowledge()
        assertFalse("blocked until the wait passes", f.start("an argument that is long enough", Preset.BALANCED, AppLang.EN))
        now += 121_000
        server.enqueue(MockResponse.Builder().code(200).body(Fixtures.sampleJson("split")).build())
        assertTrue(f.start("an argument that is long enough", Preset.BALANCED, AppLang.EN))
        assertTrue(f.settled() is VerdictFlow.State.Succeeded)
        assertEquals(null, f.lastError.value)
    }

    @Test
    fun botCheckFailure_neverReachesTheServer() = runBlocking {
        val f = flow(object : BotCheck {
            override suspend fun token(): String? = throw BotCheckException("no")
        })
        f.start("an argument that is long enough", Preset.BALANCED, AppLang.EN)
        assertEquals(UiError.BotCheck, (f.settled() as VerdictFlow.State.Failed).error)
        assertEquals(0, server.requestCount)
    }

    @Test
    fun botCheckToken_isSentWithTheRequest() = runBlocking {
        server.enqueue(MockResponse.Builder().code(200).body(Fixtures.sampleJson("split")).build())
        val f = flow(object : BotCheck {
            override suspend fun token(): String = "tok"
        })
        f.start("an argument that is long enough", Preset.BALANCED, AppLang.EN)
        f.settled()
        val body = Json.parseToJsonElement(server.takeRequest().body!!.utf8()).jsonObject
        assertEquals("tok", body["turnstileToken"]!!.jsonPrimitive.content)
    }

    @Test
    fun oneRequestAtATime_andCancelReturnsToIdle() = runBlocking {
        server.enqueue(MockResponse.Builder().code(200).body(Fixtures.sampleJson("split")).headersDelay(2, java.util.concurrent.TimeUnit.SECONDS).build())
        val f = flow()
        assertTrue(f.start("an argument that is long enough", Preset.BALANCED, AppLang.EN))
        assertFalse(f.start("an argument that is long enough", Preset.BALANCED, AppLang.EN))
        f.cancel()
        assertEquals(VerdictFlow.State.Idle, f.state.value)
        assertTrue(history.rows.value.isEmpty())
    }

    @Test
    fun async_judgingTwiceThenReady_keepsTheNameMapAndOwnerTokenFromThe202() = runBlocking {
        server.enqueue(json(202, accepted()))
        server.enqueue(json(200, judging))
        server.enqueue(json(200, judging))
        server.enqueue(json(200, ready))
        val f = flow()
        assertTrue(f.start("Alex says one thing, Jordan another, and both are sure.", Preset.BALANCED, AppLang.EN))
        val outcome = (f.settled() as VerdictFlow.State.Succeeded).outcome
        val expected = Fixtures.sample("win_b_named")
        assertEquals(ID, outcome.id)
        assertEquals(expected.nameMap, outcome.nameMap)
        assertEquals(OWNER_TOKEN, outcome.ownerToken)
        assertEquals(expected.result, outcome.result)
        val saved = history.rows.value.single()
        assertEquals(expected.nameMap, saved.nameMap)
        assertEquals(expected.result, saved.original)

        val sent = requests()
        assertEquals(4, sent.size)
        assertEquals("POST", sent[0].method)
        assertEquals("respond-async", sent[0].headers["Prefer"])
        for (poll in sent.drop(1)) {
            assertEquals("GET", poll.method)
            assertEquals("/api/v1/verdicts/$ID", poll.url.encodedPath)
            assertEquals(OWNER_TOKEN, poll.headers["X-Owner-Token"])
        }
    }

    @Test
    fun async_andDirect_giveTheSameOutcome() = runBlocking {
        val direct = Fixtures.verdicts["verdictResponses"]!!.jsonObject["win_b_named"]!!.jsonObject +
            ("owner_token" to JsonPrimitive(OWNER_TOKEN))
        server.enqueue(json(200, JsonObject(direct).toString()))
        val f = flow()
        f.start("Alex says one thing, Jordan another, and both are sure.", Preset.BALANCED, AppLang.EN)
        val viaDirect = (f.settled() as VerdictFlow.State.Succeeded).outcome
        f.acknowledge()

        server.enqueue(json(202, accepted()))
        server.enqueue(json(200, ready))
        f.start("Alex says one thing, Jordan another, and both are sure.", Preset.BALANCED, AppLang.EN)
        val viaPoll = (f.settled() as VerdictFlow.State.Succeeded).outcome
        assertEquals(viaDirect, viaPoll)
        assertEquals(OWNER_TOKEN, viaDirect.ownerToken)
    }

    @Test
    fun async_failedQuota_showsTheQuotaError_andSavesNothing() = runBlocking {
        server.enqueue(json(202, accepted(ownerToken = null)))
        server.enqueue(json(200, judging))
        server.enqueue(json(200, """{"id":"$ID","status":"failed","code":"quota","error":"The judge hit its AI quota for now."}"""))
        val f = flow()
        f.start("an argument that is long enough", Preset.BALANCED, AppLang.EN)
        val failed = f.settled() as VerdictFlow.State.Failed
        assertEquals(UiError.Api(code = "quota", status = 502, serverText = "The judge hit its AI quota for now."), failed.error)
        assertEquals(failed.error, f.lastError.value)
        assertEquals(null, f.blockedUntil.value)
        assertTrue(history.rows.value.isEmpty())
        val polls = requests().drop(1)
        assertEquals(2, polls.size)
        assertTrue("no owner token, no owner header", polls.all { it.headers["X-Owner-Token"] == null })
    }

    @Test
    fun async_transientErrors_keepPollingTheSameId() = runBlocking {
        server.enqueue(json(202, accepted()))
        server.enqueue(MockResponse.Builder().onRequestStart(SocketEffect.ShutdownConnection).build())
        server.enqueue(json(503, """{"error":"Verdicts are unavailable right now.","code":"unavailable"}"""))
        server.enqueue(json(200, judging))
        server.enqueue(json(200, ready))
        val f = flow()
        f.start("an argument that is long enough", Preset.BALANCED, AppLang.EN)
        val outcome = (f.settled() as VerdictFlow.State.Succeeded).outcome
        assertEquals(ID, outcome.id)
        assertEquals(OWNER_TOKEN, outcome.ownerToken)
        val sent = requests()
        assertEquals("the verdict is asked for once", 1, sent.count { it.method == "POST" })
        assertTrue(sent.filter { it.method == "GET" }.all { it.url.encodedPath == "/api/v1/verdicts/$ID" })
    }

    @Test
    fun async_cancelStopsPolling() = runBlocking {
        server.enqueue(json(202, accepted()))
        repeat(200) { server.enqueue(json(200, judging)) }
        val f = flow()
        f.start("an argument that is long enough", Preset.BALANCED, AppLang.EN)
        withTimeout(10_000) { while (server.requestCount < 3) delay(5) }
        f.cancel()
        assertEquals(VerdictFlow.State.Idle, f.state.value)
        val atCancel = server.requestCount
        delay(400)
        assertTrue("at most the poll already on the wire", server.requestCount <= atCancel + 1)
        assertTrue(history.rows.value.isEmpty())
        assertEquals(null, f.lastError.value)
    }

    private companion object {
        const val ID = "winB000001"
        const val OWNER_TOKEN = "owner-token-123"
    }
}
