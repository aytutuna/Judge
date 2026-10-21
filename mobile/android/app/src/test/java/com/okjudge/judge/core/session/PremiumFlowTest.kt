package com.okjudge.judge.core.session

import com.okjudge.judge.FakeHistory
import com.okjudge.judge.Fixtures
import com.okjudge.judge.core.api.JudgeApi
import com.okjudge.judge.core.api.NoBotCheck
import com.okjudge.judge.core.api.PollPolicy
import com.okjudge.judge.core.auth.Routes
import com.okjudge.judge.core.display.Preset
import com.okjudge.judge.core.display.UiError
import com.okjudge.judge.core.model.Entitlement
import com.okjudge.judge.i18n.AppLang
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import mockwebserver3.MockWebServer
import okhttp3.OkHttpClient
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.util.concurrent.atomic.AtomicInteger

/** The premium path: clarify, the idempotent verdict request, 409 retries, the 202 and polling, the balance. */
class PremiumFlowTest {
    private lateinit var server: MockWebServer
    private val routes = Routes()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    @Volatile private var now = 10_000L
    private val history = FakeHistory()
    private val applied = mutableListOf<Entitlement>()
    private val refreshes = AtomicInteger()
    private val sleeps = mutableListOf<Long>()
    private var keys = 0

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

    private val fastPolls = PollPolicy(firstMs = 5, maxMs = 10, errorMaxMs = 20, maxErrors = 3, deadlineMs = 10_000)

    private fun flow() = VerdictFlow(
        JudgeApi(server.url("/").toString(), OkHttpClient(), "ua", pollPolicy = fastPolls),
        NoBotCheck, history, scope,
        clock = { now },
        onEntitlement = { synchronized(applied) { applied += it } },
        refreshAccount = { refreshes.incrementAndGet() },
        // The 409 wait advances the fake clock instead of sleeping.
        sleep = { ms -> synchronized(sleeps) { sleeps += ms }; now += ms },
        newKey = { "key-${++keys}" },
    )

    private val premium get() = Fixtures.verdicts["premiumVerdictResponse"]!!.jsonObject

    /** The 202 fixture, polled again after 1 ms instead of 2 s. */
    private val accepted: String
        get() = JsonObject(premium["accepted"]!!.jsonObject + ("pollAfterMs" to JsonPrimitive(1))).toString()

    private fun poll(name: String): String {
        val body = premium["polls"]!!.jsonObject[name]!!.jsonObject
        return JsonObject(if (body.containsKey("pollAfterMs")) body + ("pollAfterMs" to JsonPrimitive(1)) else body).toString()
    }

    private fun clarify(name: String) = Fixtures.verdicts["clarifyResponse"]!!.jsonObject[name]!!.toString()

    private fun asyncError(code: String): Pair<Int, String> {
        val e = Fixtures.verdicts["asyncErrors"]!!.jsonObject[code]!!.jsonObject
        return e["status"]!!.jsonPrimitive.content.toInt() to e["body"]!!.toString()
    }

    private suspend fun VerdictFlow.settled(): VerdictFlow.State =
        withTimeout(10_000) { state.first { it is VerdictFlow.State.Succeeded || it is VerdictFlow.State.Failed } }

    private suspend fun VerdictFlow.stepIs(predicate: (VerdictFlow.PremiumStep) -> Boolean) =
        withTimeout(10_000) { premiumStep.first(predicate) }

    private fun body(route: String, i: Int = 0): JsonObject =
        Json.parseToJsonElement(routes.requestsTo(route)[i].body!!.utf8()).jsonObject

    private suspend fun waitFor(condition: () -> Boolean) = withTimeout(10_000) {
        while (!condition()) kotlinx.coroutines.delay(5)
    }

    private val argument = "My friend Sam says a hot dog is a sandwich and I disagree."

    @Test
    fun clarify_accountAndInputErrors_stopOnTheForm_andRefreshTheAccount() = runBlocking {
        for (code in listOf("no_credits", "signin_required", "fair_use")) {
            val (status, json) = asyncError(code)
            routes.on(CLARIFY, Routes.json(status, json))
            val f = flow()
            val before = refreshes.get()
            assertTrue(f.startPremium(argument, Preset.BALANCED, AppLang.EN, emptyList()))
            f.stepIs { it == VerdictFlow.PremiumStep.None }
            waitFor { f.lastError.value != null }
            assertEquals(code, (f.lastError.value as UiError.Api).code)
            assertEquals(VerdictFlow.State.Idle, f.state.value)
            waitFor { refreshes.get() > before }
        }
        routes.on(CLARIFY, Routes.json(400, """{"error":"Too short","code":"too_short"}"""))
        val f = flow()
        f.startPremium(argument, Preset.BALANCED, AppLang.EN, emptyList())
        waitFor { f.lastError.value != null }
        assertEquals("too_short", (f.lastError.value as UiError.Api).code)
        assertTrue("no verdict was asked for", routes.requestsTo(VERDICT).isEmpty())
    }

    @Test
    fun clarify_serverTrouble_judgesWithoutQuestions() = runBlocking {
        val troubles = listOf(
            Routes.json(503, """{"error":"down","code":"unavailable"}"""),
            Routes.json(429, """{"error":"slow down","code":"rate_limited","retryAfterSec":30}"""),
            Routes.dropped(),
            Routes.json(200, clarify("none")),
        )
        for ((i, trouble) in troubles.withIndex()) {
            routes.on(CLARIFY, trouble)
            routes.on(VERDICT, Routes.json(200, premium["response"].toString()))
            val f = flow()
            assertTrue(f.startPremium(argument, Preset.BALANCED, AppLang.EN, emptyList()))
            assertTrue(f.settled() is VerdictFlow.State.Succeeded)
            val sent = body(VERDICT, i)
            assertEquals("premium", sent["tier"]!!.jsonPrimitive.content)
            assertNull("no clarifications without questions", sent["clarifications"])
            assertNull("premium skips the bot check", sent["turnstileToken"])
            assertNull(f.lastError.value)
        }
    }

    @Test
    fun clarify_questions_thenAnswers_areSentWithTheVerdict() = runBlocking {
        routes.on(CLARIFY, Routes.json(200, clarify("two_questions")))
        routes.on(VERDICT, Routes.json(200, premium["response"].toString()))
        val f = flow()
        f.startPremium(argument, Preset.FAIRNESS, AppLang.TR, emptyList())
        val step = f.stepIs { it is VerdictFlow.PremiumStep.Clarify } as VerdictFlow.PremiumStep.Clarify
        assertEquals(listOf("q1", "q2"), step.questions.map { it.id })
        assertEquals(VerdictFlow.Nav.CLARIFY, f.navigation.first())
        assertEquals(VerdictFlow.State.Idle, f.state.value)

        f.finishClarify(mapOf("q1" to "  Never, we just argue.  "), skip = false)
        assertEquals(VerdictFlow.Nav.JUDGING, f.navigation.first())
        assertTrue(f.settled() is VerdictFlow.State.Succeeded)
        val clarifyBody = body(CLARIFY)
        assertEquals("tr", clarifyBody["lang"]!!.jsonPrimitive.content)
        val sent = body(VERDICT)
        assertEquals("fairness", sent["framework"]!!.jsonObject["preset"]!!.jsonPrimitive.content)
        val clarifications = sent["clarifications"]!!.jsonArray.map { it.jsonObject }
        assertEquals(2, clarifications.size)
        assertEquals("Never, we just argue.", clarifications[0]["answer"]!!.jsonPrimitive.content)
        assertEquals("", clarifications[1]["answer"]!!.jsonPrimitive.content)
    }

    @Test
    fun clarify_skip_sendsTheQuestionsWithEmptyAnswers() = runBlocking {
        routes.on(CLARIFY, Routes.json(200, clarify("two_questions")))
        routes.on(VERDICT, Routes.json(200, premium["response"].toString()))
        val f = flow()
        f.startPremium(argument, Preset.BALANCED, AppLang.EN, emptyList())
        f.stepIs { it is VerdictFlow.PremiumStep.Clarify }
        f.finishClarify(mapOf("q1" to "typed but skipped"), skip = true)
        f.settled()
        val clarifications = body(VERDICT)["clarifications"]!!.jsonArray.map { it.jsonObject }
        assertEquals(listOf("", ""), clarifications.map { it["answer"]!!.jsonPrimitive.content })
        assertEquals(
            "Did you and Sam ever agree on what counts as a sandwich?",
            clarifications[0]["question"]!!.jsonPrimitive.content,
        )
    }

    @Test
    fun clarify_back_returnsToTheFormWithoutAVerdict() = runBlocking {
        routes.on(CLARIFY, Routes.json(200, clarify("two_questions")))
        val f = flow()
        f.startPremium(argument, Preset.BALANCED, AppLang.EN, emptyList())
        f.stepIs { it is VerdictFlow.PremiumStep.Clarify }
        f.leaveClarify()
        assertEquals(VerdictFlow.PremiumStep.None, f.premiumStep.value)
        assertTrue(f.canStart())
        assertTrue(routes.requestsTo(VERDICT).isEmpty())
    }

    @Test
    fun verdict_409InProgress_retriesWithTheSameKey_then202PollsAndAppliesTheBalance() = runBlocking {
        val (status, json) = asyncError("in_progress")
        routes.on(CLARIFY, Routes.json(200, clarify("none")))
        routes.on(VERDICT, Routes.json(status, json))
        routes.on(VERDICT, Routes.json(status, json))
        routes.on(VERDICT, Routes.json(202, accepted))
        routes.on(POLL, Routes.json(200, poll("judging")))
        routes.on(POLL, Routes.json(200, poll("ready")))
        val f = flow()
        f.startPremium(argument, Preset.BALANCED, AppLang.EN, listOf("tok-b", "tok-a"))
        val done = f.settled() as VerdictFlow.State.Succeeded
        assertEquals("premium001", done.outcome.id)
        assertTrue(done.outcome.result.result.premium)

        val posts = routes.requestsTo(VERDICT)
        assertEquals(3, posts.size)
        assertEquals(listOf("key-1", "key-1", "key-1"), posts.map { it.headers["Idempotency-Key"] })
        assertTrue(posts.all { it.headers["Prefer"] == "respond-async" })
        assertEquals(listOf(4000L, 4000L), synchronized(sleeps) { sleeps.toList() })
        assertEquals(listOf("tok-b", "tok-a"), body(VERDICT)["evidence"]!!.jsonArray.map { it.jsonPrimitive.content })
        assertEquals(2, routes.requestsTo(POLL).size)

        assertEquals(13, synchronized(applied) { applied.single() }.subscription!!.used)
        waitFor { refreshes.get() >= 1 }
        assertEquals("premium001", history.rows.value.single().id)

        // A success drops the key: the same request again is a new verdict.
        routes.on(CLARIFY, Routes.json(200, clarify("none")))
        routes.on(VERDICT, Routes.json(200, premium["response"].toString()))
        f.acknowledge()
        assertTrue(f.startPremium(argument, Preset.BALANCED, AppLang.EN, listOf("tok-b", "tok-a")))
        f.settled()
        waitFor { routes.requestsTo(VERDICT).size == 4 }
        assertEquals("key-2", routes.requestsTo(VERDICT)[3].headers["Idempotency-Key"])
    }

    @Test
    fun verdict_inProgressPastTheWait_endsWithTheError() = runBlocking {
        val (status, json) = asyncError("in_progress")
        routes.on(CLARIFY, Routes.json(200, clarify("none")))
        routes.always(VERDICT, Routes.json(status, json))
        val f = flow()
        f.startPremium(argument, Preset.BALANCED, AppLang.EN, emptyList())
        val failed = f.settled() as VerdictFlow.State.Failed
        assertEquals("in_progress", (failed.error as UiError.Api).code)
        assertEquals(VerdictFlow.IN_PROGRESS_WAIT_MS / VerdictFlow.IN_PROGRESS_POLL_MS, synchronized(sleeps) { sleeps.size }.toLong())
    }

    @Test
    fun verdict_failedInTheBackground_keepsTheKeyForARetry_andRefreshesTheAccount() = runBlocking {
        routes.on(CLARIFY, Routes.json(200, clarify("none")))
        routes.on(VERDICT, Routes.json(202, accepted))
        routes.on(POLL, Routes.json(200, poll("failed_quota")))
        val f = flow()
        f.startPremium(argument, Preset.BALANCED, AppLang.EN, emptyList())
        val failed = f.settled() as VerdictFlow.State.Failed
        assertEquals("quota", (failed.error as UiError.Api).code)
        assertEquals(failed.error, f.lastError.value)
        waitFor { refreshes.get() >= 1 }

        routes.on(CLARIFY, Routes.json(200, clarify("none")))
        routes.on(VERDICT, Routes.json(200, premium["response"].toString()))
        f.acknowledge()
        f.startPremium(argument, Preset.BALANCED, AppLang.EN, emptyList())
        assertTrue(f.settled() is VerdictFlow.State.Succeeded)
        assertEquals(listOf("key-1", "key-1"), routes.requestsTo(VERDICT).map { it.headers["Idempotency-Key"] })
    }

    @Test
    fun verdict_402_stopsWithTheErrorAndRefreshesTheAccount() = runBlocking {
        val (status, json) = asyncError("no_credits")
        routes.on(CLARIFY, Routes.json(200, clarify("none")))
        routes.on(VERDICT, Routes.json(status, json))
        val f = flow()
        f.startPremium(argument, Preset.BALANCED, AppLang.EN, emptyList())
        val failed = f.settled() as VerdictFlow.State.Failed
        assertEquals("no_credits", (failed.error as UiError.Api).code)
        waitFor { refreshes.get() >= 1 }
        assertNotNull(f.lastError.value)
    }

    @Test
    fun verdict_200WithEntitlement_appliesIt() = runBlocking {
        routes.on(CLARIFY, Routes.json(200, clarify("none")))
        routes.on(VERDICT, Routes.json(200, premium["response"].toString()))
        val f = flow()
        f.startPremium(argument, Preset.BALANCED, AppLang.EN, emptyList())
        assertTrue(f.settled() is VerdictFlow.State.Succeeded)
        assertEquals(13, synchronized(applied) { applied.single() }.subscription!!.used)
        assertEquals("key-1", routes.requestsTo(VERDICT).single().headers["Idempotency-Key"])
    }

    @Test
    fun buildClarifications_trimsAndCaps() {
        val q = listOf(
            com.okjudge.judge.core.model.ClarifyQuestion("a", "  First?  "),
            com.okjudge.judge.core.model.ClarifyQuestion("b", "Second?"),
            com.okjudge.judge.core.model.ClarifyQuestion("c", "Third?"),
        )
        val built = VerdictFlow.buildClarifications(q, mapOf("a" to "x".repeat(600)), skip = false)!!
        assertEquals(2, built.size)
        assertEquals("First?", built[0].question)
        assertEquals(500, built[0].answer.length)
        assertNull(VerdictFlow.buildClarifications(emptyList(), emptyMap(), skip = false))
    }

    private companion object {
        const val CLARIFY = "POST /api/v1/clarify"
        const val VERDICT = "POST /api/v1/verdict"
        const val POLL = "GET /api/v1/verdicts/premium001"
    }
}
