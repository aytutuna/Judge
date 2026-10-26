package com.okjudge.judge.ui

import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.junit4.createComposeRule
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
import com.okjudge.judge.core.display.Preset
import com.okjudge.judge.core.display.UiError
import com.okjudge.judge.core.display.VerdictDisplay
import com.okjudge.judge.core.model.FactCheck
import com.okjudge.judge.core.model.FactClaim
import com.okjudge.judge.core.model.FactSource
import com.okjudge.judge.core.model.Features
import com.okjudge.judge.core.model.VerdictOutcome
import com.okjudge.judge.i18n.AppLang
import com.okjudge.judge.ui.history.HistoryScreen
import com.okjudge.judge.ui.history.HistoryTags
import com.okjudge.judge.ui.home.CaseMode
import com.okjudge.judge.ui.home.HomeScreen
import com.okjudge.judge.ui.home.HomeTags
import com.okjudge.judge.ui.home.HomeUiState
import com.okjudge.judge.ui.judging.JudgingScreen
import com.okjudge.judge.ui.judging.JudgingTags
import com.okjudge.judge.ui.verdict.TranslationStatus
import com.okjudge.judge.ui.verdict.VerdictThreadHead
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
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

    private fun home(lang: AppLang, initial: HomeUiState = HomeUiState()) {
        compose.setContent {
            Themed(lang) {
                var state by remember { mutableStateOf(initial) }
                HomeScreen(
                    state = state,
                    onArgumentChange = { state = state.copy(argument = it) },
                    onExample = { state = state.copy(argument = it) },
                    onPreset = { state = state.copy(preset = it) },
                    onSubmit = {},
                    onDismissError = { state = state.copy(error = null) },
                    onToggleLang = {},
                    onOpenPrivacy = {},
                )
            }
        }
    }

    @Test
    fun home_counter_disabledUntil20Chars_andChipFillsTheText() {
        home(AppLang.EN)
        val en = UiTestSupport.s(AppLang.EN)
        compose.onNodeWithTag(HomeTags.COUNTER).assertTextEquals("0 / 6,000")
        compose.onNodeWithTag(HomeTags.SUBMIT).assertIsNotEnabled()
        compose.onNodeWithTag(HomeTags.INPUT).performTextInput("nineteen characters")
        compose.onNodeWithTag(HomeTags.SUBMIT).assertIsNotEnabled()
        compose.onNodeWithTag(HomeTags.INPUT).performTextInput("!")
        compose.onNodeWithTag(HomeTags.SUBMIT).assertIsEnabled()
        compose.onNodeWithText(en.exampleHotdogLabel).performClick()
        compose.onNodeWithTag(HomeTags.COUNTER).assertTextEquals("${"%,d".format(en.exampleHotdogText.length)} / 6,000")
    }

    @Test
    fun home_tr_kickerUppercasesWithTurkishRules() {
        home(AppLang.TR)
        // "Yeni dava" must become "YENİ DAVA", not "YENI DAVA".
        compose.onNodeWithText("YENİ DAVA").assertExists()
        compose.onNodeWithText(UiTestSupport.s(AppLang.TR).homeTitle).assertExists()
    }

    @Test
    fun home_lensOpensThePresets() {
        home(AppLang.EN)
        val en = UiTestSupport.s(AppLang.EN)
        compose.onNodeWithText(en.presetOutcomesLabel).assertDoesNotExist()
        compose.onNodeWithTag(HomeTags.LENS).performClick()
        compose.onNodeWithText(en.presetOutcomesLabel).performClick()
        compose.onNodeWithText("· ${en.presetOutcomesLabel}").assertExists()
    }

    @Test
    fun home_sidesLinkTogglesTheCaseMode() {
        val en = UiTestSupport.s(AppLang.EN)
        var mode by mutableStateOf(CaseMode.NOW)
        compose.setContent {
            Themed(AppLang.EN) {
                HomeScreen(
                    HomeUiState(signedIn = true, features = Features(cases = true), caseMode = mode),
                    {}, {}, {}, {}, {}, {}, {},
                    onCaseMode = { mode = it },
                )
            }
        }
        compose.onNodeWithTag(HomeTags.SIDES).assertTextEquals(en.homeInvite).performClick()
        assertEquals(CaseMode.BOTH, mode)
        compose.onNodeWithTag(HomeTags.SIDES).assertTextEquals(en.homeOneSide)
        compose.onNodeWithText(en.caseCreate).assertExists()
        compose.onNodeWithText(en.exampleHotdogLabel).assertDoesNotExist()
    }

    @Test
    fun home_sidesLinkNeedsCases() {
        home(AppLang.EN)
        compose.onNodeWithTag(HomeTags.SIDES).assertDoesNotExist()
    }

    @Test
    fun home_recentRow_hiddenWhenEmpty_opensAVerdict() {
        val en = UiTestSupport.s(AppLang.EN)
        var recent by mutableStateOf(emptyList<SavedVerdict>())
        val opened = mutableListOf<String>()
        var all = 0
        compose.setContent {
            Themed(AppLang.EN) {
                HomeScreen(HomeUiState(recent = recent), {}, {}, {}, {}, {}, {}, {}, onOpenVerdict = { opened += it }, onAllVerdicts = { all++ })
            }
        }
        compose.onNodeWithTag(HomeTags.RECENT).assertDoesNotExist()
        compose.onNodeWithText(en.homeRecent.uppercase(Locale.US)).assertDoesNotExist()

        val o = sample("win_a_self")
        recent = listOf(SavedVerdict(o.id, System.currentTimeMillis(), o.result, o.nameMap, Preset.BALANCED.id, emptyMap()))
        compose.waitForIdle()
        compose.onNodeWithTag(HomeTags.RECENT).assertExists()
        compose.onNodeWithText(personalized("win_a_self").str("headline")!!).assertExists()
        compose.onNodeWithText(en.shellToday).assertExists()
        compose.onNodeWithTag(HomeTags.recent(o.id)).performClick()
        compose.onNodeWithText(en.homeAll).performClick()
        assertEquals(listOf(o.id), opened)
        assertEquals(1, all)
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
                // The ruling is read with the headline; the stamp is decorative.
                compose.onNodeWithContentDescription("${VerdictDisplay.verdictLabel(r, parties, s)}. ", substring = true).assertExists()
                // The fixture translation stands in for the original in the other language,
                // with real names restored as the web shows them.
                if (!r.refused) compose.onNodeWithText(personalizedCrux(name, outcome, lang)).assertExists()
                compose.onNodeWithText(s.confidenceAria(VerdictDisplay.confidenceLevel(r.confidence).toString())).assertExists()
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
    fun verdictCard_namesTheLosersBestPoint_andTheBedrockSides() {
        val outcome = sample("win_b_named")
        val r = outcome.result.result
        val s = UiTestSupport.s(AppLang.EN)
        val parties = PartyNames.partyNames(outcome.nameMap, ContentLang.verdictLang(r), s)
        compose.setContent { Themed(AppLang.EN) { SampleVerdict(outcome, AppLang.EN, modifier = Modifier.verticalScroll(rememberScrollState())) } }
        compose.onNodeWithText(if (parties.aIsSelf) s.bestPointSelf else s.bestPointOf(parties.nameA)).assertExists()
        compose.onNodeWithText(s.cruxShort).assertExists()
        compose.onNodeWithText(s.bedrock).assertExists()
        compose.onNodeWithText(s.share).assertExists()
        compose.onNodeWithText(s.copyLink).assertExists()
    }

    @Test
    fun verdictThread_showsTheArgumentAndHowFarTheJudgesAgreed() {
        val en = UiTestSupport.s(AppLang.EN)
        val r = sample("win_b_named").result.result
        compose.setContent { Themed(AppLang.EN) { VerdictThreadHead("Hot dogs are sandwiches, says Sam.", r, reducedMotion = true) } }
        compose.onNodeWithText("Hot dogs are sandwiches, says Sam.").assertExists()
        compose.onNodeWithText(VerdictDisplay.judgesLabel(r, en)).assertExists()
    }

    @Test
    fun judging_showsTheArgumentAboveTheScene() {
        val en = UiTestSupport.s(AppLang.EN)
        compose.setContent {
            Themed(AppLang.EN) {
                JudgingScreen(done = false, result = null, startedAt = 0, reducedMotion = true, onFinished = {}, onCancel = {}, argument = "Hot dogs are sandwiches, says Sam.")
            }
        }
        compose.onNodeWithText("Hot dogs are sandwiches, says Sam.").assertExists()
        compose.onNodeWithText(en.threadJudges).assertExists()
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
                HistoryScreen(items = items, onOpen = {}, onDelete = {}, onDeleteAll = {}, onToggleLang = {})
            }
        }
        compose.onNodeWithTag(HistoryTags.EMPTY).assertExists()
        items = listOf("win_a_self", "lean_tie").mapIndexed { i, n ->
            val o = sample(n)
            SavedVerdict(o.id, 1_760_000_000_000L + i, o.result, o.nameMap, Preset.BALANCED.id, emptyMap())
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
