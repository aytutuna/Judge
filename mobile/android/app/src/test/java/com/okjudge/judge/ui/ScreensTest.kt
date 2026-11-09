package com.okjudge.judge.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertContentDescriptionEquals
import androidx.compose.ui.test.assertHeightIsEqualTo
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsFocused
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertIsOff
import androidx.compose.ui.test.assertIsOn
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.assertWidthIsEqualTo
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import com.okjudge.judge.Fixtures
import com.okjudge.judge.ui.signin.SignInUiState
import com.okjudge.judge.ui.signin.SignInTags
import com.okjudge.judge.ui.signin.SignInScreen
import com.okjudge.judge.ui.signin.SignInMode
import com.okjudge.judge.ui.signin.SignInActions
import com.okjudge.judge.core.model.SignInProviders
import com.okjudge.judge.core.model.ServerConfig
import com.okjudge.judge.core.model.MeResponse
import com.okjudge.judge.core.auth.SignInError
import com.okjudge.judge.core.auth.Account
import com.okjudge.judge.i18n.LangPref
import com.okjudge.judge.core.display.ContentLang
import com.okjudge.judge.core.display.PartyNames
import com.okjudge.judge.core.display.UiError
import com.okjudge.judge.core.display.VerdictDisplay
import com.okjudge.judge.core.model.FactCheck
import com.okjudge.judge.core.model.FactClaim
import com.okjudge.judge.core.model.FactSource
import com.okjudge.judge.core.model.Features
import com.okjudge.judge.core.model.VerdictOutcome
import com.okjudge.judge.core.model.Viewer
import com.okjudge.judge.core.session.VerdictFlow
import com.okjudge.judge.i18n.AppLang
import com.okjudge.judge.str
import com.okjudge.judge.ui.components.LocalGamify
import com.okjudge.judge.ui.history.HistoryEntry
import com.okjudge.judge.ui.history.HistoryScreen
import com.okjudge.judge.ui.history.HistoryTags
import com.okjudge.judge.ui.home.HomeScreen
import com.okjudge.judge.ui.home.HomeTags
import com.okjudge.judge.ui.premium.EvidenceTags
import com.okjudge.judge.ui.home.HomeUiState
import com.okjudge.judge.ui.judging.JudgingScreen
import com.okjudge.judge.ui.judging.JudgingTags
import com.okjudge.judge.ui.settings.PasswordPanel
import com.okjudge.judge.ui.settings.SettingsScreen
import com.okjudge.judge.ui.settings.SettingsTags
import com.okjudge.judge.ui.verdict.CardActions
import com.okjudge.judge.ui.verdict.RulingSummary
import com.okjudge.judge.ui.verdict.TranslationStatus
import com.okjudge.judge.ui.verdict.TranslationView
import com.okjudge.judge.ui.verdict.VerdictTags
import java.util.Locale
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], qualifiers = "w400dp-h2400dp-xhdpi")
class ScreensTest {
    @get:Rule
    val compose = createComposeRule()

    private fun home(lang: AppLang, initial: HomeUiState = HomeUiState(), onSendLink: () -> Unit = {}, onAddContextSignIn: () -> Unit = {}) {
        compose.setContent {
            Themed(lang) {
                var state by remember { mutableStateOf(initial) }
                HomeScreen(
                    state = state,
                    onArgumentChange = { state = state.copy(argument = it) },
                    onSubmit = {},
                    onDismissError = { state = state.copy(error = null) },
                    onOtherSideChange = { state = state.copy(otherSide = it) },
                    onOtherName = { state = state.copy(otherName = it) },
                    onDisplayName = { state = state.copy(typedName = it) },
                    onSendLink = onSendLink,
                    onAddContextSignIn = onAddContextSignIn,
                    onAddTheirSide = { state = state.copy(theirsOpen = true) },
                    onRemoveTheirSide = { state = state.copy(theirsOpen = false, otherSide = "", otherName = "") },
                    onClear = { state = HomeUiState() },
                    onExample = { state = state.copy(argument = "Example", exampleText = HomeUiState.exampleMark("Example", "", "", ""), theirsOpen = true) },
                )
            }
        }
    }

    @Test
    fun home_disabledUntil20Chars_andCountsWhatIsSent() {
        home(AppLang.EN)
        val en = UiTestSupport.s(AppLang.EN)
        compose.onNodeWithTag(HomeTags.COUNTER).assertTextEquals("0 / 6,000")
        compose.onNodeWithTag(HomeTags.SUBMIT).assertIsNotEnabled()
        compose.onNodeWithTag(HomeTags.INPUT).performTextInput("nineteen characters")
        compose.onNodeWithTag(HomeTags.SUBMIT).assertIsNotEnabled()
        compose.onNodeWithTag(HomeTags.INPUT).performTextInput("!")
        compose.onNodeWithTag(HomeTags.SUBMIT).assertIsEnabled()
        compose.onNodeWithTag(HomeTags.COUNTER).assertTextEquals("20 / 6,000")
        compose.onNodeWithTag(HomeTags.ADD_THEIRS).performClick()
        compose.onNodeWithTag(HomeTags.NAME).performTextInput("Alex")
        compose.onNodeWithTag(HomeTags.OTHER).performTextInput("It is a sandwich.")
        val joined = HomeUiState.joined("nineteen characters!", "It is a sandwich.", "Alex", "", en)
        assertEquals("Alex says: nineteen characters!\n\nTheir side: It is a sandwich.", joined)
        compose.onNodeWithTag(HomeTags.COUNTER).assertTextEquals("${joined.length} / 6,000")
    }

    @Test
    fun home_bothSidesTogetherCanGoOverTheLimit() {
        val half = "x".repeat(3000)
        home(AppLang.EN, HomeUiState(argument = half, otherSide = half, theirsOpen = true))
        compose.onNodeWithTag(HomeTags.SUBMIT).assertIsNotEnabled()
        val sent = HomeUiState.joined(half, half, "", "", UiTestSupport.s(AppLang.EN)).length
        assertTrue(sent > 6000)
        compose.onNodeWithTag(HomeTags.COUNTER).assertTextEquals("${"%,d".format(sent)} / 6,000")
    }

    @Test
    fun home_tr_sideLabelsUppercaseWithTurkishRules() {
        home(AppLang.TR, HomeUiState(theirsOpen = true))
        // "Senin tarafın" must become "SENİN TARAFIN", not "SENIN TARAFIN".
        compose.onNodeWithText("SENİN TARAFIN").assertExists()
    }

    @Test
    fun home_tr_exampleLabelOnABlankForm() {
        home(AppLang.TR)
        compose.onNodeWithText(UiTestSupport.s(AppLang.TR).appHomeExample).assertExists()
    }

    @Test
    fun home_sendLink_isOpenFromTheStart_butNotForAShortSide_andGoesWithTheFirstCard() {
        var sent = 0
        home(AppLang.EN, HomeUiState(signedIn = true, features = Features(cases = true)), onSendLink = { sent++ })
        compose.onNodeWithTag(HomeTags.SEND_LINK).assertIsEnabled()
        compose.onNodeWithTag(HomeTags.INPUT).performTextInput("Too short")
        compose.onNodeWithTag(HomeTags.SEND_LINK).assertIsNotEnabled()
        compose.onNodeWithTag(HomeTags.INPUT).performTextInput(" for a link but not for long")
        compose.onNodeWithTag(HomeTags.SEND_LINK).assertIsEnabled().performClick()
        assertEquals(1, sent)
        compose.onNodeWithTag(HomeTags.ADD_THEIRS).performClick()
        compose.onNodeWithTag(HomeTags.SEND_LINK).assertDoesNotExist()
    }

    @Test
    fun home_sendLink_isThereSignedOut() {
        home(AppLang.EN, HomeUiState(features = Features(cases = true)))
        compose.onNodeWithTag(HomeTags.SEND_LINK).assertIsEnabled()
        compose.onNodeWithTag(HomeTags.ADD_THEIRS).assertExists()
    }

    @Test
    fun home_addContext_signedOutAsksForSignIn_andKeepsTheDraft() {
        var signIn = 0
        home(AppLang.EN, HomeUiState(features = Features(evidence = true)), onAddContextSignIn = { signIn++ })
        compose.onNodeWithTag(HomeTags.INPUT).performTextInput("What I wrote before signing in")
        compose.onNodeWithTag(EvidenceTags.ADD).assertExists().performClick()
        assertEquals(1, signIn)
        compose.onNodeWithTag(HomeTags.INPUT).assertTextContains("What I wrote before signing in")
    }

    @Test
    fun home_oneBoxUntilTheirSideIsAdded_andTheCloseButtonRemovesIt() {
        val en = UiTestSupport.s(AppLang.EN)
        home(AppLang.EN)
        compose.onNodeWithTag(HomeTags.OTHER).assertDoesNotExist()
        compose.onNodeWithTag(HomeTags.NAME).assertDoesNotExist()
        compose.onNodeWithTag(HomeTags.ADD_THEIRS).performClick()
        compose.onNodeWithTag(HomeTags.ADD_THEIRS).assertDoesNotExist()
        compose.onNodeWithTag(HomeTags.NAME).assertExists()
        compose.onNodeWithTag(HomeTags.OTHER).performTextInput("I did them on Sunday.")
        compose.onNodeWithContentDescription(en.appHomeRemoveTheirSide).performClick()
        compose.onNodeWithTag(HomeTags.OTHER).assertDoesNotExist()
        compose.onNodeWithTag(HomeTags.ADD_THEIRS).assertExists()
        compose.onNodeWithTag(HomeTags.COUNTER).assertTextEquals("0 / 6,000")
    }

    @Test
    fun home_addTheirSide_movesTheFocusToTheirBox() {
        home(AppLang.EN)
        compose.onNodeWithTag(HomeTags.ADD_THEIRS).performClick()
        compose.onNodeWithTag(HomeTags.OTHER).assertIsFocused()
    }

    @Test
    @Config(qualifiers = "w320dp-h2400dp-xhdpi")
    fun home_sendButtonKeepsItsSize_withLongLabelsAndBigText() {
        compose.setContent {
            val density = LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(density.density, fontScale = 2f)) {
                Themed(AppLang.DE) {
                    HomeScreen(HomeUiState(argument = "x".repeat(199)), onArgumentChange = {}, onSubmit = {}, onDismissError = {})
                }
            }
        }
        compose.onNodeWithTag(HomeTags.SUBMIT).assertWidthIsEqualTo(44.dp).assertHeightIsEqualTo(44.dp)
    }

    @Test
    fun home_clear_hiddenWhileBlank_clearsTheForm() {
        home(AppLang.EN)
        compose.onNodeWithTag(HomeTags.CLEAR).assertDoesNotExist()
        compose.onNodeWithTag(HomeTags.INPUT).performTextInput("My roommate never does the dishes")
        compose.onNodeWithTag(HomeTags.CLEAR).performClick()
        compose.onNodeWithTag(HomeTags.COUNTER).assertTextEquals("0 / 6,000")
        compose.onNodeWithTag(HomeTags.CLEAR).assertDoesNotExist()
    }

    @Test
    fun home_exampleIsOfferedOnlyOverAnEmptyFormOrAnExample() {
        home(AppLang.EN)
        compose.onNodeWithTag(HomeTags.EXAMPLE).assertExists().performClick()
        compose.onNodeWithTag(HomeTags.EXAMPLE).assertExists()
        compose.onNodeWithTag(HomeTags.INPUT).performTextInput(" and more")
        compose.onNodeWithTag(HomeTags.EXAMPLE).assertDoesNotExist()
    }

    @Test
    fun home_actionsAreDisabledWhileARequestIsOnItsWay() {
        home(AppLang.EN, HomeUiState(argument = "My roommate never does the dishes", creating = true))
        compose.onNodeWithTag(HomeTags.CLEAR).assertIsNotEnabled()
        compose.onNodeWithTag(HomeTags.ADD_THEIRS).assertIsNotEnabled()
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
        // The fixtures carry English and Turkish verdicts and translations.
        for (lang in listOf(AppLang.EN, AppLang.TR)) {
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

    private fun assertWhyUnderTheHeadline(lang: AppLang, summary: Boolean) {
        val outcome = sample("win_a_self")
        val shown = sampleView(outcome, lang).personalized(outcome.nameMap, ContentLang.verdictLang(outcome.result.result)).result
        compose.setContent {
            Themed(lang) { SampleVerdict(outcome, lang, Modifier.verticalScroll(rememberScrollState()), summary = summary) }
        }
        val why = compose.onNodeWithTag(VerdictTags.WHY)
        why.assertExists()
        compose.onNodeWithText(UiTestSupport.s(lang).why).assertExists()
        compose.onNodeWithText(shown.why!!).assertExists()
        val headline = compose.onNodeWithText(shown.headline).fetchSemanticsNode().boundsInRoot
        assertTrue(why.fetchSemanticsNode().boundsInRoot.top >= headline.bottom)
    }

    @Test
    fun rulingSummary_showsWhyUnderTheHeadline() = assertWhyUnderTheHeadline(AppLang.EN, summary = true)

    @Test
    fun rulingSummary_showsWhyInTurkish() = assertWhyUnderTheHeadline(AppLang.TR, summary = true)

    @Test
    fun verdictDetails_showWhyUnderTheHeadline() = assertWhyUnderTheHeadline(AppLang.EN, summary = false)

    @Test
    fun verdictCard_hidesWhyOnOlderVerdictsAndRefusals() {
        val outcome = sample("win_a_self")
        val r = outcome.result.result.copy(modelRefused = true)
        compose.setContent {
            Themed(AppLang.EN) {
                Column {
                    SampleVerdict(sample("win_b_named"), AppLang.EN, summary = true)
                    RulingSummary(
                        view = TranslationView(r, TranslationStatus.ORIGINAL, AppLang.EN),
                        parties = PartyNames.partyNames(outcome.nameMap, AppLang.EN, UiTestSupport.s(AppLang.EN)),
                        actions = CardActions(onShare = {}, onCopy = {}, copied = false),
                        onDetails = {},
                        reducedMotion = true,
                    )
                }
            }
        }
        compose.onNodeWithTag(VerdictTags.WHY).assertDoesNotExist()
        compose.onNodeWithText(UiTestSupport.s(AppLang.EN).why).assertDoesNotExist()
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
        compose.onNodeWithTag(JudgingTags.COURT).assertExists()
        compose.onNodeWithTag(JudgingTags.CAPTION).assertExists()
    }

    @Test
    fun judging_gamifyOffHasNoCourt_andStillFinishes() {
        var finished = false
        compose.mainClock.autoAdvance = false
        compose.setContent {
            Themed(AppLang.EN) {
                CompositionLocalProvider(LocalGamify provides false) {
                    JudgingScreen(done = true, result = null, startedAt = 0, reducedMotion = true, onFinished = { finished = true }, onCancel = {})
                }
            }
        }
        compose.onNodeWithTag(JudgingTags.COURT).assertDoesNotExist()
        compose.onNodeWithTag(JudgingTags.CAPTION).assertExists()
        compose.mainClock.advanceTimeBy(2_000)
        assertTrue(finished)
    }

    private fun bar(user: Viewer?, calls: MutableList<String>, gamify: Boolean = true, onGamify: (Boolean) -> Unit = {}, signedIn: Boolean = user != null) {
        compose.setContent {
            Themed(AppLang.EN) {
                PageBar(
                    "New", {}, {}, FocusRequester(), gamify = gamify, onGamify = onGamify,
                    account = AccountActions(
                        signedIn,
                        user,
                        onSettings = { calls += "settings" },
                        onPricing = { calls += "pricing" },
                        onSignIn = { calls += "signIn" },
                        onSignOut = { calls += "signOut" },
                    ),
                )
            }
        }
    }

    @Test
    fun pageBar_avatarMenuSignedOut() {
        val calls = mutableListOf<String>()
        bar(null, calls)
        compose.onNodeWithTag(PageBarTags.AVATAR).performClick()
        compose.onNodeWithTag(PageBarTags.SETTINGS).assertExists()
        compose.onNodeWithTag(PageBarTags.PRICING).assertExists()
        compose.onNodeWithTag(PageBarTags.SIGN_OUT).assertDoesNotExist()
        compose.onNodeWithTag(PageBarTags.SIGN_IN).performClick()
        assertEquals(listOf("signIn"), calls)
    }

    @Test
    fun pageBar_avatarMenuSignedIn() {
        val calls = mutableListOf<String>()
        bar(Viewer(id = "u1", email = "sam@example.com", name = "Sam"), calls)
        compose.onNodeWithText("S").assertExists()
        compose.onNodeWithTag(PageBarTags.AVATAR).performClick()
        compose.onNodeWithText("sam@example.com").assertExists()
        compose.onNodeWithTag(PageBarTags.SIGN_IN).assertDoesNotExist()
        compose.onNodeWithTag(PageBarTags.PRICING).performClick()
        compose.onNodeWithTag(PageBarTags.AVATAR).performClick()
        compose.onNodeWithTag(PageBarTags.SIGN_OUT).performClick()
        assertEquals(listOf("pricing", "signOut"), calls)
    }

    @Test
    fun pageBar_signedInWithoutProfileKeepsSignOut() {
        bar(null, mutableListOf(), signedIn = true)
        compose.onNodeWithTag(PageBarTags.AVATAR).performClick()
        compose.onNodeWithTag(PageBarTags.SIGN_IN).assertDoesNotExist()
        compose.onNodeWithTag(PageBarTags.SIGN_OUT).assertExists()
    }

    @Test
    fun pageBar_gamifyButtonShowsItsState() {
        var on by mutableStateOf(false)
        compose.setContent { Themed(AppLang.EN) { PageBar("New", {}, {}, FocusRequester(), gamify = on, onGamify = { on = it }) } }
        compose.onNodeWithTag(PageBarTags.GAMIFY).assertIsOff()
        compose.onNodeWithTag(PageBarTags.GAMIFY).performClick()
        assertTrue(on)
        compose.onNodeWithTag(PageBarTags.GAMIFY).assertIsOn()
    }

    @Test
    fun pageBar_initialFallsBackToEmail() {
        assertEquals("S", initialOf(Viewer("1", "a@b.c", " sam")))
        assertEquals("A", initialOf(Viewer("1", "a@b.c")))
    }

    @Test
    fun settings_gamifyRowToggles() {
        var on by mutableStateOf(true)
        compose.setContent {
            Themed(AppLang.EN) {
                SettingsScreen(LangPref.SYSTEM, "0.1.0", {}, {}, "https://okjudge.com", gamify = on, onGamify = { on = it })
            }
        }
        compose.onNodeWithTag(SettingsTags.GAMIFY).assertIsOn().performClick()
        assertFalse(on)
        compose.onNodeWithTag(SettingsTags.GAMIFY).assertIsOff()
    }

    private fun signedInWith(hasPassword: Boolean?) =
        Account.State.SignedIn(MeResponse(user = Viewer("u1", "ada@example.com"), hasPassword = hasPassword))

    @Test
    fun passwordPanel_changesThePassword() {
        val saved = mutableListOf<Pair<String, String?>>()
        compose.setContent {
            Themed(AppLang.EN) { PasswordPanel(hasPassword = true, onSave = { new, current -> saved += new to current; null }, onClose = {}) }
        }
        val s = UiTestSupport.s(AppLang.EN)
        compose.onNodeWithTag(SettingsTags.PASSWORD_CURRENT).performTextInput("old-made-up")
        compose.onNodeWithTag(SettingsTags.PASSWORD_NEW).performTextInput("short")
        compose.onNodeWithTag(SettingsTags.PASSWORD_SAVE).performClick()
        compose.onNodeWithTag(SettingsTags.PASSWORD_ERROR).assertTextEquals(s.signinPasswordShort)
        assertTrue(saved.isEmpty())

        compose.onNodeWithTag(SettingsTags.PASSWORD_NEW).performTextInput("-and-longer")
        compose.onNodeWithTag(SettingsTags.PASSWORD_SAVE).performClick()
        compose.onNodeWithTag(SettingsTags.PASSWORD_SAVED).assertTextEquals(s.accountPasswordSaved)
        assertEquals(listOf("short-and-longer" to "old-made-up"), saved)
    }

    @Test
    fun passwordPanel_changing_needsTheCurrentPasswordBeforeSaving() {
        val saved = mutableListOf<Pair<String, String?>>()
        compose.setContent {
            Themed(AppLang.EN) { PasswordPanel(hasPassword = true, onSave = { new, current -> saved += new to current; null }, onClose = {}) }
        }
        compose.onNodeWithTag(SettingsTags.PASSWORD_NEW).performTextInput("made-up-pass")
        compose.onNodeWithTag(SettingsTags.PASSWORD_SAVE).assertIsNotEnabled()
        assertTrue(saved.isEmpty())
    }

    @Test
    fun passwordPanel_firstPassword_doesNotAskForTheCurrentOne_andShowsTheServersAnswer() {
        compose.setContent {
            Themed(AppLang.EN) {
                PasswordPanel(hasPassword = false, onSave = { _, _ -> SignInError.CURRENT_PASSWORD_REQUIRED }, onClose = {})
            }
        }
        val s = UiTestSupport.s(AppLang.EN)
        compose.onNodeWithTag(SettingsTags.PASSWORD_CURRENT).assertDoesNotExist()
        compose.onNodeWithTag(SettingsTags.PASSWORD_NEW).performTextInput("made-up-pass")
        compose.onNodeWithTag(SettingsTags.PASSWORD_SAVE).performClick()
        compose.onNodeWithTag(SettingsTags.PASSWORD_ERROR).assertTextEquals(s.errorPasswordRequired)
    }

    @Test
    fun settings_passwordRow_followsWhatTheAccountHas() {
        var me by mutableStateOf(signedInWith(false))
        compose.setContent {
            Themed(AppLang.EN) {
                SettingsScreen(LangPref.SYSTEM, "0.1.0", {}, {}, "https://okjudge.com", account = me, onSetPassword = { _, _ -> null })
            }
        }
        val s = UiTestSupport.s(AppLang.EN)
        compose.onNodeWithTag(SettingsTags.PASSWORD).assertTextContains(s.accountPasswordSet, substring = true)
        me = signedInWith(true)
        compose.onNodeWithTag(SettingsTags.PASSWORD).assertTextContains(s.accountPasswordChange, substring = true)
    }

    @Test
    fun settings_passwordRow_waitsForTheServer() {
        compose.setContent {
            Themed(AppLang.EN) {
                SettingsScreen(LangPref.SYSTEM, "0.1.0", {}, {}, "https://okjudge.com", account = signedInWith(null), onSetPassword = { _, _ -> null })
            }
        }
        val s = UiTestSupport.s(AppLang.EN)
        compose.onNodeWithText(s.accountPasswordSet).assertDoesNotExist()
        compose.onNodeWithText(s.accountPasswordChange).assertDoesNotExist()
    }

    @Test
    fun signIn_passwordForm_hidesThePasswordWhenTyped_andSwitchesMode() {
        val modes = mutableListOf<SignInMode>()
        var signedIn = 0
        val providers = Account.Providers.Ready(ServerConfig(SignInProviders(emailCode = true, password = true)))
        compose.setContent {
            Themed(AppLang.EN) {
                SignInScreen(
                    SignInUiState(providers = providers, ageNeeded = false, email = "ada@example.com", password = "made-up-pass"),
                    onBack = {},
                    actions = SignInActions(onMode = { modes += it }, onSignInWithPassword = { signedIn++ }),
                )
            }
        }
        compose.onNodeWithTag(SignInTags.SUBMIT_PASSWORD).assertIsEnabled().performClick()
        assertEquals(1, signedIn)
        compose.onNodeWithTag(SignInTags.PASSWORD).assert(SemanticsMatcher.keyIsDefined(SemanticsProperties.Password))
        compose.onNodeWithTag(SignInTags.FORGOT).performClick()
        compose.onNodeWithTag(SignInTags.CREATE).performClick()
        compose.onNodeWithTag(SignInTags.USE_CODE).performClick()
        assertEquals(listOf(SignInMode.FORGOT, SignInMode.CREATE, SignInMode.CODE), modes)
    }

    @Test
    fun signIn_withoutPasswordsOnTheServer_showsOnlyTheCodeForm() {
        val providers = Account.Providers.Ready(ServerConfig(SignInProviders(emailCode = true)))
        compose.setContent {
            Themed(AppLang.EN) { SignInScreen(SignInUiState(providers = providers, ageNeeded = false), onBack = {}, actions = SignInActions()) }
        }
        compose.onNodeWithTag(SignInTags.REQUEST_CODE).assertExists()
        compose.onNodeWithTag(SignInTags.PASSWORD).assertDoesNotExist()
        compose.onNodeWithTag(SignInTags.USE_PASSWORD).assertDoesNotExist()
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
        var entries by mutableStateOf<List<HistoryEntry>?>(emptyList())
        compose.setContent {
            Themed(AppLang.EN) {
                HistoryScreen(entries = entries, onOpen = {}, onRemove = { _, _ -> })
            }
        }
        compose.onNodeWithTag(HistoryTags.EMPTY).assertExists()
        entries = phoneRows("win_a_self", "lean_tie")
        compose.waitForIdle()
        compose.onNodeWithTag(HistoryTags.row("v:abc123DEF0")).assertExists()
        compose.onNodeWithText("You're right").assertExists()
        // Row headlines carry the real names (display only).
        compose.onNodeWithText(personalized("win_a_self").str("headline")!!).assertExists()
        compose.onNodeWithText(personalized("lean_tie").str("headline")!!).assertExists()
        compose.onNodeWithText(UiTestSupport.s(AppLang.EN).appHistoryPhoneOnlyNote).assertExists()
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
