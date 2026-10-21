package com.okjudge.judge.ui

import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.assertIsNotSelected
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.unit.dp
import com.okjudge.judge.Fixtures
import com.okjudge.judge.core.evidence.EvidenceItem
import com.okjudge.judge.core.evidence.EvidenceState
import com.okjudge.judge.core.evidence.EvidenceStatus
import com.okjudge.judge.core.model.ClarifyResponse
import com.okjudge.judge.core.model.Features
import com.okjudge.judge.core.model.MeResponse
import com.okjudge.judge.core.model.PricingInfo
import com.okjudge.judge.core.model.VerdictOutcome
import com.okjudge.judge.core.model.WireJson
import com.okjudge.judge.core.premium.Tier
import com.okjudge.judge.core.premium.TierAvailability
import com.okjudge.judge.i18n.AppLang
import com.okjudge.judge.ui.home.HomeScreen
import com.okjudge.judge.ui.home.HomeTags
import com.okjudge.judge.ui.home.HomeUiState
import com.okjudge.judge.ui.judging.JudgingScreen
import com.okjudge.judge.ui.judging.JudgingTags
import com.okjudge.judge.ui.premium.ClarifyScreen
import com.okjudge.judge.ui.premium.ClarifyTags
import com.okjudge.judge.ui.premium.EvidenceTags
import com.okjudge.judge.ui.premium.PricingScreen
import com.okjudge.judge.ui.premium.PricingTags
import com.okjudge.judge.ui.premium.TierSwitch
import com.okjudge.judge.ui.premium.TierTags
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.util.Locale
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], qualifiers = "w400dp-h2400dp-xhdpi")
class PremiumScreensTest {
    @get:Rule
    val compose = createComposeRule()

    private val en = UiTestSupport.s(AppLang.EN)

    private fun me(name: String): MeResponse =
        WireJson.json.decodeFromString(MeResponse.serializer(), Fixtures.verdicts["me"]!!.jsonObject[name].toString())

    @Test
    fun tierSwitch_signedOut_premiumNudgesTowardSignIn_withoutSelecting() {
        val calls = mutableListOf<String>()
        compose.setContent {
            Themed(AppLang.EN) {
                TierSwitch(
                    availability = TierAvailability.SIGNED_OUT,
                    value = Tier.FREE,
                    entitlement = null,
                    disabled = false,
                    onChange = { calls += "change:$it" },
                    onPremiumIntent = { calls += "intent" },
                    onSignIn = { calls += "signIn" },
                    onPricing = { calls += "pricing" },
                )
            }
        }
        compose.onAllNodesWithTag(TierTags.NOTE).assertCountEquals(0)
        compose.onNodeWithTag(TierTags.PREMIUM).performClick()
        compose.onNodeWithTag(TierTags.PREMIUM).assertIsNotSelected()
        compose.onNodeWithTag(TierTags.FREE).assertIsSelected()
        compose.onNodeWithTag(TierTags.NOTE_LINK).assertTextContains(en.tierSignInToUse)
        compose.onNodeWithTag(TierTags.NOTE_LINK).performClick()
        assertEquals(listOf("intent", "signIn"), calls)
    }

    @Test
    fun tierSwitch_lockedFairUse_showsTheDateAndThePricingLink() {
        var pricing = 0
        compose.setContent {
            Themed(AppLang.EN) {
                TierSwitch(TierAvailability.LOCKED, Tier.FREE, me("fair_use").entitlement, false, {}, {}, {}, { pricing++ })
            }
        }
        compose.onNodeWithTag(TierTags.NOTE).assertExists()
        val date = com.okjudge.judge.core.display.Errors.formatDate(AppLang.EN, me("fair_use").entitlement!!.resetsAt)!!
        compose.onNodeWithText(en.tierFairUse(date), substring = true).assertExists()
        compose.onNodeWithTag(TierTags.NOTE_LINK).assertTextContains(en.tierGetPremium).performClick()
        assertEquals(1, pricing)
    }

    @Test
    fun tierSwitch_available_switchesAndCountsWhatIsLeft_butHoldsWhileDisabled() {
        var value by mutableStateOf(Tier.FREE)
        var disabled by mutableStateOf(false)
        compose.setContent {
            Themed(AppLang.EN) {
                TierSwitch(TierAvailability.AVAILABLE, value, me("credits7").entitlement, disabled, { value = it }, {}, {}, {})
            }
        }
        compose.onNodeWithText(en.tierFreeHint).assertExists()
        compose.onNodeWithTag(TierTags.PREMIUM).performClick()
        assertEquals(Tier.PREMIUM, value)
        compose.onNodeWithText(en.tierCreditsLeft(7), substring = true).assertExists()
        disabled = true
        compose.waitForIdle()
        compose.onNodeWithTag(TierTags.FREE).performClick()
        assertEquals("the choice holds while a request is prepared", Tier.PREMIUM, value)
    }

    @Test
    fun clarify_answersSubmitSkipAndBack() {
        val questions = WireJson.json.decodeFromString(
            ClarifyResponse.serializer(),
            Fixtures.verdicts["clarifyResponse"]!!.jsonObject["two_questions"].toString(),
        ).questions
        val events = mutableListOf<String>()
        compose.setContent {
            Themed(AppLang.EN) {
                var answers by remember { mutableStateOf(mapOf<String, String>()) }
                ClarifyScreen(
                    questions = questions,
                    answers = answers,
                    onAnswer = { id, v -> answers = answers + (id to v); events += "answer:$id=$v" },
                    onSubmit = { events += "submit" },
                    onSkip = { events += "skip" },
                    onBack = { events += "back" },
                    onToggleLang = {},
                )
            }
        }
        compose.onNodeWithText(en.clarifyTitle).assertExists()
        compose.onNodeWithText(questions[1].text).assertExists()
        compose.onNodeWithTag(ClarifyTags.answer(0)).performTextInput("x".repeat(520))
        compose.onNodeWithTag(ClarifyTags.SUBMIT).performClick()
        compose.onNodeWithTag(ClarifyTags.SKIP).performClick()
        compose.onNodeWithTag(ClarifyTags.BACK).performClick()
        assertEquals("answer:q1=" + "x".repeat(500), events.first())
        assertEquals(listOf("submit", "skip", "back"), events.drop(1))
    }

    private fun premiumHome(evidence: EvidenceState) = HomeUiState(
        argument = en.exampleHotdogText,
        tierChoice = Tier.PREMIUM,
        availability = TierAvailability.AVAILABLE,
        entitlement = me("credits7").entitlement,
        features = Features(cases = true, evidence = true),
        evidence = evidence,
    )

    @Test
    fun home_premiumWithEvidence_showsEachStatus_andWaitsForReading() {
        val items = listOf(
            EvidenceItem("ev1", 1, EvidenceStatus.OK, token = "t", preview = "Sam: it's a hot dog"),
            EvidenceItem("ev2", 2, EvidenceStatus.READING),
            EvidenceItem("ev3", 3, EvidenceStatus.UNREADABLE),
        )
        val removed = mutableListOf<String>()
        compose.setContent {
            Themed(AppLang.EN) {
                HomeScreen(premiumHome(EvidenceState(items, max = 3)), {}, {}, {}, {}, {}, {}, {}, onRemoveEvidence = { removed += it })
            }
        }
        compose.onNodeWithTag(EvidenceTags.status(1)).assertTextContains(en.evidenceOk)
        compose.onNodeWithTag(EvidenceTags.status(2)).assertTextContains(en.evidenceReading)
        compose.onNodeWithTag(EvidenceTags.status(3)).assertTextContains(en.evidenceStatusUnreadable)
        compose.onNodeWithTag(EvidenceTags.ADD).assertIsNotEnabled()
        compose.onNodeWithTag(HomeTags.SUBMIT).assertIsNotEnabled()
        compose.onNodeWithText(en.evidencePreview, substring = true).performClick()
        compose.onNodeWithText("Sam: it's a hot dog").assertExists()
        compose.onNodeWithTag(EvidenceTags.remove(3)).performClick()
        assertEquals(listOf("ev3"), removed)
    }

    @Test
    fun home_checking_showsTheStatusLine() {
        compose.setContent {
            Themed(AppLang.EN) { HomeScreen(premiumHome(EvidenceState(max = 3)).copy(checking = true), {}, {}, {}, {}, {}, {}, {}) }
        }
        compose.onNodeWithTag(HomeTags.STATUS).assertTextContains(en.tierChecking)
        compose.onNodeWithTag(HomeTags.SUBMIT).assertIsNotEnabled()
    }

    @Test
    fun pricing_buyButtonsSayComingSoon_andThePlanShows() {
        compose.setContent {
            Themed(AppLang.EN) {
                PricingScreen(PricingInfo(), true, Features(true, true), signedIn = true, signInOffered = true, entitlement = me("subscriber").entitlement, onBack = {}, onSignIn = {}, onToggleLang = {})
            }
        }
        compose.onAllNodesWithTag(PricingTags.BUY).assertCountEquals(3)
        compose.onAllNodesWithText(en.pricingComingSoon).assertCountEquals(3)
        compose.onNodeWithTag(PricingTags.STATUS).assertExists()
        compose.onNodeWithText("${en.accountPlan}: ${en.accountPlanPremium}").assertExists()
        compose.onNodeWithText(en.pricingPremiumF6).assertExists()
        compose.onNodeWithText("$1.99").assertExists()
        compose.onAllNodesWithTag(PricingTags.SIGN_IN).assertCountEquals(0)
    }

    @Test
    fun pricing_signedOut_offersSignIn_andHidesExtrasWhenPremiumIsOff() {
        compose.setContent {
            Themed(AppLang.EN) {
                androidx.compose.foundation.layout.Column {
                    PricingScreen(PricingInfo(purchasesEnabled = true), false, Features(true, true), false, true, null, null, {}, {})
                }
            }
        }
        compose.onAllNodesWithTag(PricingTags.SIGN_IN).assertCountEquals(0)
        compose.onAllNodesWithText(en.pricingPremiumF4).assertCountEquals(0)
        compose.onAllNodesWithTag(PricingTags.BUY).assertCountEquals(3)
        compose.onAllNodesWithText(en.pricingComingSoon).assertCountEquals(0)
    }

    private fun premiumOutcome(): VerdictOutcome =
        WireJson.decodeVerdictResponse(Fixtures.verdicts["premiumVerdictResponse"]!!.jsonObject["response"].toString())

    @Test
    fun premiumVerdict_showsBadgePanelAndFactCheck() {
        val outcome = premiumOutcome()
        compose.setContent {
            Themed(AppLang.EN) {
                SampleVerdict(outcome, AppLang.EN, Modifier.verticalScroll(rememberScrollState()).padding(16.dp))
            }
        }
        compose.onNodeWithText(en.premiumBadge.uppercase(Locale.US)).assertExists()
        compose.onNodeWithText(en.factcheckTitle.uppercase(Locale.US)).assertExists()
        compose.onNodeWithText(en.factcheckStatusSupported.uppercase(Locale.US)).assertExists()
        compose.onNodeWithText("example.com").assertExists()
        compose.onNodeWithText(en.panelPremium, substring = true).assertExists()
    }

    private fun caseVerdict(view: String): VerdictOutcome {
        val v = Fixtures.verdicts["cases"]!!.jsonObject["views"]!!.jsonObject[view]!!.jsonObject
        val verdicts = v["verdicts"]!! as kotlinx.serialization.json.JsonArray
        val last = verdicts.last().jsonObject
        return VerdictOutcome(
            id = last["id"]!!.jsonPrimitive.content,
            result = WireJson.decodeResult(last["result"]!!),
            nameMap = Fixtures.nameMap(v["names"]!!),
        )
    }

    @Test
    fun twoSidedVerdict_showsAgreedDisputedAndWhatWouldChangeIt() {
        val outcome = caseVerdict("appeal_overturned")
        compose.setContent {
            Themed(AppLang.EN) { SampleVerdict(outcome, AppLang.EN, Modifier.verticalScroll(rememberScrollState()).padding(16.dp)) }
        }
        compose.onNodeWithText(en.twoSidedBadge.uppercase(Locale.US)).assertExists()
        compose.onNodeWithText(en.twoSidedAgreed.uppercase(Locale.US)).assertExists()
        compose.onNodeWithText(en.twoSidedDisputed.uppercase(Locale.US)).assertExists()
        compose.onNodeWithText(en.twoSidedDecisive.uppercase(Locale.US)).assertExists()
        compose.onNodeWithText(en.twoSidedFindingSelf).assertExists()
        compose.onNodeWithText(en.twoSidedFindingUnsettled).assertExists()
        compose.onNodeWithText(en.twoSidedWouldChange.uppercase(Locale.US)).assertExists()
        compose.onNodeWithText(en.evidenceUsed("0", "1"), substring = true).assertExists()
        compose.onNodeWithText(en.appealOutcomeOverturned).assertExists()
        compose.onNodeWithText(en.appealBy("Sam")).assertExists()
        compose.onNodeWithText("${en.appealConfidence("4")} → 3/5").assertExists()
    }

    @Test
    fun judging_premium_showsTheWebCheckLine() {
        var done by mutableStateOf(false)
        compose.setContent {
            Themed(AppLang.EN) {
                JudgingScreen(done = done, result = null, startedAt = 0, reducedMotion = true, onFinished = {}, onCancel = {}, premium = true)
            }
        }
        compose.onNodeWithTag(JudgingTags.FACTCHECK).assertTextContains(en.thinkingFactcheck)
        compose.onNodeWithText(en.thinkingPremiumHelper).assertExists()
        done = true
        compose.waitForIdle()
        compose.onNodeWithTag(JudgingTags.FACTCHECK).assertTextContains(en.thinkingFactcheckDone)
    }
}
