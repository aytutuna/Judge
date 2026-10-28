package com.okjudge.judge.ui

import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertContentDescriptionEquals
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.unit.dp
import com.okjudge.judge.Fixtures
import com.okjudge.judge.str
import com.okjudge.judge.core.data.SavedVerdict
import com.okjudge.judge.core.display.ContentLang
import com.okjudge.judge.core.display.PartyNames
import com.okjudge.judge.core.display.UiError
import com.okjudge.judge.core.display.VerdictDisplay
import com.okjudge.judge.core.model.FactCheck
import com.okjudge.judge.core.model.FactClaim
import com.okjudge.judge.core.model.FactSource
import com.okjudge.judge.core.model.Features
import com.okjudge.judge.core.session.VerdictFlow
import com.okjudge.judge.core.model.VerdictOutcome
import com.okjudge.judge.i18n.AppLang
import com.okjudge.judge.ui.components.TopBarTags
import com.okjudge.judge.ui.history.HistoryScreen
import com.okjudge.judge.ui.history.HistoryTags
import com.okjudge.judge.ui.home.HomeScreen
import com.okjudge.judge.ui.home.HomeTags
import com.okjudge.judge.ui.home.HomeUiState
import com.okjudge.judge.ui.judging.JudgingScreen
import com.okjudge.judge.ui.judging.JudgingTags
import com.okjudge.judge.ui.verdict.CardActions
import com.okjudge.judge.ui.verdict.TranslationStatus
import com.okjudge.judge.ui.verdict.TranslationView
import com.okjudge.judge.ui.verdict.RulingSummary
import com.okjudge.judge.ui.verdict.VerdictTags
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.util.Locale

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], qualifiers = "w400dp-h2400dp-xhdpi")
class ScreensTest {
    @get:Rule
    val compose = createComposeRule()

    private fun home(lang: AppLang, initial: HomeUiState = HomeUiState(), onSendLink: () -> Unit = {}) {
        compose.setContent {
            Themed(lang) {
                var state by remember { mutableStateOf(initial) }
                HomeScreen(
                    state = state,
                    onArgumentChange = { state = state.copy(argument = it) },
                    onSubmit = {},
                    onDismissError = { state = state.copy(error = null) },
                    onNew = {},
                    onOpenPrivacy = {},
                    onOtherSideChange = { state = state.copy(otherSide = it) },
                    onOtherName = { state = state.copy(otherName = it) },
                    onDisplayName = { state = state.copy(typedName = it) },
                    onSendLink = onSendLink,
                )
            }
        }
    }

    @Test
    fun home_disabledUntil20Chars_andCountsWhatIsSent() {
        home(AppLang.EN)
        val en = UiTestSupport.s(AppLang.EN)
        compose.onNodeWithTag(HomeTags.COUNTER).assertDoesNotExist()
        compose.onNodeWithTag(HomeTags.SUBMIT).assertIsNotEnabled()
        compose.onNodeWithTag(HomeTags.INPUT).performTextInput("nineteen characters")
        compose.onNodeWithTag(HomeTags.SUBMIT).assertIsNotEnabled()
        compose.onNodeWithTag(HomeTags.INPUT).performTextInput("!")
        compose.onNodeWithTag(HomeTags.SUBMIT).assertIsEnabled()
        compose.onNodeWithTag(HomeTags.COUNTER).assertTextEquals("20 / 6,000")
        compose.onNodeWithTag(HomeTags.NAME).performTextInput("Alex")
        compose.onNodeWithTag(HomeTags.OTHER).performTextInput("It is a sandwich.")
        val joined = HomeUiState.joined("nineteen characters!", "It is a sandwich.", "Alex", "", en)
        assertEquals("Alex says: nineteen characters!\n\nTheir side: It is a sandwich.", joined)
        compose.onNodeWithTag(HomeTags.COUNTER).assertTextEquals("${joined.length} / 6,000")
    }

    @Test
    fun home_bothSidesTogetherCanGoOverTheLimit() {
        val half = "x".repeat(3000)
        home(AppLang.EN, HomeUiState(argument = half, otherSide = half))
        compose.onNodeWithTag(HomeTags.SUBMIT).assertIsNotEnabled()
        val sent = HomeUiState.joined(half, half, "", "", UiTestSupport.s(AppLang.EN)).length
        assertTrue(sent > 6000)
        compose.onNodeWithTag(HomeTags.COUNTER).assertTextEquals("${"%,d".format(sent)} / 6,000")
    }

    @Test
    fun home_tr_sideLabelsUppercaseWithTurkishRules() {
        home(AppLang.TR)
        // "Senin tarafın" must become "SENİN TARAFIN", not "SENIN TARAFIN".
        compose.onNodeWithText("SENİN TARAFIN").assertExists()
        compose.onNodeWithText(UiTestSupport.s(AppLang.TR).appHomeExample).assertExists()
    }

    @Test
    fun home_sendLink_onlyWhileTheirSideIsEmpty() {
        var sent = 0
        home(AppLang.EN, HomeUiState(signedIn = true, features = Features(cases = true)), onSendLink = { sent++ })
        compose.onNodeWithTag(HomeTags.SEND_LINK).assertIsNotEnabled()
        compose.onNodeWithTag(HomeTags.INPUT).performTextInput("My roommate never does the dishes")
        compose.onNodeWithTag(HomeTags.SEND_LINK).assertIsEnabled().performClick()
        assertEquals(1, sent)
        compose.onNodeWithTag(HomeTags.OTHER).performTextInput("I did them on Sunday.")
        compose.onNodeWithTag(HomeTags.SEND_LINK).assertDoesNotExist()
    }

    @Test
    fun home_newButton_hiddenWhileBlank_clearsTheForm() {
        val en = UiTestSupport.s(AppLang.EN)
        var state by mutableStateOf(HomeUiState())
        compose.setContent {
            Themed(AppLang.EN) {
                HomeScreen(
                    state = state,
                    onArgumentChange = { state = state.copy(argument = it) },
                    onSubmit = {},
                    onDismissError = {},
                    onNew = { state = HomeUiState() },
                    onOpenPrivacy = {},
                    onOtherSideChange = { state = state.copy(otherSide = it) },
                )
            }
        }
        compose.onNodeWithTag(TopBarTags.NEW).assertDoesNotExist()
        compose.onNodeWithTag(HomeTags.OTHER).performTextInput("My roommate never does the dishes")
        compose.onNodeWithContentDescription(en.shellNew).assertExists()
        compose.onNodeWithTag(TopBarTags.NEW).performClick()
        compose.onNodeWithTag(HomeTags.COUNTER).assertDoesNotExist()
        compose.onNodeWithTag(TopBarTags.NEW).assertDoesNotExist()
    }

    @Test
    fun home_newButton_hiddenWhileARequestIsOnItsWay() {
        // Clearing now would not stop the request, which then opens its next screen.
        home(AppLang.EN, HomeUiState(argument = "My roommate never does the dishes", creating = true))
        compose.onNodeWithTag(TopBarTags.NEW).assertDoesNotExist()
    }

    @Test
    fun home_sendLinkNeedsCases() {
        home(AppLang.EN)
        compose.onNodeWithTag(HomeTags.SEND_LINK).assertDoesNotExist()
    }

    @Test
    fun home_showsLocalizedErrors() {
        home(AppLang.TR, HomeUiState(error = UiError.Api("rate_limited", 429, retryAfterSec = 420.0)))
        compose.onNodeWithText("Ağır ol, burası mahkeme! Şimdilik sınıra geldin. 7 dakika sonra tekrar dene.").assertExists()
    }

    @Test
    fun verdictCard_rendersEverySample_withRestoredLabels() {
        for (lang in AppLang.entries) {
            for (name in Fixtures.sampleNames) {
                val outcome = sample(name)
                compose.setContentOnce { Themed(lang) { SampleVerdict(outcome, lang, modifier = Modifier.verticalScroll(rememberScrollState()).padding(16.dp)) } }
                val s = UiTestSupport.s(lang)
                val r = outcome.result.result
                val parties = PartyNames.partyNames(outcome.nameMap, ContentLang.verdictLang(r), s)
                compose.onNodeWithText(VerdictDisplay.verdictLabel(r, parties, s).uppercase(lang.locale)).assertExists()
                // The fixture translation stands in for the original in the other language,
                // with real names restored as the web shows them.
                if (!r.refused) compose.onNodeWithText(personalizedCrux(name, outcome, lang)).assertExists()
                VerdictDisplay.confidenceLabel(r, s)?.let { compose.onNodeWithText(it).assertExists() }
                if (outcome.nameMap.isNotEmpty()) {
                    // The labels never fall back to "Party A/B" when a name map exists.
                    compose.onNodeWithText(s.partyA).assertDoesNotExist()
                    compose.onNodeWithText(s.partyB).assertDoesNotExist()
                }
                resetContent()
            }
        }
    }

    @Test
    fun verdictCard_confidenceIsTheJudgesAgreement_notTheStoredScore() {
        val en = UiTestSupport.s(AppLang.EN)
        val outcome = sample("win_b_named")
        val r = outcome.result.result.copy(confidence = 2, runs = listOf("side_b", "side_b", "side_a", "side_b", "side_b"), verdict = "side_b")
        compose.setContent {
            Themed(AppLang.EN) {
                RulingSummary(
                    view = TranslationView(r, TranslationStatus.ORIGINAL, AppLang.EN),
                    parties = PartyNames.partyNames(outcome.nameMap, AppLang.EN, en),
                    actions = CardActions(onShare = {}, onCopy = {}, copied = false),
                    onDetails = {},
                    reducedMotion = true,
                    modifier = Modifier.verticalScroll(rememberScrollState()),
                )
            }
        }
        compose.onNodeWithText("Confidence 4 of 5").assertExists()
        compose.onNodeWithText("Confidence 2 of 5").assertDoesNotExist()
        compose.onNodeWithText("2/5", substring = true).assertDoesNotExist()
    }

    @Test
    fun verdictCard_addContext_onlyWhenOffered() {
        val en = UiTestSupport.s(AppLang.EN)
        val outcome = sample("win_b_named")
        var offered by mutableStateOf(false)
        var taps = 0
        compose.setContent {
            Themed(AppLang.EN) {
                RulingSummary(
                    view = TranslationView(outcome.result.result, TranslationStatus.ORIGINAL, AppLang.EN),
                    parties = PartyNames.partyNames(outcome.nameMap, AppLang.EN, en),
                    actions = CardActions(onShare = {}, onCopy = {}, copied = false, onAddContext = if (offered) ({ taps++ }) else null),
                    onDetails = {},
                    reducedMotion = true,
                    modifier = Modifier.verticalScroll(rememberScrollState()),
                )
            }
        }
        compose.onNodeWithTag(VerdictTags.ADD_CONTEXT).assertDoesNotExist()
        compose.onNodeWithText(en.copyLink).assertExists()
        offered = true
        compose.onNodeWithTag(VerdictTags.ADD_CONTEXT).assertTextEquals(en.appAppealTitle).performClick()
        assertEquals(1, taps)
        compose.onNodeWithText(en.copyLink).assertDoesNotExist()
    }

    @Test
    fun verdictCard_namesTheLosersBestPoint_andTheBedrockSides() {
        val outcome = sample("win_b_named")
        val r = outcome.result.result
        val s = UiTestSupport.s(AppLang.EN)
        val parties = PartyNames.partyNames(outcome.nameMap, ContentLang.verdictLang(r), s)
        compose.setContent { Themed(AppLang.EN) { SampleVerdict(outcome, AppLang.EN, modifier = Modifier.verticalScroll(rememberScrollState())) } }
        compose.onNodeWithText(if (parties.aIsSelf) s.bestPointSelf else s.bestPointOf(parties.nameA)).assertExists()
        compose.onNodeWithText(s.cruxShort).assertExists()
        compose.onNodeWithText(s.appVerdictSides).assertExists()
        compose.onNodeWithText(s.share).assertExists()
        compose.onNodeWithText(s.copyLink).assertExists()
    }

    @Test
    fun rulingSummary_leansTowardTheWinner_andItsRowsOpenTheDetails() {
        val en = UiTestSupport.s(AppLang.EN)
        val outcome = sample("win_b_named")
        val r = outcome.result.result
        val parties = PartyNames.partyNames(outcome.nameMap, ContentLang.verdictLang(r), en)
        var opened = 0
        compose.setContent {
            Themed(AppLang.EN) {
                RulingSummary(
                    view = TranslationView(r, TranslationStatus.ORIGINAL, AppLang.EN),
                    parties = parties,
                    actions = CardActions(onShare = {}, onCopy = {}, copied = false),
                    onDetails = { opened++ },
                    reducedMotion = true,
                    modifier = Modifier.verticalScroll(rememberScrollState()),
                )
            }
        }
        compose.onNodeWithTag(VerdictTags.LEAN).assertContentDescriptionEquals(en.appVerdictLeanTo(parties.nameB))
        compose.onNodeWithText(en.appVerdictVs).assertExists()
        compose.onNodeWithTag(VerdictTags.CRUX_ROW).performClick()
        compose.onNodeWithTag(VerdictTags.SIDES_ROW).performClick()
        compose.onNodeWithTag(VerdictTags.BEST_ROW).assertTextEquals(if (parties.aIsSelf) en.bestPointSelf else en.bestPointOf(parties.nameA)).performClick()
        assertEquals(3, opened)
        // The crux itself waits for the details.
        compose.onNodeWithText(r.crux).assertDoesNotExist()
    }

    @Test
    fun rulingSummary_saysWhoWonEachPointOfASplit() {
        val en = UiTestSupport.s(AppLang.EN)
        val outcome = sample("split")
        val r = outcome.result.result
        val parties = PartyNames.partyNames(outcome.nameMap, ContentLang.verdictLang(r), en)
        compose.setContent {
            Themed(AppLang.EN) { SampleVerdict(outcome, AppLang.EN, Modifier.verticalScroll(rememberScrollState()), summary = true) }
        }
        val first = r.splitPoints!!.first()
        val lead = if (first.party == "a") {
            if (parties.aIsSelf) en.splitWinSelf else en.splitWin(parties.nameA)
        } else {
            if (parties.bIsSelf) en.splitWinSelf else en.splitWin(parties.nameB)
        }
        assertTrue(compose.onAllNodesWithText(lead, substring = true).fetchSemanticsNodes().isNotEmpty())
    }

    @Test
    fun rulingSummary_refusal_hasNoLeanAndNoRows() {
        val outcome = sample("win_b_named")
        val r = outcome.result.result.copy(modelRefused = true)
        compose.setContent {
            Themed(AppLang.EN) {
                RulingSummary(
                    view = TranslationView(r, TranslationStatus.ORIGINAL, AppLang.EN),
                    parties = PartyNames.partyNames(outcome.nameMap, AppLang.EN, UiTestSupport.s(AppLang.EN)),
                    actions = CardActions(onShare = {}, onCopy = {}, copied = false),
                    onDetails = {},
                    reducedMotion = true,
                )
            }
        }
        compose.onNodeWithTag(VerdictTags.LEAN).assertDoesNotExist()
        compose.onNodeWithTag(VerdictTags.CRUX_ROW).assertDoesNotExist()
    }

    @Test
    fun judging_showsEachSideAboveTheScene() {
        val en = UiTestSupport.s(AppLang.EN)
        val sides = listOf(
            VerdictFlow.Side(mine = true, name = "", text = "A hot dog is its own thing."),
            VerdictFlow.Side(mine = false, name = "Sam", text = "Hot dogs are sandwiches."),
        )
        compose.setContent {
            Themed(AppLang.EN) {
                JudgingScreen(done = false, result = null, startedAt = 0, reducedMotion = true, onFinished = {}, onCancel = {}, sides = sides)
            }
        }
        compose.onNodeWithText("A hot dog is its own thing.").assertExists()
        compose.onNodeWithText(en.appHomeYourSide.uppercase(Locale.US)).assertExists()
        compose.onNodeWithText("SAM").assertExists()
        compose.onNodeWithTag(JudgingTags.BALANCE).assertExists()
        compose.onNodeWithTag(JudgingTags.CAPTION).assertExists()
    }

    @Test
    fun factCheck_emptyCheckedReadsAsNone_andOnlySafeSourcesShowByDomain() {
        val base = sample("win_b_named")
        fun with(check: FactCheck) = base.copy(result = base.result.copy(result = base.result.result.copy(factCheck = check)))
        val s = UiTestSupport.s(AppLang.EN)
        var outcome by mutableStateOf(with(FactCheck(status = "checked", claims = emptyList())))
        compose.setContent { Themed(AppLang.EN) { SampleVerdict(outcome, AppLang.EN, modifier = Modifier.verticalScroll(rememberScrollState())) } }
        compose.onNodeWithText(s.factcheckNone).assertExists()
        compose.onNodeWithText(s.factcheckLead).assertDoesNotExist()

        outcome = with(
            FactCheck(
                status = "checked",
                claims = listOf(
                    FactClaim(
                        claim = "Hot dogs are sandwiches.",
                        status = "mixed",
                        sources = listOf(
                            FactSource("Evil", "javascript:alert(1)"),
                            FactSource("Local file", "file:///sdcard/x"),
                            FactSource("Merriam-Webster", "https://www.merriam-webster.com/x"),
                            FactSource("Duplicate", "https://www.merriam-webster.com/x"),
                        ),
                    ),
                ),
            ),
        )
        compose.waitForIdle()
        compose.onNodeWithText(s.factcheckLead).assertExists()
        compose.onNodeWithContentDescription(s.appFactcheckSourceAria("Merriam-Webster")).assertExists()
        compose.onNodeWithContentDescription(s.appFactcheckSourceAria("Duplicate")).assertDoesNotExist()
        compose.onNodeWithContentDescription(s.appFactcheckSourceAria("Evil")).assertDoesNotExist()
        compose.onNodeWithContentDescription(s.appFactcheckSourceAria("Local file")).assertDoesNotExist()
    }

    @Test
    fun history_listsAndEmptyState() {
        var items by mutableStateOf<List<SavedVerdict>?>(emptyList())
        compose.setContent {
            Themed(AppLang.EN) {
                HistoryScreen(items = items, onOpen = {}, onDelete = {}, onDeleteAll = {}, onNew = {})
            }
        }
        compose.onNodeWithTag(HistoryTags.EMPTY).assertExists()
        items = listOf("win_a_self", "lean_tie").mapIndexed { i, n ->
            val o = sample(n)
            SavedVerdict(o.id, 1_760_000_000_000L + i, o.result, o.nameMap, emptyMap())
        }
        compose.waitForIdle()
        compose.onNodeWithTag(HistoryTags.row("abc123DEF0")).assertExists()
        compose.onNodeWithText("You're right").assertExists()
        // Row headlines carry the real names (display only).
        compose.onNodeWithText(personalized("win_a_self").str("headline")!!).assertExists()
        compose.onNodeWithText(personalized("lean_tie").str("headline")!!).assertExists()
        compose.onNodeWithText(UiTestSupport.s(AppLang.EN).appHistoryDeviceOnly).assertExists()
    }

    /** The web's personalized fields for a sample in its own language. */
    private fun personalized(name: String): JsonObject =
        Fixtures.list("verdicts").first { it.str("sample") == name }["personalized"]!!.jsonObject

    /** The crux the web shows for [name] in [lang]: personalized, from the translation when one is shown. */
    private fun personalizedCrux(name: String, outcome: VerdictOutcome, lang: AppLang): String {
        val view = sampleView(outcome, lang)
        val expected = if (view.status == TranslationStatus.TRANSLATED) {
            Fixtures.list("personalizedTranslations").first { it.str("sample") == name && it.str("lang") == lang.tag }
        } else {
            personalized(name)
        }
        return expected.str("crux")!!
    }

    // createComposeRule allows one setContent per test; swap the content through state instead.
    private var content by mutableStateOf<(@androidx.compose.runtime.Composable () -> Unit)?>(null)
    private var started = false

    private fun androidx.compose.ui.test.junit4.ComposeContentTestRule.setContentOnce(block: @androidx.compose.runtime.Composable () -> Unit) {
        content = block
        if (!started) {
            started = true
            setContent { content?.invoke() }
        }
        waitForIdle()
    }

    private fun resetContent() {
        content = null
        compose.waitForIdle()
    }
}
