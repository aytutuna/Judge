package com.okjudge.judge.ui.verdict

import com.okjudge.judge.FakeHistory
import com.okjudge.judge.Fixtures
import com.okjudge.judge.core.api.JudgeApi
import com.okjudge.judge.core.api.PollPolicy
import com.okjudge.judge.core.auth.Routes
import com.okjudge.judge.core.cases.AppealArea
import com.okjudge.judge.core.display.UiError
import com.okjudge.judge.core.model.Entitlement
import com.okjudge.judge.core.model.NameMapping
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
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
import java.util.Collections

/** "Add context" on a one-sided verdict, against MockWebServer. */
@OptIn(ExperimentalCoroutinesApi::class)
class VerdictAppealViewModelTest {
    private lateinit var server: MockWebServer
    private val routes = Routes()
    private val history = FakeHistory()
    private val outcome = Fixtures.sample("win_a_self")
    private val id = outcome.id
    private val applied = Collections.synchronizedList(mutableListOf<Entitlement>())
    private var keys = 0

    private val get get() = "GET /api/v1/verdicts/$id"
    private val post get() = "POST /api/v1/verdicts/$id/appeals"
    private val round = "GET /api/v1/verdicts/r1"

    @Before
    fun setUp() {
        Dispatchers.setMain(Dispatchers.Unconfined)
        server = MockWebServer()
        server.dispatcher = routes
        server.start()
        runBlocking { history.save(outcome, "balanced") }
    }

    @After
    fun tearDown() {
        server.close()
        Dispatchers.resetMain()
    }

    private val fastPolls = PollPolicy(firstMs = 1, maxMs = 5, errorMaxMs = 5, maxErrors = 3, deadlineMs = 10_000)

    private fun vm() = VerdictAppealViewModel(
        id,
        JudgeApi(server.url("/").toString(), OkHttpClient(), "ua", pollPolicy = fastPolls),
        history,
        onEntitlement = { applied += it },
        newKey = { "vk-${++keys}" },
    )

    private suspend fun VerdictAppealViewModel.until(predicate: (VerdictAppealUiState) -> Boolean): VerdictAppealUiState =
        withTimeout(5_000) { state.first(predicate) }

    /** A ready GET of the verdict: [owner] is the writer's `owner.appeal` JSON, null for anyone else. */
    private fun verdictBody(appeals: String = "[]", owner: String?): String {
        val result = Json.parseToJsonElement(Fixtures.sampleJson("win_a_self")).jsonObject["result"]
        val ownerPart = owner?.let { ""","owner":{"originals_stored":true,"display":{"a":null,"b":null,"others":{},"namesVisible":false},"appeal":$it}""" } ?: ""
        return """{"id":"$id","status":"ready","createdAt":"2026-10-20T10:00:00.000Z","result":$result,"appeals":$appeals$ownerPart}"""
    }

    private fun gate(allowed: Boolean, by: String? = null) = """{"allowed":$allowed,"blockedBy":${by?.let { "\"$it\"" } ?: "null"}}"""

    private fun roundView(status: String, error: String? = null) =
        """{"id":"r1","status":"$status","error":${error?.let { "\"$it\"" } ?: "null"},"outcome":${if (status == "judged") "\"overturned\"" else "null"},"baseId":"$id","createdAt":"2026-10-21T10:00:00.000Z","text":"Party B paid me back."}"""

    /** The round's verdict: a case fixture's verdict made by an appeal. */
    private val roundResult: JsonObject by lazy {
        Fixtures.verdicts["cases"]!!.jsonObject["views"]!!.jsonObject["appeal_overturned"]!!.jsonObject["verdicts"]!!.jsonArray.last().jsonObject["result"]!!.jsonObject
    }

    private fun accepted() =
        """{"appeal":${roundView("judging")},"appeals":[${roundView("judging")}],"poll":"/api/v1/verdicts/r1","pollAfterMs":1,
           "name_map":[{"original":"Sam","replacement":"Party B"},{"original":"Kim","replacement":"Person C"}],
           "entitlement":{"canUsePremium":true,"blockedReason":null,"credits":2}}"""

    @Test
    fun notTheWriter_offersNothing() = runBlocking {
        routes.always(get, Routes.json(200, verdictBody(owner = null)))
        val vm = vm()
        val s = vm.until { it.rounds != null }
        assertNull(s.rounds!!.gate)
        assertFalse(s.offered)
        assertFalse(s.panel)
        assertTrue(routes.requestsTo(post).isEmpty())
    }

    @Test
    fun theWriter_isOfferedTheForm() = runBlocking {
        routes.always(get, Routes.json(200, verdictBody(owner = gate(allowed = true))))
        val vm = vm()
        val s = vm.until { it.rounds != null }
        assertTrue(s.offered)
        assertEquals(AppealArea.Form(null), s.area)
        assertFalse("the panel waits for the card's action", s.panel)
        vm.open()
        assertTrue(vm.until { it.open }.panel)
    }

    @Test
    fun blockedStates_readLikeTheCaseScreen() = runBlocking {
        fun areaFor(owner: String): Pair<AppealArea, Boolean> {
            val routes = Routes().always(get, Routes.json(200, verdictBody(owner = owner)))
            server.dispatcher = routes
            val vm = vm()
            val s = runBlocking { vm.until { it.rounds != null } }
            return s.area to s.offered
        }
        assertEquals(AppealArea.Blocked("premium_required") to true, areaFor(gate(false, "premium_required")))
        assertEquals(AppealArea.Blocked("no_credits") to true, areaFor(gate(false, "no_credits")))
        assertEquals("the note waits for a panel already out", AppealArea.Limit to false, areaFor(gate(false, "appeal_limit")))
        assertEquals(AppealArea.Busy to false, areaFor(gate(false, "busy")))
        assertEquals(AppealArea.Upsell(signIn = true) to true, areaFor(gate(false, "signin_required")))
        assertEquals("the app keeps no owner token to claim with", AppealArea.None to false, areaFor(gate(false, "claim_required")))
    }

    @Test
    fun submit_sendsTheContextWithAKey_pollsTheRound_andSavesItsVerdict() = runBlocking {
        routes.on(get, Routes.json(200, verdictBody(owner = gate(allowed = true))))
        routes.always(get, Routes.json(200, verdictBody(appeals = "[${roundView("judged")}]", owner = gate(allowed = true))))
        routes.on(post, Routes.json(202, accepted()))
        routes.on(round, Routes.json(200, """{"id":"r1","status":"judging","pollAfterMs":1}"""))
        routes.always(round, Routes.json(200, """{"id":"r1","status":"ready","createdAt":"2026-10-21T10:00:05.000Z","result":$roundResult}"""))
        val vm = vm()
        vm.until { it.offered }
        vm.open()
        val typed = "  Party B paid me back the next week, so the debt is settled.  "
        vm.onText(typed)
        assertTrue(vm.until { it.draft.text == typed }.draft.canSubmit)
        vm.submit()
        val done = vm.until { it.finished }
        assertFalse(done.open)

        val sent = routes.requestsTo(post).single()
        assertEquals("vk-1", sent.headers["Idempotency-Key"])
        val body = Json.parseToJsonElement(sent.body!!.utf8()).jsonObject
        assertEquals("Party B paid me back the next week, so the debt is settled.", body["text"]!!.jsonPrimitive.content)
        assertFalse("no screenshot, no evidence key", body.containsKey("evidence"))
        assertEquals("the round is polled until ready", 2, routes.requestsTo(round).size)
        assertEquals(2, applied.single().credits)

        val saved = history.observe(id).first()!!
        assertEquals("r1", saved.rulingId)
        assertEquals(roundResult["headline"]!!.jsonPrimitive.content, saved.original.result.headline)
        assertEquals("overturned", saved.original.result.appeal!!.outcome)
        assertTrue(saved.nameMap.contains(NameMapping("Kim", "Person C")))
        assertEquals("", vm.state.value.draft.text)
    }

    @Test
    fun aFailedSend_keepsTheKeyForTheSameText_andShowsTheError() = runBlocking {
        routes.always(get, Routes.json(200, verdictBody(owner = gate(allowed = true))))
        routes.on(post, Routes.json(503, """{"error":"down","code":"unavailable"}"""))
        routes.on(post, Routes.json(503, """{"error":"down","code":"unavailable"}"""))
        routes.on(post, Routes.json(503, """{"error":"down","code":"unavailable"}"""))
        val vm = vm()
        vm.until { it.offered }
        val text = "Party B paid me back the next week, so the debt is settled."
        vm.onText(text)
        vm.submit()
        assertEquals("unavailable", (vm.until { it.draft.error != null }.draft.error as UiError.Api).code)
        vm.submit()
        vm.until { routes.requestsTo(post).size == 2 && !it.draft.sending }
        vm.onText("$text Really.")
        vm.submit()
        vm.until { routes.requestsTo(post).size == 3 && !it.draft.sending }
        assertEquals(listOf("vk-1", "vk-1", "vk-2"), routes.requestsTo(post).map { it.headers["Idempotency-Key"] })
    }

    @Test
    fun theLimitAnswer_readsTheGateAgain() = runBlocking {
        routes.on(get, Routes.json(200, verdictBody(owner = gate(allowed = true))))
        routes.always(get, Routes.json(200, verdictBody(appeals = "[${roundView("judged")},${roundView("judged")}]", owner = gate(false, "appeal_limit"))))
        routes.on(post, Routes.json(409, """{"error":"This verdict already took context twice.","code":"appeal_limit"}"""))
        val vm = vm()
        vm.until { it.area is AppealArea.Form }
        vm.onText("Party B paid me back the next week, so the debt is settled.")
        vm.submit()
        assertEquals(AppealArea.Limit, vm.until { it.area == AppealArea.Limit }.area)
    }

    @Test
    fun aRoundStillJudging_isFollowed_andAFailedOneReopensTheForm() = runBlocking {
        routes.on(get, Routes.json(200, verdictBody(appeals = "[${roundView("judging")}]", owner = gate(false, "busy"))))
        routes.always(get, Routes.json(200, verdictBody(appeals = "[${roundView("failed", "unavailable")}]", owner = gate(allowed = true))))
        // Slow judging answers keep the round on screen long enough to see.
        repeat(3) { routes.on(round, Routes.json(200, """{"id":"r1","status":"judging","pollAfterMs":200}""")) }
        routes.always(round, Routes.json(200, """{"id":"r1","status":"failed","code":"unavailable","error":"down"}"""))
        val vm = vm()
        val judging = vm.until { it.area == AppealArea.Judging }
        assertTrue("the judging note shows without a tap", judging.panel)
        val s = vm.until { it.area is AppealArea.Form }
        assertEquals(AppealArea.Form("failed"), s.area)
        assertTrue(s.open)
        assertEquals(id, history.observe(id).first()!!.rulingId)
    }

    @Test
    fun aRoundStillJudging_offersNothingOnTheCard() = runBlocking {
        routes.on(get, Routes.json(200, verdictBody(appeals = "[${roundView("judging")}]", owner = gate(false, "busy"))))
        routes.always(round, Routes.json(200, """{"id":"r1","status":"judging","pollAfterMs":5000}"""))
        val vm = vm()
        val s = vm.until { it.area == AppealArea.Judging }
        assertFalse(s.offered)
        assertTrue(s.panel)
    }

    @Test
    fun aPollThatLostTouch_readsTheRoundAgain_andFollowsItToTheEnd() = runBlocking {
        routes.on(get, Routes.json(200, verdictBody(appeals = "[${roundView("judging")}]", owner = gate(false, "busy"))))
        // Still offline when the poll gives up: the rounds are read again a moment later.
        routes.on(get, Routes.json(503, """{"error":"down","code":"unavailable"}"""))
        routes.on(get, Routes.json(200, verdictBody(appeals = "[${roundView("judging")}]", owner = gate(false, "busy"))))
        routes.always(get, Routes.json(200, verdictBody(appeals = "[${roundView("judged")}]", owner = gate(allowed = true))))
        repeat(3) { routes.on(round, Routes.json(503, """{"error":"down","code":"unavailable"}""")) }
        routes.always(round, Routes.json(200, """{"id":"r1","status":"ready","createdAt":"2026-10-21T10:00:05.000Z","result":$roundResult}"""))
        val vm = vm()
        val done = vm.until { it.finished }
        assertEquals(AppealArea.Form(null), vm.until { it.area is AppealArea.Form }.area)
        assertFalse(done.open)
        assertEquals(4, routes.requestsTo(round).size)
        assertEquals("r1", history.observe(id).first()!!.rulingId)
    }

    @Test
    fun ourRound_judgedWhileOutOfTouch_keepsTheNamesItsContextBrought() = runBlocking {
        routes.on(get, Routes.json(200, verdictBody(owner = gate(allowed = true))))
        routes.always(get, Routes.json(200, verdictBody(appeals = "[${roundView("judged")}]", owner = gate(allowed = true))))
        routes.on(post, Routes.json(202, accepted()))
        repeat(3) { routes.on(round, Routes.json(503, """{"error":"down","code":"unavailable"}""")) }
        routes.always(round, Routes.json(200, """{"id":"r1","status":"ready","createdAt":"2026-10-21T10:00:05.000Z","result":$roundResult}"""))
        val vm = vm()
        vm.until { it.offered }
        vm.onText("Party B paid me back the next week, and Kim saw it.")
        vm.submit()
        vm.until { it.finished }
        val saved = history.observe(id).first()!!
        assertEquals("r1", saved.rulingId)
        assertTrue(saved.nameMap.contains(NameMapping("Kim", "Person C")))
    }

    @Test
    fun aRoundFinishedElsewhere_isCaughtUpInHistory() = runBlocking {
        routes.always(get, Routes.json(200, verdictBody(appeals = "[${roundView("judged")}]", owner = gate(allowed = true))))
        routes.always(round, Routes.json(200, """{"id":"r1","status":"ready","createdAt":"2026-10-21T10:00:05.000Z","result":$roundResult}"""))
        vm()
        val saved = withTimeout(5_000) { history.observe(id).first { it?.rulingId == "r1" } }!!
        assertEquals("overturned", saved.original.result.appeal!!.outcome)
    }
}
