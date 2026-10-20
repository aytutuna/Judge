package com.okjudge.judge.core.session

import com.okjudge.judge.FakeHistory
import com.okjudge.judge.Fixtures
import com.okjudge.judge.core.api.BotCheck
import com.okjudge.judge.core.api.BotCheckException
import com.okjudge.judge.core.api.JudgeApi
import com.okjudge.judge.core.api.NoBotCheck
import com.okjudge.judge.core.display.Preset
import com.okjudge.judge.core.display.UiError
import com.okjudge.judge.i18n.AppLang
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
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

    private fun flow(botCheck: BotCheck = NoBotCheck) = VerdictFlow(
        JudgeApi(server.url("/").toString(), OkHttpClient(), "ua"),
        botCheck, history, scope, clock = { now },
    )

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
}
