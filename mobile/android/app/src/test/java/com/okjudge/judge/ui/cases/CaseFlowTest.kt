package com.okjudge.judge.ui.cases

import com.okjudge.judge.FakeHistory
import com.okjudge.judge.Fixtures
import com.okjudge.judge.core.api.ApiResult
import com.okjudge.judge.core.api.JudgeApi
import com.okjudge.judge.core.auth.Routes
import com.okjudge.judge.core.cases.AppealArea
import com.okjudge.judge.core.cases.CaseLogic
import com.okjudge.judge.core.cases.MemoryCaseNames
import com.okjudge.judge.core.display.ArgumentRules
import com.okjudge.judge.core.display.UiError
import com.okjudge.judge.core.evidence.EvidenceItem
import com.okjudge.judge.core.evidence.EvidenceState
import com.okjudge.judge.core.evidence.EvidenceStatus
import com.okjudge.judge.core.evidence.ImageSource
import com.okjudge.judge.core.evidence.Prepared
import com.okjudge.judge.core.evidence.PreparedImage
import com.okjudge.judge.core.model.CaseStatus
import com.okjudge.judge.core.model.CaseView
import com.okjudge.judge.core.model.Entitlement
import com.okjudge.judge.core.model.Features
import com.okjudge.judge.core.model.NameMapping
import com.okjudge.judge.core.model.Side
import com.okjudge.judge.core.model.WireJson
import com.okjudge.judge.core.session.VerdictFlow
import com.okjudge.judge.i18n.AppLang
import com.okjudge.judge.ui.DeepLinks
import com.okjudge.judge.ui.home.ExtraSide
import com.okjudge.judge.ui.home.HomeUiState
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
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

/** Case creation, the case screen's states and polling, and every owner action, against MockWebServer. */
@OptIn(ExperimentalCoroutinesApi::class)
class CaseFlowTest {
    private lateinit var server: MockWebServer
    private val routes = Routes()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val names = MemoryCaseNames()
    private val applied = Collections.synchronizedList(mutableListOf<Entitlement>())
    private val refreshes = Collections.synchronizedList(mutableListOf<Unit>())
    private val sleeps = Collections.synchronizedList(mutableListOf<Long>())
    private val tick = Channel<Unit>(Channel.UNLIMITED)
    private var keys = 0

    @Before
    fun setUp() {
        Dispatchers.setMain(Dispatchers.Unconfined)
        server = MockWebServer()
        server.dispatcher = routes
        server.start()
    }

    @After
    fun tearDown() {
        scope.cancel()
        server.close()
        Dispatchers.resetMain()
    }

    private fun api() = JudgeApi(server.url("/").toString(), OkHttpClient(), "ua")

    /** Polls wait for the test to say go, recording how long they would have slept. */
    private fun vm() = CaseViewModel(
        ID, api(), names,
        onEntitlement = { applied += it },
        refreshAccount = { refreshes += Unit },
        sleep = { ms -> sleeps += ms; tick.receive() },
        newKey = { "ck-${++keys}" },
    )

    private val cases get() = Fixtures.verdicts["cases"]!!.jsonObject

    private fun viewJson(name: String): JsonObject = cases["views"]!!.jsonObject[name]!!.jsonObject

    private fun caseBody(name: String) = JsonObject(mapOf("case" to viewJson(name))).toString()

    private fun view(name: String): CaseView = WireJson.json.decodeFromString(CaseView.serializer(), viewJson(name).toString())

    private suspend fun CaseViewModel.until(predicate: (CaseUiState) -> Boolean): CaseUiState =
        withTimeout(5_000) { state.first(predicate) }

    private fun bodyOf(route: String, i: Int = 0): JsonObject =
        Json.parseToJsonElement(routes.requestsTo(route)[i].body!!.utf8()).jsonObject

    @Test
    fun everyFixtureView_decodes_andReadsAsItsState() = runBlocking {
        val expected = mapOf(
            "waiting_for_respondent" to CaseStatus.AWAITING,
            "respondent_answered" to CaseStatus.JUDGING,
            "judging" to CaseStatus.JUDGING,
            "judged" to CaseStatus.JUDGED,
            "judged_one_sided" to CaseStatus.JUDGED,
            "judged_tr" to CaseStatus.JUDGED,
            "appeal_judging" to CaseStatus.JUDGED,
            "appeal_upheld" to CaseStatus.JUDGED,
            "appeal_overturned" to CaseStatus.JUDGED,
            "appeal_changed" to CaseStatus.JUDGED,
            "failed" to CaseStatus.FAILED,
            "expired" to CaseStatus.EXPIRED,
            "removed" to CaseStatus.JUDGED,
            "waiting_free" to CaseStatus.AWAITING,
            "judged_free" to CaseStatus.JUDGED,
            "waiting_to_write" to CaseStatus.AWAITING,
            "waiting_to_write_answered" to CaseStatus.AWAITING,
            "respondent_waiting_for_owner" to CaseStatus.AWAITING,
        )
        assertEquals(expected.keys, cases["views"]!!.jsonObject.keys)
        for ((name, status) in expected) {
            val v = view(name)
            assertEquals(name, status, v.status)
            for (verdict in v.verdicts) assertTrue(verdict.result.headline.isNotEmpty())
        }
        assertEquals("tr", view("judged_tr").current!!.result.lang)
        assertEquals("overturned", view("appeal_overturned").current!!.result.appeal!!.outcome)
        assertTrue(view("removed").sides.first().removed)
        assertNull(view("removed").names)
        assertTrue(view("judged").premium)
        assertFalse(view("judged_free").premium)
        assertEquals("premium", WireJson.json.decodeFromString(CaseView.serializer(), """{"id":"x"}""").tier)
    }

    @Test
    fun appealArea_matchesTheWebGates() {
        assertEquals(AppealArea.Form(null), CaseLogic.appealArea(view("judged")))
        assertEquals(AppealArea.Blocked("premium_required"), CaseLogic.appealArea(view("judged_one_sided")))
        assertEquals(AppealArea.Busy, CaseLogic.appealArea(view("appeal_judging")))
        assertEquals(AppealArea.Used, CaseLogic.appealArea(view("appeal_upheld")))
        assertEquals(AppealArea.None, CaseLogic.appealArea(view("waiting_for_respondent")))
        assertEquals(AppealArea.None, CaseLogic.appealArea(view("removed")))
        val judged = view("judged")
        fun gate(by: String, role: String = "owner") =
            CaseLogic.appealArea(judged.copy(role = role, appeal = judged.appeal.copy(allowed = false, blockedBy = by)))
        assertEquals(AppealArea.Upsell(signIn = true), gate("signin_required"))
        assertEquals(AppealArea.Blocked("no_credits"), gate("no_credits"))
        assertEquals(AppealArea.Blocked("fair_use"), gate("fair_use"))
        assertEquals(AppealArea.Upsell(signIn = false), gate("fair_use", role = "respondent"))
        assertEquals(AppealArea.Used, gate("appeal_used"))
        assertEquals(AppealArea.Busy, gate("busy"))
        val mine = judged.copy(appeals = listOf(com.okjudge.judge.core.model.CaseAppealView(party = "a", status = "judging")))
        assertEquals(AppealArea.Judging, CaseLogic.appealArea(mine))
        val failed = judged.copy(appeals = listOf(com.okjudge.judge.core.model.CaseAppealView(party = "a", status = "failed", error = "refused")))
        assertEquals(AppealArea.Form("refused"), CaseLogic.appealArea(failed))
    }

    @Test
    fun create_postsTheOwnerSideWithAKey_keepsTheNames_andOpensTheCase() = runBlocking {
        routes.on(CREATE, Routes.json(201, cases["createResponse"].toString()))
        val flow = VerdictFlow(
            api(), FakeHistory(), scope,
            onEntitlement = { applied += it },
            refreshAccount = { refreshes += Unit },
            newKey = { "ck-${++keys}" },
            caseNames = names,
        )
        assertTrue(flow.createCase("  Sam says a hot dog is a sandwich and I say it is not.  ", AppLang.TR, listOf("e1"), " Ayşe "))
        assertEquals(VerdictFlow.Nav.Case(ID), withTimeout(5_000) { flow.navigation.first() })
        assertTrue("the form holds until the case screen takes over", flow.creating.value)
        assertFalse(flow.canStart())
        flow.caseOpened()
        assertFalse(flow.creating.value)
        val req = routes.requestsTo(CREATE).single()
        assertEquals("ck-1", req.headers["Idempotency-Key"])
        val body = bodyOf(CREATE)
        assertEquals("Sam says a hot dog is a sandwich and I say it is not.", body["text"]!!.jsonPrimitive.content)
        assertTrue("framework" !in body)
        assertEquals("tr", body["lang"]!!.jsonPrimitive.content)
        assertEquals("premium", body["tier"]!!.jsonPrimitive.content)
        assertEquals(listOf("e1"), body["evidence"]!!.jsonArray.map { it.jsonPrimitive.content })
        assertEquals("Ayşe", body["displayName"]!!.jsonPrimitive.content)
        assertEquals(listOf(NameMapping("I", "Party A"), NameMapping("Sam", "Party B")), names.get(ID))
        assertEquals(13, applied.single().subscription!!.used)
    }

    @Test
    fun create_keepsWhoItWaitsFor_andLeavesOutNoEvidence() = runBlocking {
        routes.on(CREATE, Routes.json(201, cases["createResponse"].toString()))
        val flow = VerdictFlow(api(), FakeHistory(), scope, caseNames = names)
        assertTrue(flow.createCase("Sam says a hot dog is a sandwich and I say it is not.", AppLang.EN, emptyList(), "Alex", " Sam "))
        assertEquals("the case screen is told who it waits for", VerdictFlow.Nav.Case(ID, "Sam"), withTimeout(5_000) { flow.navigation.first() })
        assertEquals("and keeps it for later visits", "Sam", names.otherName(ID))
        val body = bodyOf(CREATE)
        assertEquals("premium", body["tier"]!!.jsonPrimitive.content)
        assertNull(body["evidence"])
    }

    @Test
    fun sendLink_needsCases_andNoSecondCard_andEitherNothingWrittenOrAValidSide() {
        val home = HomeUiState(argument = "Sam says a hot dog is a sandwich and I say it is not.", signedIn = true, features = Features(cases = true))
        assertTrue(home.canSendLink)
        assertTrue("signed out is sent through sign-in", home.copy(signedIn = false).canSendLink)
        assertFalse(home.copy(features = Features()).canSendLink)
        assertFalse("their card is open", home.copy(theirsOpen = true).canSendLink)
        assertFalse("a short side is not a side yet", home.copy(argument = "Too short").canSendLink)
        assertTrue("nothing written is a link without a side", home.copy(argument = "").canSendLink)
        assertTrue(home.copy(argument = "  \n ").canSendLink)
        assertFalse(home.copy(argument = "x".repeat(ArgumentRules.MAX + 1)).canSendLink)
        assertFalse(home.copy(creating = true).canSendLink)
    }

    @Test
    fun sendLink_contextImagesOnlyGoWithAWrittenSide() {
        val ok = EvidenceState(listOf(EvidenceItem("e1", 1, EvidenceStatus.OK, token = "t")), max = 3)
        val home = HomeUiState(signedIn = true, features = Features(cases = true, evidence = true), evidence = ok)
        assertFalse("images without text", home.canSendLink)
        val written = home.copy(argument = "Sam says a hot dog is a sandwich and I say it is not.")
        assertTrue(written.canSendLink)
        val reading = EvidenceState(listOf(EvidenceItem("e1", 1, EvidenceStatus.READING)), max = 3)
        assertFalse("still being read", written.copy(evidence = reading).canSendLink)
    }

    @Test
    fun create_withoutAText_leavesTheKeyOut_andARetryKeepsItsKey() = runBlocking {
        routes.on(CREATE, Routes.json(503, """{"error":"busy","code":"anonymize_failed"}"""))
        routes.on(CREATE, Routes.json(201, cases["createResponse"].toString()))
        val flow = VerdictFlow(api(), FakeHistory(), scope, newKey = { "ck-${++keys}" }, caseNames = names)
        assertTrue(flow.createCase("   ", AppLang.EN, emptyList(), "Alex"))
        withTimeout(5_000) { flow.lastError.first { it != null } }
        assertFalse(flow.creating.value)
        assertTrue("the form can try again", flow.createCase("", AppLang.EN, emptyList(), "Alex"))
        assertEquals(VerdictFlow.Nav.Case(ID), withTimeout(5_000) { flow.navigation.first() })
        assertEquals(listOf("ck-1", "ck-1"), routes.requestsTo(CREATE).map { it.headers["Idempotency-Key"] })
        val body = bodyOf(CREATE)
        assertTrue("text" !in body)
        assertEquals("Alex", body["displayName"]!!.jsonPrimitive.content)
    }

    @Test
    fun create_outOfUnits_opensPricing_andRefreshesTheAccount() = runBlocking {
        val e = Fixtures.verdicts["asyncErrors"]!!.jsonObject["fair_use"]!!.jsonObject
        routes.on(CREATE, Routes.json(402, e["body"].toString()))
        val flow = VerdictFlow(api(), FakeHistory(), scope, refreshAccount = { refreshes += Unit }, caseNames = names)
        flow.createCase("Sam says a hot dog is a sandwich and I say it is not.", AppLang.EN, emptyList(), "")
        assertEquals(VerdictFlow.Nav.Pricing, withTimeout(5_000) { flow.navigation.first() })
        assertNull(flow.lastError.value)
        assertFalse(flow.creating.value)
        withTimeout(5_000) { while (refreshes.isEmpty()) kotlinx.coroutines.delay(5) }
        assertNull("an empty name is left out", bodyOf(CREATE)["displayName"])
    }

    @Test
    fun judging_pollsAtTheServersPace_thenRevealsTheVerdict() = runBlocking {
        routes.on(GET, Routes.json(200, caseBody("judging")))
        routes.on(GET, Routes.json(200, caseBody("judging")))
        routes.on(GET, Routes.json(200, caseBody("judged")))
        val vm = vm()
        val first = vm.until { it.status == CaseLoadStatus.READY }
        assertEquals(CaseOverlay(done = false), first.overlay)
        tick.send(Unit)
        tick.send(Unit)
        val judged = vm.until { it.view?.status == CaseStatus.JUDGED }
        assertEquals(CaseOverlay(done = true), judged.overlay)
        assertEquals(listOf(3000L, 3000L), sleeps.toList())
        vm.finishOverlay()
        val after = vm.state.value
        assertNull(after.overlay)
        assertTrue(after.fresh)
        assertEquals(3, routes.requestsTo(GET).size)
    }

    @Test
    fun pollFailures_backOffTo30s_andKeepTheLastView() = runBlocking {
        routes.on(GET, Routes.json(200, caseBody("judging")))
        repeat(5) { routes.on(GET, Routes.json(503, """{"error":"down","code":"unavailable"}""")) }
        routes.on(GET, Routes.json(200, caseBody("judged")))
        val vm = vm()
        vm.until { it.status == CaseLoadStatus.READY }
        repeat(6) { tick.send(Unit) }
        vm.until { it.view?.status == CaseStatus.JUDGED }
        assertEquals(listOf(3000L, 6000L, 12000L, 24000L, 30000L, 30000L), sleeps.toList())
    }

    @Test
    fun aMissingCase_andASignedOutViewer_readAsSuch() = runBlocking {
        routes.on(GET, Routes.json(404, """{"error":"No case","code":"not_found"}"""))
        assertEquals(CaseLoadStatus.MISSING, vm().until { it.status != CaseLoadStatus.LOADING }.status)
        routes.on(GET, Routes.json(401, """{"error":"Sign in","code":"signin_required"}"""))
        assertEquals(CaseLoadStatus.SIGNIN, vm().until { it.status != CaseLoadStatus.LOADING }.status)
        routes.on(GET, Routes.json(500, "oops"))
        assertEquals(CaseLoadStatus.ERROR, vm().until { it.status != CaseLoadStatus.LOADING }.status)
    }

    @Test
    fun inviteReset_swapsTheLink() = runBlocking {
        routes.on(GET, Routes.json(200, caseBody("waiting_for_respondent")))
        routes.on("POST /api/v1/cases/$ID/invite", Routes.json(200, """{"inviteUrl":"https://okjudge.com/r/NEWtokenNEWtokenNEWtok"}"""))
        val vm = vm()
        vm.until { it.status == CaseLoadStatus.READY }
        vm.resetInvite()
        val after = vm.until { it.resetDone }
        assertEquals("https://okjudge.com/r/NEWtokenNEWtokenNEWtok", after.view!!.inviteUrl)
        assertFalse(after.busy)
    }

    @Test
    fun judgeNow_sendsOnlyMine_andRetrySendsAnEmptyBody() = runBlocking {
        routes.on(GET, Routes.json(200, caseBody("waiting_for_respondent")))
        routes.on(JUDGE, Routes.json(200, caseBody("judging")))
        routes.on(JUDGE, Routes.json(200, caseBody("judging")))
        val vm = vm()
        vm.until { it.status == CaseLoadStatus.READY }
        vm.judge(onlyMine = true)
        val judging = vm.until { it.view?.status == CaseStatus.JUDGING }
        assertEquals(CaseOverlay(false), judging.overlay)
        assertEquals("only_mine", bodyOf(JUDGE)["mode"]!!.jsonPrimitive.content)
        vm.until { !it.busy }
        vm.judge(onlyMine = false)
        withTimeout(5_000) { while (routes.requestsTo(JUDGE).size < 2) kotlinx.coroutines.delay(5) }
        assertEquals(JsonObject(emptyMap()), bodyOf(JUDGE, 1))
    }

    @Test
    fun anActionError_isShown_andAccountErrorsRefresh() = runBlocking {
        routes.on(GET, Routes.json(200, caseBody("failed")))
        routes.on(JUDGE, Routes.json(402, """{"error":"No credits","code":"no_credits"}"""))
        val vm = vm()
        vm.until { it.status == CaseLoadStatus.READY }
        vm.judge(onlyMine = false)
        val failed = vm.until { it.actionError != null }
        assertEquals("no_credits", (failed.actionError as UiError.Api).code)
        withTimeout(5_000) { while (refreshes.isEmpty()) kotlinx.coroutines.delay(5) }
    }

    @Test
    fun appeal_isGatedByLength_thenPostsWithAKey_andResumesPolling() = runBlocking {
        routes.on(GET, Routes.json(200, caseBody("judged")))
        routes.on(APPEALS, Routes.json(503, """{"error":"busy","code":"anonymize_failed"}"""))
        routes.on(APPEALS, Routes.json(202, cases["appealResponse"].toString()))
        val vm = vm()
        vm.until { it.status == CaseLoadStatus.READY }
        vm.onAppealText("  too short to send  ")
        assertFalse(vm.until { it.appealText == "  too short to send  " }.appealCanSubmit)
        vm.onAppealText("x".repeat(2100))
        assertEquals(CaseLogic.MAX_APPEAL_CHARS, vm.until { it.appealText.startsWith("x") }.appealText.length)
        val text = "  The judges missed the dictionary I quoted.  "
        vm.onAppealText(text)
        assertTrue(vm.until { it.appealText == text }.appealCanSubmit)

        vm.submitAppeal()
        val failed = vm.until { it.appealError != null }
        assertEquals("anonymize_failed", (failed.appealError as UiError.Api).code)
        vm.submitAppeal()
        val done = vm.until { it.view?.appealJudging == true }
        assertEquals("", done.appealText)
        assertEquals(listOf("ck-1", "ck-1"), routes.requestsTo(APPEALS).map { it.headers["Idempotency-Key"] })
        assertEquals("The judges missed the dictionary I quoted.", bodyOf(APPEALS)["text"]!!.jsonPrimitive.content)
        assertNull(bodyOf(APPEALS)["evidence"])
        assertEquals(6, applied.single().credits)
        assertTrue(names.get(ID).contains(NameMapping("Alex", "Party A")))
        // The re-judging view is polled again.
        withTimeout(5_000) { while (sleeps.isEmpty()) kotlinx.coroutines.delay(5) }
        assertEquals(3000L, sleeps.last())
    }

    private fun sideMissingBody(): String =
        JsonObject(mapOf("case" to JsonObject(viewJson("waiting_for_respondent") + ("ownerSideMissing" to JsonPrimitive(true))))).toString()

    @Test
    fun writeSide_isGatedByLength_thenPostsWithAKey_keepsTheNames_andShowsTheNewView() = runBlocking {
        routes.on(GET, Routes.json(200, sideMissingBody()))
        routes.on(SIDE, Routes.json(503, """{"error":"busy","code":"anonymize_failed"}"""))
        routes.on(SIDE, Routes.json(200, cases["createResponse"].toString()))
        val vm = vm()
        assertTrue(vm.until { it.status == CaseLoadStatus.READY }.view!!.ownerSideMissing)
        vm.onSideText("too short")
        assertFalse(vm.until { it.sideText == "too short" }.sideDraft.canSubmit)
        vm.submitSide()
        assertTrue("nothing is sent for a short side", routes.requestsTo(SIDE).isEmpty())
        val text = "  Sam says a hot dog is a sandwich and I say it is not.  "
        vm.onSideText(text)
        assertTrue(vm.until { it.sideText == text }.sideDraft.canSubmit)

        vm.submitSide()
        val failed = vm.until { it.sideError != null }
        assertEquals("anonymize_failed", (failed.sideError as UiError.Api).code)
        vm.submitSide()
        val done = vm.until { it.view?.ownerSideMissing == false }
        assertEquals("", done.sideText)
        assertEquals(listOf("ck-1", "ck-1"), routes.requestsTo(SIDE).map { it.headers["Idempotency-Key"] })
        val body = bodyOf(SIDE)
        assertEquals("Sam says a hot dog is a sandwich and I say it is not.", body["text"]!!.jsonPrimitive.content)
        assertNull(body["evidence"])
        assertEquals(13, applied.single().subscription!!.used)
        assertEquals(listOf(NameMapping("I", "Party A"), NameMapping("Sam", "Party B")), names.get(ID))
    }

    @Test
    fun appeal_withAScreenshot_sendsItsToken_andWaitsWhileItIsRead() = runBlocking {
        routes.on(GET, Routes.json(200, caseBody("judged")))
        routes.on("POST /api/v1/evidence", Routes.json(200, """{"items":[{"index":0,"status":"ok","kind":"chat","token":"ev-tok","preview":"p","expiresAt":null}]}"""))
        routes.on(APPEALS, Routes.json(202, cases["appealResponse"].toString()))
        val vm = vm()
        vm.until { it.status == CaseLoadStatus.READY }
        vm.onAppealText("The screenshot shows Sam agreeing with me.")
        vm.onAddAppealEvidence(listOf(ImageSource { Prepared.Ready(PreparedImage(byteArrayOf(1, 2), "image/jpeg")) }))
        vm.until { it.appealEvidence.tokens == listOf("ev-tok") }
        assertTrue(vm.state.value.appealCanSubmit)
        vm.submitAppeal()
        vm.until { it.view?.appealJudging == true }
        assertEquals(listOf("ev-tok"), bodyOf(APPEALS)["evidence"]!!.jsonArray.map { it.jsonPrimitive.content })
        assertTrue("the picker is emptied after sending", vm.state.value.appealEvidence.items.isEmpty())
    }

    @Test
    fun displayName_invalidSaysSo_andTheSwitchSendsOnlyIt() = runBlocking {
        routes.on(GET, Routes.json(200, caseBody("judged")))
        routes.on(DISPLAY, Routes.json(400, """{"error":"Bad name","code":"invalid"}"""))
        routes.on(DISPLAY, Routes.json(200, caseBody("judged")))
        routes.on(DISPLAY, Routes.json(200, caseBody("judged")))
        val vm = vm()
        vm.until { it.status == CaseLoadStatus.READY }
        vm.onTypedName("<<>>")
        vm.saveDisplayName()
        assertEquals(NamesError.Invalid, vm.until { it.namesError != null }.namesError)
        vm.onTypedName("   ")
        vm.saveDisplayName()
        vm.until { it.namesSaved }
        assertEquals(JsonNull, bodyOf(DISPLAY, 1)["displayName"])
        vm.setNamesVisible(false)
        withTimeout(5_000) { while (routes.requestsTo(DISPLAY).size < 3) kotlinx.coroutines.delay(5) }
        val third = bodyOf(DISPLAY, 2)
        assertEquals(setOf("namesVisible"), third.keys)
        assertEquals("false", third["namesVisible"]!!.jsonPrimitive.content)
    }

    @Test
    fun remove_confirmsWithTheServer_andForgetsTheNames() = runBlocking {
        names.save(ID, listOf(NameMapping("Sam", "Party B")))
        routes.on(GET, Routes.json(200, caseBody("judged")))
        routes.on(
            "POST /api/v1/cases/$ID/removal",
            Routes.json(200, JsonObject(mapOf("removed" to kotlinx.serialization.json.JsonPrimitive(true), "removedAt" to kotlinx.serialization.json.JsonPrimitive("2026-10-21T08:00:00.000Z"), "case" to viewJson("removed"))).toString()),
        )
        val vm = vm()
        assertEquals(listOf(NameMapping("Sam", "Party B")), vm.state.value.localNames)
        vm.until { it.status == CaseLoadStatus.READY }
        vm.remove()
        val after = vm.until { it.removedNow }
        assertTrue(after.view!!.removed != null)
        assertEquals("remove", bodyOf("POST /api/v1/cases/$ID/removal")["confirm"]!!.jsonPrimitive.content)
        assertTrue(names.get(ID).isEmpty())
        assertTrue(after.names.isEmpty())
    }

    @Test
    fun caseList_loads() = runBlocking {
        routes.on("GET /api/v1/cases", Routes.json(200, cases["list"].toString()))
        val res = api().listCases()
        val list = (res as ApiResult.Ok).value
        assertEquals(3, list.cases.size)
        assertEquals("20", routes.requestsTo("GET /api/v1/cases").single().url.queryParameter("limit"))
        assertTrue(list.cases[2].removed)
        assertEquals(CaseStatus.AWAITING, list.cases[0].status)
    }

    @Test
    fun pureHelpers() {
        assertEquals(null, CaseLogic.nextPollDelay(view("judged"), 0))
        assertEquals(3000L, CaseLogic.nextPollDelay(view("judging"), 0))
        assertEquals(30_000L, CaseLogic.nextPollDelay(view("judging"), 9))
        assertEquals("Taraf A ile Taraf B dedi ki bu bir sandviç değil", CaseLogic.localizeLabelsAuto("Party A ile Party B dedi ki bu bir sandviç değil"))
        assertEquals("Party A said the hot dog was a sandwich", CaseLogic.localizeLabelsAuto("Party A said the hot dog was a sandwich"))
        assertEquals("Party A said the hot dog was a sandwich", CaseLogic.localizeLabels("Taraf A said the hot dog was a sandwich", AppLang.EN))
        assertEquals("Person C and Party B", CaseLogic.localizeLabels("Kişi C and Taraf B", AppLang.EN))
        assertEquals("Party C stays", CaseLogic.localizeLabels("Party C stays", AppLang.TR))
        assertEquals("Ayşe", CaseLogic.firstNameOf("Ayşe Yılmaz"))
        assertNull(CaseLogic.firstNameOf("i"))
        assertNull(CaseLogic.firstNameOf("lowercase"))
        assertNull(CaseLogic.firstNameOf(null))
        assertEquals(
            listOf(NameMapping("I", "Party A"), NameMapping("Sam", "Party B")),
            CaseLogic.mergeNameMaps(listOf(NameMapping("I", "Party A")), listOf(NameMapping("I", "Party A"), NameMapping("Sam", "Party B"))),
        )
    }

    @Test
    fun deepLinks_caseOpensNatively_invitesGoToTheWeb() {
        assertEquals(DeepLinks.Target.Case("case0000001"), DeepLinks.parse("https://okjudge.com/c/case0000001"))
        assertEquals(
            DeepLinks.Target.Invite("https://okjudge.com/r/Xk3pQ9vLm2Rt7YbN4cWd0A"),
            DeepLinks.parse("https://okjudge.com/r/Xk3pQ9vLm2Rt7YbN4cWd0A"),
        )
        assertNull(DeepLinks.parse("https://okjudge.com/v/abc"))
        assertNull(DeepLinks.parse("http://okjudge.com/c/abc"))
        assertNull(DeepLinks.parse("https://okjudge.com/c/a%20b"))
        assertNull(DeepLinks.parse("not a url"))
        assertNull("only the site's own links", DeepLinks.parse("https://evil.example/r/Xk3pQ9vLm2Rt7YbN4cWd0A"))
    }

    /** A three-sided case as its owner sees it: B has answered, C still waits. */
    private fun manyCase(): String {
        val base = viewJson("waiting_for_respondent").toMutableMap()
        base["parties"] = JsonArray(listOf("a", "b", "c").map(::JsonPrimitive))
        base["canJudgeAnswered"] = JsonPrimitive(true)
        base["invites"] = Json.parseToJsonElement(
            """[{"party":"b","status":"answered","inviteUrl":null,"answeredAt":"2026-11-02T10:00:00.000Z"},
                {"party":"c","status":"waiting","inviteUrl":"https://okjudge.com/r/CtokenCtokenCtokenCtok","answeredAt":null}]""",
        )
        base["display"] = Json.parseToJsonElement("""{"namesVisible":true,"a":"Ayşe","b":"Sam","c":"Deniz"}""")
        return JsonObject(mapOf("case" to JsonObject(base))).toString()
    }

    @Test
    fun aCaseWithThreeSides_decodesItsPartiesAndInvites() {
        val view = WireJson.json.decodeFromString(
            com.okjudge.judge.core.model.CaseResponse.serializer(), manyCase(),
        ).case
        assertEquals(listOf(Side.A, Side.B, Side.C), view.manySides)
        assertEquals(3, view.sideCount)
        assertEquals(listOf(Side.B, Side.C), view.invites!!.map { it.side })
        assertTrue(view.invites!!.first().answered)
        assertTrue(view.invites!!.last().waiting)
        assertEquals("Deniz", view.display.name(Side.C))
        assertTrue(view.canJudgeAnswered)
        assertEquals("two sides have no invites or parties", 2, view("waiting_for_respondent").sideCount)
        assertNull(view("waiting_for_respondent").invites)
    }

    @Test
    fun inviteReset_forASide_asksForThatSideOnly() = runBlocking {
        routes.on(GET, Routes.json(200, manyCase()))
        routes.on("POST /api/v1/cases/$ID/invite", Routes.json(200, """{"inviteUrl":"https://okjudge.com/r/NEWCtokenNEWCtokenNEWCt","party":"c"}"""))
        val vm = vm()
        vm.until { it.status == CaseLoadStatus.READY }
        vm.resetInvite(Side.C)
        val after = vm.until { it.resetDone }
        assertEquals(Side.C, after.resetSide)
        assertEquals("c", bodyOf("POST /api/v1/cases/$ID/invite")["party"]!!.jsonPrimitive.content)
        assertEquals("https://okjudge.com/r/NEWCtokenNEWCtokenNEWCt", after.view!!.invites!!.single { it.side == Side.C }.inviteUrl)
        assertEquals("side B's link is left alone", viewJson("waiting_for_respondent")["inviteUrl"]?.jsonPrimitive?.content, after.view!!.inviteUrl)
    }

    @Test
    fun judgeAnswered_sendsTheAnsweredMode() = runBlocking {
        routes.on(GET, Routes.json(200, manyCase()))
        routes.on(JUDGE, Routes.json(200, caseBody("judging")))
        val vm = vm()
        vm.until { it.status == CaseLoadStatus.READY }
        vm.judgeAnswered()
        vm.until { it.view?.status == CaseStatus.JUDGING }
        assertEquals("answered", bodyOf(JUDGE)["mode"]!!.jsonPrimitive.content)
    }

    @Test
    fun create_withMoreThanTwoSides_sendsHowMany() = runBlocking {
        routes.on(CREATE, Routes.json(201, cases["createResponse"].toString()))
        val flow = VerdictFlow(api(), FakeHistory(), scope, newKey = { "ck-${++keys}" }, caseNames = names)
        assertTrue(flow.createCase("Sam says a hot dog is a sandwich and I say it is not.", AppLang.EN, emptyList(), null, sides = 4))
        withTimeout(5_000) { flow.navigation.first() }
        assertEquals(4, bodyOf(CREATE)["sides"]!!.jsonPrimitive.content.toInt())
    }

    @Test
    fun create_withTwoSides_sendsNoSidesField() = runBlocking {
        routes.on(CREATE, Routes.json(201, cases["createResponse"].toString()))
        val flow = VerdictFlow(api(), FakeHistory(), scope, newKey = { "ck-${++keys}" }, caseNames = names)
        assertTrue(flow.createCase("Sam says a hot dog is a sandwich and I say it is not.", AppLang.EN, emptyList(), null))
        withTimeout(5_000) { flow.navigation.first() }
        assertNull(bodyOf(CREATE)["sides"])
    }

    private val sam = "Sam says a hot dog is a sandwich and I say it is not."

    @Test
    fun home_addSide_upToFour_andEachNeedsASide() {
        val home = HomeUiState(argument = sam, otherSide = sam, theirsOpen = true, signedIn = true, features = Features(cases = true))
        assertEquals(listOf(Side.A, Side.B), home.openSides)
        assertTrue("an answered second card offers another side", home.canAddSide)
        assertTrue("with links on, sides still to be invited can take another", home.copy(otherSide = "").canAddSide)
        assertFalse("without them an empty card does not", home.copy(otherSide = "", features = Features()).canAddSide)
        val three = home.copy(more = listOf(ExtraSide(text = sam)))
        assertEquals(listOf(Side.A, Side.B, Side.C), three.openSides)
        assertTrue(three.canAddSide)
        assertTrue(three.canSubmit)
        assertFalse("a side too short to judge", three.copy(more = listOf(ExtraSide(text = "Too short"))).canSubmit)
        val four = three.copy(more = listOf(ExtraSide(text = sam), ExtraSide(text = sam)))
        assertEquals(listOf(Side.A, Side.B, Side.C, Side.D), four.openSides)
        assertFalse("four is the most", four.canAddSide)
        assertFalse(HomeUiState(argument = sam, theirsOpen = false).canAddSide)
    }

    @Test
    fun home_linkReturnsOnceAThirdSideIsAddedWithNoText() {
        val home = HomeUiState(theirsOpen = true, signedIn = true, features = Features(cases = true))
        assertFalse("two cards open: they write both", home.canSendLink)
        val three = home.copy(more = listOf(ExtraSide()))
        assertTrue(three.canSendLink)
        assertTrue("sides still to be invited can take another", three.canAddSide)
        assertFalse("text in another side is a verdict, not a link", three.copy(otherSide = sam).canSendLink)
    }

    private companion object {
        const val ID = "case0000001"
        const val CREATE = "POST /api/v1/cases"
        const val GET = "GET /api/v1/cases/$ID"
        const val JUDGE = "POST /api/v1/cases/$ID/judge"
        const val APPEALS = "POST /api/v1/cases/$ID/appeals"
        const val SIDE = "POST /api/v1/cases/$ID/side"
        const val DISPLAY = "PATCH /api/v1/cases/$ID/display"
    }
}
