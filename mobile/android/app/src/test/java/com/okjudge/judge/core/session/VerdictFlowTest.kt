package com.okjudge.judge.core.session

import com.okjudge.judge.FakeHistory
import com.okjudge.judge.Fixtures
import com.okjudge.judge.core.api.JudgeApi
import com.okjudge.judge.core.api.PollPolicy
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

    private val fastPolls = PollPolicy(firstMs = 5, maxMs = 10, errorMaxMs = 20, maxErrors = 3, deadlineMs = 10_000)

    private fun flow() = VerdictFlow(
        JudgeApi(server.url("/").toString(), OkHttpClient(), "ua", pollPolicy = fastPolls),
        history, scope, clock = { now },
    )

    private fun json(code: Int, body: String) =
        MockResponse.Builder().code(code).addHeader("Content-Type", "application/json").body(body).build()

    /** Clarify finds nothing to ask, so the verdict goes straight out. */
    private fun noQuestions() =
        server.enqueue(json(200, Fixtures.verdicts["clarifyResponse"]!!.jsonObject["none"]!!.toString()))

    private suspend fun VerdictFlow.settled(): VerdictFlow.State =
        withTimeout(10_000) { state.first { it is VerdictFlow.State.Succeeded || it is VerdictFlow.State.Failed } }

    @Test
    fun success_savesToHistoryBeforeReporting() = runBlocking {
        noQuestions()
        server.enqueue(json(200, Fixtures.sampleJson("win_a_self")))
        val f = flow()
        assertTrue(f.startPremium("  My friend Sam says a hot dog is a sandwich.  ", AppLang.TR, emptyList()))
        val done = f.settled() as VerdictFlow.State.Succeeded
        assertEquals("abc123DEF0", done.outcome.id)
        assertEquals("My friend Sam says a hot dog is a sandwich.", done.argument)
        assertEquals(listOf("abc123DEF0"), history.rows.value.map { it.id })
        server.takeRequest()
        val body = Json.parseToJsonElement(server.takeRequest().body!!.utf8()).jsonObject
        assertEquals("My friend Sam says a hot dog is a sandwich.", body["argument"]!!.jsonPrimitive.content)
        assertEquals("tr", body["lang"]!!.jsonPrimitive.content)
        assertEquals("premium", body["tier"]!!.jsonPrimitive.content)
        assertTrue("framework" !in body)
        f.acknowledge()
        assertEquals(VerdictFlow.State.Idle, f.state.value)
    }

    @Test
    fun rateLimit_blocksTheButtonForTheWait_andNeverRetries() = runBlocking {
        noQuestions()
        server.enqueue(json(429, """{"error":"x","code":"rate_limited","retryAfterSec":120}"""))
        val f = flow()
        f.startPremium("an argument that is long enough", AppLang.EN, emptyList())
        val failed = f.settled() as VerdictFlow.State.Failed
        assertEquals("rate_limited", (failed.error as UiError.Api).code)
        assertEquals(now + 120_000, f.blockedUntil.value)
        assertEquals(failed.error, f.lastError.value)
        assertEquals(2, server.requestCount)
        f.acknowledge()
        assertFalse("blocked until the wait passes", f.startPremium("an argument that is long enough", AppLang.EN, emptyList()))
        now += 121_000
        noQuestions()
        server.enqueue(json(200, Fixtures.sampleJson("split")))
        assertTrue(f.startPremium("an argument that is long enough", AppLang.EN, emptyList()))
        assertTrue(f.settled() is VerdictFlow.State.Succeeded)
        assertEquals(null, f.lastError.value)
    }

    @Test
    fun oneRequestAtATime_andCancelReturnsToIdle() = runBlocking {
        server.enqueue(MockResponse.Builder().code(200).body("{}").headersDelay(2, java.util.concurrent.TimeUnit.SECONDS).build())
        val f = flow()
        assertTrue(f.startPremium("an argument that is long enough", AppLang.EN, emptyList()))
        assertFalse(f.startPremium("an argument that is long enough", AppLang.EN, emptyList()))
        f.cancel()
        assertEquals(VerdictFlow.State.Idle, f.state.value)
        assertTrue(f.canStart())
        assertTrue(history.rows.value.isEmpty())
    }
}
