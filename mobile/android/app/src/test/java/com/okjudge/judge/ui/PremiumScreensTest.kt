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
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.assertTextEquals
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
import com.okjudge.judge.ui.components.TopBarTags
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
import com.okjudge.judge.ui.premium.StoreUi
import com.okjudge.judge.core.purchases.PurchaseController
import com.okjudge.judge.core.purchases.StoreOffer
import com.okjudge.judge.core.auth.Account
import com.okjudge.judge.i18n.PurchaseStrings
import com.okjudge.judge.i18n.LangPref
import com.okjudge.judge.ui.settings.RestoreUi
import com.okjudge.judge.ui.settings.SettingsScreen
import com.okjudge.judge.ui.settings.SettingsTags
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.performScrollTo
import androidx.test.core.app.ApplicationProvider
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
    fun home_balanceUnderTheButton_andTheCaseCost_onlyWhenSignedIn() {
        var state by mutableStateOf(premiumHome(EvidenceState(max = 3)))
        compose.setContent {
            Themed(AppLang.EN) { HomeScreen(state, {}, {}, {}, {}, {}, {}) }
        }
        compose.onNodeWithTag(HomeTags.BALANCE).assertTextEquals(en.appBalanceLeft(7))
        compose.onNodeWithTag(HomeTags.CASE_COST).assertTextEquals(en.appBalanceCaseCost)
        state = state.copy(entitlement = me("no_credits").entitlement)
        compose.onNodeWithTag(HomeTags.BALANCE).assertTextEquals(en.appBalanceNone)
        compose.onNodeWithTag(HomeTags.SUBMIT).assertIsEnabled()
        state = state.copy(entitlement = null)
        compose.onAllNodesWithTag(HomeTags.BALANCE).assertCountEquals(0)
        state = state.copy(signedIn = false, entitlement = me("credits7").entitlement)
        compose.onAllNodesWithTag(HomeTags.BALANCE).assertCountEquals(0)
        compose.onAllNodesWithTag(HomeTags.CASE_COST).assertCountEquals(0)
        compose.onAllNodesWithTag(EvidenceTags.ADD).assertCountEquals(0)
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
                    onNew = {},
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
        signedIn = true,
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
                HomeScreen(premiumHome(EvidenceState(items, max = 3)), {}, {}, {}, {}, {}, {}, onRemoveEvidence = { removed += it })
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
            Themed(AppLang.EN) { HomeScreen(premiumHome(EvidenceState(max = 3)).copy(checking = true), {}, {}, {}, {}, {}, {}) }
        }
        compose.onNodeWithTag(HomeTags.STATUS).assertTextContains(en.tierChecking)
        compose.onNodeWithTag(TopBarTags.NEW).assertDoesNotExist()
        compose.onNodeWithTag(HomeTags.SUBMIT).assertIsNotEnabled()
    }

    @Test
    fun pricing_noFreePlan_buyButtonsSayComingSoon_andWhatIsLeftShows() {
        compose.setContent {
            Themed(AppLang.EN) {
                PricingScreen(PricingInfo(), Features(true, true), signedIn = true, signInOffered = true, entitlement = me("subscriber").entitlement, onBack = {}, onSignIn = {}, onNew = {})
            }
        }
        compose.onAllNodesWithTag(PricingTags.BUY).assertCountEquals(3)
        compose.onAllNodesWithText(en.pricingComingSoon).assertCountEquals(3)
        compose.onNodeWithTag(PricingTags.STATUS).assertExists()
        compose.onNodeWithText(en.appPricingHeadline).assertExists()
        compose.onNodeWithText(en.appPricingSub).assertExists()
        compose.onAllNodesWithText(en.pricingFreeTitle).assertCountEquals(0)
        compose.onNodeWithText(en.appBalanceMonthly("23", me("subscriber").entitlement!!.subscription!!.cap.toString())).assertExists()
        compose.onNodeWithText(en.pricingPremiumF6).assertExists()
        compose.onNodeWithText("$7.50").assertExists()
        compose.onNodeWithText("1 premium verdict").assertExists()
        compose.onNodeWithText("35 premium verdicts a month").assertExists()
        compose.onAllNodesWithTag(PricingTags.SIGN_IN).assertCountEquals(0)
    }

    @Test
    fun pricing_signedOut_offersSignIn_andTheExtrasOnOffer() {
        compose.setContent {
            Themed(AppLang.EN) {
                androidx.compose.foundation.layout.Column {
                    PricingScreen(PricingInfo(purchasesEnabled = true), Features(true, true), false, true, null, null, {}, {}, store = StoreUi(available = true))
                }
            }
        }
        compose.onNodeWithTag(PricingTags.SIGN_IN).assertExists()
        compose.onAllNodesWithTag(PricingTags.STATUS).assertCountEquals(0)
        compose.onNodeWithText(en.pricingPremiumF6).assertExists()
        compose.onAllNodesWithText(en.pricingFreeF4).assertCountEquals(0)
        compose.onAllNodesWithTag(PricingTags.BUY).assertCountEquals(3)
        compose.onAllNodesWithText(en.pricingComingSoon).assertCountEquals(0)
    }

    private val ps: PurchaseStrings by lazy { PurchaseStrings.of(ApplicationProvider.getApplicationContext(), AppLang.EN) }

    private val storeOffers = mapOf(
        "pack_1" to StoreOffer("pack_1", "TRY 44.99", 44_990_000, "TRY"),
        "pack_10" to StoreOffer("pack_10", "TRY 329.99", 329_990_000, "TRY"),
        "monthly" to StoreOffer("monthly", "TRY 649.99", 649_990_000, "TRY"),
    )

    @Test
    fun pricing_noSdkKey_staysComingSoon_evenWithPurchasesOn() {
        compose.setContent {
            Themed(AppLang.EN) {
                PricingScreen(
                    PricingInfo(purchasesEnabled = true), Features(true, true), true, true, me("credits7").entitlement, null, {}, {},
                    store = StoreUi(available = false, offers = storeOffers),
                )
            }
        }
        compose.onAllNodesWithText(en.pricingComingSoon).assertCountEquals(3)
        compose.onAllNodesWithText("TRY 44.99").assertCountEquals(0)
        compose.onNodeWithText(en.pricingNote).assertExists()
    }

    @Test
    fun pricing_storeReady_showsStorePricesOnTheButtons_andBuysThatProduct() {
        val bought = mutableListOf<String>()
        compose.setContent {
            Themed(AppLang.EN) {
                PricingScreen(
                    PricingInfo(purchasesEnabled = true), Features(true, true), true, true, me("credits7").entitlement, null, {}, {},
                    store = StoreUi(available = true, offers = storeOffers),
                    onBuy = { bought += it },
                )
            }
        }
        compose.onAllNodesWithText(en.pricingComingSoon).assertCountEquals(0)
        // The price column and the button both carry the store's price.
        compose.onAllNodesWithText("TRY 44.99").assertCountEquals(2)
        compose.onAllNodesWithText("TRY 649.99").assertCountEquals(2)
        compose.onAllNodesWithText("$1.00").assertCountEquals(0)
        // The "prices in USD, payments not open" footnote goes once the store sells.
        compose.onAllNodesWithText(en.pricingNote).assertCountEquals(0)
        compose.onAllNodesWithTag(PricingTags.BUY)[0].assertIsEnabled().performClick()
        compose.onAllNodesWithTag(PricingTags.BUY)[2].performScrollTo().performClick()
        assertEquals(listOf("pack_1", "monthly"), bought)
        compose.onAllNodesWithTag(PricingTags.NOTICE).assertCountEquals(0)
    }

    @Test
    fun pricing_storeReady_butSignedOut_doesNotSell() {
        compose.setContent {
            Themed(AppLang.EN) {
                PricingScreen(
                    PricingInfo(purchasesEnabled = true), Features(true, true), false, true, null, null, {}, {},
                    store = StoreUi(available = true, offers = storeOffers),
                )
            }
        }
        compose.onAllNodesWithText("TRY 44.99").assertCountEquals(0)
        compose.onAllNodesWithTag(PricingTags.BUY)[0].assertIsNotEnabled()
    }

    @Test
    fun pricing_buying_showsTheSpinnerLabel_andHoldsTheOtherButtons() {
        compose.setContent {
            Themed(AppLang.EN) {
                PricingScreen(
                    PricingInfo(purchasesEnabled = true), Features(true, true), true, true, me("credits7").entitlement, null, {}, {},
                    store = StoreUi(available = true, offers = storeOffers, buying = "pack_10"),
                )
            }
        }
        compose.onNodeWithText(ps.buying).assertExists()
        compose.onAllNodesWithTag(PricingTags.BUY)[0].assertIsNotEnabled()
        compose.onAllNodesWithTag(PricingTags.BUY)[2].assertIsNotEnabled()
    }

    @Test
    fun pricing_notices_sayWhatHappened() {
        var store by mutableStateOf(StoreUi(available = true, offers = storeOffers, notice = PurchaseController.Notice.ARRIVING))
        compose.setContent {
            Themed(AppLang.EN) {
                PricingScreen(
                    PricingInfo(purchasesEnabled = true), Features(true, true), true, true, me("credits7").entitlement, null, {}, {},
                    store = store,
                )
            }
        }
        compose.onNodeWithText(ps.pending, substring = true).assertExists()
        store = store.copy(notice = PurchaseController.Notice.ARRIVED)
        compose.onNodeWithText(ps.success).assertExists()
        store = store.copy(notice = PurchaseController.Notice.SLOW)
        compose.onNodeWithText(ps.slow, substring = true).assertExists()
        store = store.copy(notice = PurchaseController.Notice.FAILED)
        compose.onNodeWithText(ps.failed).assertExists()
        store = store.copy(notice = null, subscriptionPending = true)
        compose.onNodeWithText(ps.pending).assertExists()
        store = store.copy(subscriptionPending = false)
        compose.onAllNodesWithTag(PricingTags.NOTICE).assertCountEquals(0)
    }

    @Test
    fun settings_restoreRow_showsWhenTheStoreIsReady_andReportsTheResult() {
        var restore by mutableStateOf<RestoreUi?>(null)
        var taps = 0
        compose.setContent {
            Themed(AppLang.EN) {
                SettingsScreen(
                    LangPref.SYSTEM, "0.1.0", {}, {}, {}, "https://okjudge.com",
                    account = Account.State.SignedIn(me("credits7")),
                    restore = restore,
                    onRestore = { taps++ },
                )
            }
        }
        compose.onAllNodesWithTag(SettingsTags.RESTORE).assertCountEquals(0)
        restore = RestoreUi()
        compose.onNodeWithTag(SettingsTags.RESTORE).assertTextContains(ps.restore).performClick()
        assertEquals(1, taps)
        restore = RestoreUi(working = true)
        compose.onNodeWithTag(SettingsTags.RESTORE).assertIsNotEnabled()
        restore = RestoreUi(notice = PurchaseController.RestoreNotice.DONE)
        compose.onNodeWithTag(SettingsTags.RESTORE_NOTE).assertTextContains(ps.restoreDone)
        restore = RestoreUi(notice = PurchaseController.RestoreNotice.NONE)
        compose.onNodeWithTag(SettingsTags.RESTORE_NOTE).assertTextContains(ps.restoreNone)
        restore = RestoreUi(notice = PurchaseController.RestoreNotice.FAILED)
        compose.onNodeWithTag(SettingsTags.RESTORE_NOTE).assertTextContains(ps.failed)
    }

    @Test
    fun purchaseStrings_followTheAppLanguage() {
        val tr = PurchaseStrings.of(ApplicationProvider.getApplicationContext(), AppLang.TR)
        assertEquals("Satın alımları geri yükle", tr.restore)
        assertEquals("Restore purchases", ps.restore)
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
        compose.onNodeWithText(en.premiumBadge).assertExists()
        compose.onNodeWithText(en.factcheckTitle).assertExists()
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
        compose.onNodeWithText(en.twoSidedAgreed).assertExists()
        compose.onNodeWithText(en.twoSidedDisputed).assertExists()
        compose.onNodeWithText(en.twoSidedDecisive.uppercase(Locale.US)).assertExists()
        compose.onNodeWithText(en.twoSidedFindingSelf).assertExists()
        compose.onNodeWithText(en.twoSidedFindingUnsettled).assertExists()
        compose.onNodeWithText(en.twoSidedWouldChange).assertExists()
        compose.onNodeWithText(en.evidenceUsed("0", "1"), substring = true).assertExists()
        compose.onNodeWithText(en.appealOutcomeOverturned).assertExists()
        compose.onNodeWithText(en.appealBy("Sam")).assertExists()
        compose.onNodeWithText("/5", substring = true).assertDoesNotExist()
    }

    @Test
    fun judging_helperFollowsTheCaseTier() {
        var premium by mutableStateOf(false)
        compose.setContent {
            Themed(AppLang.EN) {
                JudgingScreen(done = false, result = null, startedAt = 0, reducedMotion = true, onFinished = {}, onCancel = {}, premium = premium)
            }
        }
        compose.onNodeWithText(en.thinkingHelper).assertExists()
        compose.onNodeWithText(en.thinkingPremiumHelper).assertDoesNotExist()
        premium = true
        compose.waitForIdle()
        compose.onNodeWithText(en.thinkingPremiumHelper).assertExists()
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
