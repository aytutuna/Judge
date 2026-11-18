package com.okjudge.judge.ui.home

import androidx.lifecycle.SavedStateHandle
import com.okjudge.judge.FakeHistory
import com.okjudge.judge.Fixtures
import com.okjudge.judge.core.api.JudgeApi
import com.okjudge.judge.core.auth.Account
import com.okjudge.judge.core.auth.Routes
import com.okjudge.judge.core.cases.MemoryCaseNames
import com.okjudge.judge.core.api.ApiResult
import com.okjudge.judge.core.evidence.ImageSource
import com.okjudge.judge.core.evidence.Prepared
import com.okjudge.judge.core.evidence.PreparedImage
import com.okjudge.judge.core.model.EvidenceItemResult
import com.okjudge.judge.core.model.EvidenceUploadResponse
import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.okjudge.judge.core.display.ExampleBook
import com.okjudge.judge.core.model.Entitlement
import com.okjudge.judge.core.model.Features
import com.okjudge.judge.core.model.MeResponse
import com.okjudge.judge.core.model.Side
import com.okjudge.judge.core.model.ServerConfig
import com.okjudge.judge.core.model.Viewer
import com.okjudge.judge.core.session.MemoryDraft
import com.okjudge.judge.core.session.VerdictFlow
import com.okjudge.judge.i18n.AppLang
import com.okjudge.judge.ui.UiTestSupport
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.jsonObject
import mockwebserver3.MockWebServer
import okhttp3.OkHttpClient
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import kotlin.random.Random

@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class HomeViewModelTest {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Unconfined)

    @Before
    fun setUp() {
        Dispatchers.setMain(Dispatchers.Unconfined)
    }

    @After
    fun tearDown() {
        scope.cancel()
        Dispatchers.resetMain()
    }

    private val flow = VerdictFlow(JudgeApi("http://localhost:1/", OkHttpClient(), "ua"), FakeHistory(), scope)

    private val book: ExampleBook by lazy {
        val context = ApplicationProvider.getApplicationContext<Context>()
        ExampleBook(context.assets, context.getSharedPreferences("home-examples-test", Context.MODE_PRIVATE).also { it.edit().clear().commit() })
    }

    private fun vm(random: Random = Random(7), account: Account.State = Account.State.SignedOut): HomeViewModel {
        val ready = Account.Providers.Ready(ServerConfig(features = Features(cases = true)))
        return HomeViewModel(SavedStateHandle(), flow, flowOf(account), flowOf(ready), random = random, example = book::next)
    }

    private fun signedIn(e: Entitlement?) = Account.State.SignedIn(MeResponse(Viewer("u1", "ada@example.com"), e))

    private val argument = "My roommate never does the dishes and says it is my turn."

    @Test
    fun example_replacesWhatWasTyped_andShowsEveryOneOncePerRound() {
        val vm = vm()
        vm.onArgumentChange("something I typed myself")
        vm.onOtherName("Jo")
        val examples = book.load(AppLang.EN)
        val shown = mutableListOf<String>()
        repeat(examples.size) {
            vm.fillExample(AppLang.EN)
            val now = vm.state.value
            val example = examples.single { it.a == now.argument }
            assertEquals(example.aName, now.shownName)
            assertEquals(example.bName, now.otherName)
            assertEquals(example.b, now.otherSide)
            shown += example.id
        }
        assertEquals("no repeats within a round", examples.size, shown.toSet().size)
        vm.fillExample(AppLang.EN)
        assertNotEquals("a new round does not open with the last one", shown.last(), examples.single { it.a == vm.state.value.argument }.id)
    }

    @Test
    fun example_isInTheAppLanguage() {
        val vm = vm()
        vm.fillExample(AppLang.TR)
        assertTrue(book.load(AppLang.TR).any { it.a == vm.state.value.argument })
    }

    @Test
    fun clear_dropsTheExampleName_butKeepsOneTheUserTyped() {
        val vm = vm()
        vm.fillExample(AppLang.EN)
        vm.clear()
        assertTrue(vm.state.value.blank)
        assertEquals("", vm.state.value.shownName)
        assertEquals("", vm.state.value.otherName)

        vm.onDisplayName("Ada")
        vm.fillExample(AppLang.EN)
        vm.onDisplayName("Ada")
        vm.clear()
        assertEquals("Ada", vm.state.value.shownName)
        assertTrue(vm.state.value.blank)
    }

    @Test
    fun onePersonWritesUntilTheirSideIsAdded() {
        val vm = vm()
        assertFalse(vm.state.value.theirsOpen)
        vm.addTheirSide()
        assertTrue(vm.state.value.theirsOpen)
        vm.onOtherSideChange("Their account of it.")
        vm.onOtherName("Sam")
        vm.removeTheirSide()
        val state = vm.state.value
        assertFalse(state.theirsOpen)
        assertEquals("", state.otherSide)
        assertEquals("", state.otherName)
    }

    @Test
    fun theOpenCardStaysWhenItsTextIsDeleted() {
        val vm = vm()
        vm.addTheirSide()
        vm.onOtherSideChange("x")
        vm.onOtherSideChange("")
        assertTrue(vm.state.value.theirsOpen)
    }

    @Test
    fun aRestoredDraftWithTheirSideOpensTheCard() {
        val saved = SavedStateHandle(mapOf("argument" to argument, "other_side" to "Their account of it."))
        val vm = HomeViewModel(saved, flow, flowOf(Account.State.SignedOut), flowOf(Account.Providers.Loading))
        assertTrue(vm.state.value.theirsOpen)
    }

    @Test
    fun theDraftSurvivesAnotherFormAndClearDropsIt() {
        val store = MemoryDraft()
        fun open() = HomeViewModel(SavedStateHandle(), flow, flowOf(Account.State.SignedOut), flowOf(Account.Providers.Loading), drafts = store)
        val first = open()
        first.onArgumentChange(argument)
        first.addTheirSide()
        first.onOtherSideChange("Their account of it.")
        first.addSide()
        first.onExtraSideChange(0, "A third view of it.")
        val second = open()
        assertEquals(argument, second.state.value.argument)
        assertEquals("Their account of it.", second.state.value.otherSide)
        assertTrue(second.state.value.theirsOpen)
        assertEquals(listOf("A third view of it."), second.state.value.more.map { it.text })
        second.clear()
        assertNull(store.load())
        assertEquals("", open().state.value.argument)
    }

    @Test
    fun signingOutEmptiesTheFormAndTheDraft() {
        val store = MemoryDraft()
        val ended = MutableSharedFlow<Unit>()
        val vm = HomeViewModel(SavedStateHandle(), flow, flowOf(Account.State.SignedOut), flowOf(Account.Providers.Loading), drafts = store, accountEnded = ended)
        vm.onArgumentChange(argument)
        vm.addTheirSide()
        vm.onOtherSideChange("Their account of it.")
        assertTrue(store.load() != null)
        runBlocking { ended.emit(Unit) }
        assertEquals("", vm.state.value.argument)
        assertEquals("", vm.state.value.otherSide)
        assertFalse(vm.state.value.theirsOpen)
        assertNull(store.load())
    }

    @Test
    fun anExampleNeverReplacesTheUsersText() {
        val vm = vm()
        assertTrue(vm.state.value.offersExample)
        vm.fillExample(AppLang.EN)
        assertTrue(vm.state.value.theirsOpen)
        assertTrue("another example can replace an example", vm.state.value.offersExample)
        vm.onArgumentChange(vm.state.value.argument + " And one more thing.")
        assertFalse(vm.state.value.offersExample)
        vm.clear()
        assertTrue(vm.state.value.offersExample)
    }

    @Test
    fun anExampleIsKeptOnlyWhileNothingInItWasEdited() {
        val vm = vm()
        vm.fillExample(AppLang.EN)
        vm.onOtherSideChange(vm.state.value.otherSide + " Also this.")
        assertFalse(vm.state.value.offersExample)

        vm.clear()
        vm.fillExample(AppLang.EN)
        assertTrue(vm.state.value.offersExample)
        vm.onOtherName("Someone else")
        assertFalse(vm.state.value.offersExample)

        vm.clear()
        vm.fillExample(AppLang.EN)
        vm.onDisplayName("Me")
        assertFalse(vm.state.value.offersExample)
    }

    @Test
    fun removingTheirSideDropsTheExampleNameAndMarker() {
        val vm = vm()
        vm.fillExample(AppLang.EN)
        vm.removeTheirSide()
        assertEquals("", vm.state.value.shownName)
        assertEquals(null, vm.state.value.exampleText)
        vm.onDisplayName("Ada")
        vm.addTheirSide()
        vm.removeTheirSide()
        assertEquals("Ada", vm.state.value.shownName)
    }

    @Test
    fun blankIncludesTheOpenCard_andClearClosesIt() {
        val vm = vm()
        assertTrue(vm.state.value.blank)
        vm.addTheirSide()
        assertFalse("an open second card is something to clear", vm.state.value.blank)
        vm.clear()
        assertTrue(vm.state.value.blank)
        assertFalse(vm.state.value.theirsOpen)
    }

    @Test
    fun submit_signedOut_asksForASignIn_andSendsNothing() {
        val vm = vm()
        vm.onArgumentChange(argument)
        assertEquals(Submitted.SIGN_IN, vm.submit(AppLang.EN, UiTestSupport.s(AppLang.EN)))
        assertTrue(flow.canStart())
    }

    @Test
    fun submit_andSendLink_withNothingLeft_openPricing() {
        val vm = vm(account = signedIn(Entitlement(credits = 0)))
        vm.onArgumentChange(argument)
        assertTrue(vm.state.value.outOfUnits)
        assertEquals(Submitted.PRICING, vm.submit(AppLang.EN, UiTestSupport.s(AppLang.EN)))
        assertEquals(Submitted.PRICING, vm.sendLink(AppLang.EN))
        assertTrue(flow.canStart())
    }

    @Test
    fun sendLink_isOpenFromTheStart_andSignedOutGoesThroughSignIn() {
        val vm = vm()
        assertTrue(vm.state.value.canSendLink)
        assertEquals(Submitted.SIGN_IN, vm.sendLink(AppLang.EN))
        assertTrue(flow.canStart())
    }

    @Test
    fun sendLink_followsTheTextRules() {
        val vm = vm()
        vm.onArgumentChange("too short")
        assertFalse(vm.state.value.canSendLink)
        assertEquals(Submitted.NOTHING, vm.sendLink(AppLang.EN))
        vm.onArgumentChange("   ")
        assertTrue(vm.state.value.canSendLink)
        vm.onArgumentChange(argument)
        assertTrue(vm.state.value.canSendLink)
        vm.addTheirSide()
        assertFalse(vm.state.value.canSendLink)
    }

    @Test
    fun submit_withACredit_orBeforeTheBalanceLoads_goesToTheQuestions() {
        for (e in listOf(Entitlement(canUsePremium = true, credits = 1), null)) {
            val vm = vm(account = signedIn(e))
            vm.onArgumentChange(argument)
            assertEquals(Submitted.CHECKING, vm.submit(AppLang.EN, UiTestSupport.s(AppLang.EN)))
            flow.cancel()
        }
    }

    @Test
    fun home_joinsAllSidesWithTheirNames_andListsTheWrittenOnes() {
        val s = UiTestSupport.s(AppLang.EN)
        val home = HomeUiState(
            argument = "I did the dishes twice.", otherSide = "I did them three times.", otherName = "Sam",
            theirsOpen = true, more = listOf(ExtraSide("Nobody asked me.", "Deniz"), ExtraSide("I was out of town.")),
        )
        val text = home.outgoing(s)
        assertTrue(text, text.contains("Deniz") && text.contains("Nobody asked me."))
        assertTrue("an unnamed side reads as its label", text.contains("Party D: I was out of town."))
        assertEquals(listOf(Side.A, Side.B, Side.C, Side.D), home.sides.map { it.party })
    }

    @Test
    fun createdCase_handsOutItsLinkOnce_andHomeStaysEmpty() = runBlocking {
        val routes = Routes()
        val server = MockWebServer().also { it.dispatcher = routes; it.start() }
        try {
            routes.on("POST /api/v1/cases", Routes.json(201, Fixtures.verdicts["cases"]!!.jsonObject["createResponse"].toString()))
            val created = VerdictFlow(JudgeApi(server.url("/").toString(), OkHttpClient(), "ua"), FakeHistory(), scope, caseNames = MemoryCaseNames())
            val ready = Account.Providers.Ready(ServerConfig(features = Features(cases = true)))
            val vm = HomeViewModel(SavedStateHandle(), created, flowOf(signedIn(null)), flowOf(ready))
            vm.onArgumentChange(argument)
            vm.onDisplayName("Ada")
            assertEquals(Submitted.CREATING, vm.sendLink(AppLang.EN))
            assertEquals("https://okjudge.com/r/Xk3pQ9vLm2Rt7YbN4cWd0A", withTimeout(5_000) { vm.shareLink.first() })
            val after = withTimeout(5_000) { vm.state.first { it.blank && !it.creating } }
            assertEquals("", after.argument)
            assertNull("the link is handed out once", withTimeoutOrNull(300) { vm.shareLink.first() })
        } finally {
            server.close()
        }
    }

    private fun evidenceVm(): HomeViewModel {
        var n = 0
        val ready = Account.Providers.Ready(ServerConfig(features = Features(cases = true, evidence = true)))
        return HomeViewModel(
            SavedStateHandle(), flow, flowOf(signedIn(null)), flowOf(ready),
            uploadEvidence = { images ->
                ApiResult.Ok(EvidenceUploadResponse(images.map { EvidenceItemResult(index = n++ % images.size, status = "ok", kind = "chat", token = "tok-$n") }))
            },
        )
    }

    private fun shot() = ImageSource { Prepared.Ready(PreparedImage("x".toByteArray(), "image/jpeg")) }

    private suspend fun HomeViewModel.settled(): HomeUiState =
        withTimeout(5_000) { state.first { s -> !s.evidence.busy && s.otherEvidence.none { it.busy } } }

    @Test
    fun evidence_belongsToTheBoxItWasAddedTo_withItsOwnLimit() = runBlocking {
        val vm = evidenceVm()
        vm.addTheirSide()
        vm.onAddEvidence(Side.A, List(5) { shot() })
        vm.onAddEvidence(Side.B, listOf(shot()))
        val st = vm.settled()
        assertEquals(MAX_EVIDENCE_PER_SIDE, st.evidenceOf(Side.A).items.size)
        assertEquals(1, st.evidenceOf(Side.B).items.size)
        assertTrue(st.evidenceOf(Side.C).items.isEmpty())
        assertEquals(1, st.evidenceOf(Side.B).tokens.size)
    }

    @Test
    fun otherTokens_oneListPerSideInTheRequest_orNoneWhenOnlyAHasImages() = runBlocking {
        val vm = evidenceVm(); vm.addTheirSide()
        vm.onAddEvidence(Side.A, listOf(shot()))
        vm.settled()
        vm.onOtherSideChange(argument)
        assertTrue(vm.state.value.otherTokens.isEmpty())
        vm.onAddEvidence(Side.B, listOf(shot()))
        assertEquals(1, vm.settled().otherTokens.size)
        vm.addSide()
        vm.addSide()
        vm.onAddEvidence(Side.D, listOf(shot()))
        val st = vm.settled()
        assertEquals(listOf(1, 0, 1), st.otherTokens.map { it.size })
        assertFalse("an invite only carries side A's images", st.canSendLink)
    }

    @Test
    fun imagesInABoxWithoutAWrittenSide_areLeftOut() = runBlocking {
        val vm = evidenceVm(); vm.addTheirSide()
        vm.onAddEvidence(Side.B, listOf(shot()))
        assertTrue(vm.settled().otherTokens.isEmpty())
    }

    @Test
    fun removingASide_clearsItsImages_andClearEmptiesEveryBox() = runBlocking {
        val vm = evidenceVm(); vm.addTheirSide(); vm.addSide(); vm.addSide()
        Side.entries.forEach { vm.onAddEvidence(it, listOf(shot())) }
        assertTrue(vm.settled().evidenceOf(Side.D).items.isNotEmpty())
        vm.removeLastSide()
        val st = vm.state.value
        assertTrue(st.evidenceOf(Side.D).items.isEmpty())
        assertEquals(1, st.evidenceOf(Side.C).items.size)
        vm.removeTheirSide()
        assertTrue(listOf(Side.B, Side.C).all { vm.state.value.evidenceOf(it).items.isEmpty() })
        assertEquals(1, vm.state.value.evidence.items.size)
        vm.clear()
        assertTrue(vm.state.value.blank)
    }
}
