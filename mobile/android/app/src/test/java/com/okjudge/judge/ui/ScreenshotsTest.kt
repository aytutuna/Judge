package com.okjudge.judge.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.dp
import com.github.takahirom.roborazzi.captureRoboImage
import com.okjudge.judge.Fixtures
import com.okjudge.judge.core.auth.Account
import com.okjudge.judge.core.auth.SignInError
import com.okjudge.judge.core.data.SavedVerdict
import com.okjudge.judge.core.display.UiError
import com.okjudge.judge.core.model.Entitlement
import com.okjudge.judge.core.model.MeResponse
import com.okjudge.judge.core.model.ServerConfig
import com.okjudge.judge.core.model.SignInProviders
import com.okjudge.judge.core.model.SubscriptionView
import com.okjudge.judge.core.model.Viewer
import com.okjudge.judge.i18n.AppLang
import com.okjudge.judge.i18n.LangPref
import com.okjudge.judge.ui.components.TopBar
import com.okjudge.judge.ui.history.HistoryScreen
import com.okjudge.judge.ui.home.HomeScreen
import com.okjudge.judge.ui.home.HomeUiState
import com.okjudge.judge.ui.judging.JudgingScreen
import com.okjudge.judge.ui.settings.SettingsScreen
import com.okjudge.judge.ui.theme.Palette
import com.okjudge.judge.ui.signin.SignInActions
import com.okjudge.judge.ui.signin.SignInScreen
import com.okjudge.judge.ui.signin.SignInStep
import com.okjudge.judge.ui.signin.SignInUiState
import com.okjudge.judge.ui.verdict.TranslationStatus
import com.okjudge.judge.core.evidence.EvidenceItem
import com.okjudge.judge.core.evidence.EvidenceState
import com.okjudge.judge.core.evidence.EvidenceStatus
import com.okjudge.judge.core.model.ClarifyResponse
import com.okjudge.judge.core.model.Features
import com.okjudge.judge.core.model.PricingInfo
import com.okjudge.judge.core.model.VerdictOutcome
import com.okjudge.judge.core.model.WireJson
import com.okjudge.judge.ui.premium.ClarifyScreen
import com.okjudge.judge.ui.premium.PricingScreen
import com.okjudge.judge.ui.premium.StoreUi
import com.okjudge.judge.core.purchases.PurchaseController
import com.okjudge.judge.core.purchases.StoreOffer
import com.okjudge.judge.core.session.VerdictFlow
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertFalse
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Screenshots for visual review against the web. They are written only in
 * Roborazzi record mode:
 * gradlew recordRoborazziDebug --tests "*ScreenshotsTest*" -Pjudge.shotsDir=<dir>
 * Under a plain test run they still render every screen (a smoke test).
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [36], qualifiers = "w393dp-h852dp-xxhdpi")
class ScreenshotsTest {
    @get:Rule
    val compose = createComposeRule()

    private fun capture(name: String, tall: Boolean = false, content: @Composable () -> Unit) {
        if (tall) RuntimeEnvironment.setQualifiers("+w393dp-h2900dp")
        compose.mainClock.autoAdvance = false
        compose.setContent(content)
        compose.mainClock.advanceTimeBy(5_000)
        compose.onRoot().captureRoboImage(UiTestSupport.shot(name))
    }

    private fun homeState(lang: AppLang) = HomeUiState(
        argument = UiTestSupport.s(lang).exampleHotdogText,
    )

    @Test
    fun home_en() = capture("home_en") {
        Themed(AppLang.EN) { HomeScreen(HomeUiState(), {}, {}, {}, {}) }
    }

    @Test
    fun home_tr_filled_withError() = capture("home_tr_error", tall = true) {
        Themed(AppLang.TR) {
            HomeScreen(homeState(AppLang.TR).copy(error = UiError.Api("rate_limited", 429, 420.0)), {}, {}, {}, {})
        }
    }

    @Test
    fun judging_waiting() = capture("judging_waiting_en") {
        Themed(AppLang.EN) {
            JudgingScreen(
                done = false, result = null, startedAt = System.currentTimeMillis() - 4_000, reducedMotion = true, onFinished = {}, onCancel = {},
                sides = listOf(
                    VerdictFlow.Side(mine = true, name = "Alex", text = "A hot dog is its own thing. Nobody orders a sandwich and expects one."),
                    VerdictFlow.Side(mine = false, name = "Sam", text = "It's a filling inside sliced bread. That's a sandwich, end of story."),
                ),
                onNew = {},
            )
        }
    }

    @Test
    fun judging_final_tipsTowardTheWinner() = capture("judging_final_win_b_tr") {
        Themed(AppLang.TR) {
            JudgingScreen(
                done = true, result = sample("win_b_named").result.result, startedAt = 0, reducedMotion = true, onFinished = {}, onCancel = {},
                sides = listOf(VerdictFlow.Side(mine = true, name = "", text = UiTestSupport.s(AppLang.TR).exampleHotdogText)),
                onNew = {},
            )
        }
    }

    @Test
    fun verdict_ruling_en() = capture("verdict_ruling_win_b_en") {
        Themed(AppLang.EN) {
            Column(Modifier.fillMaxSize()) {
                TopBar(onBack = null, onNew = {})
                SampleVerdict(sample("win_b_named"), AppLang.EN, Modifier.padding(horizontal = 16.dp, vertical = 4.dp), summary = true)
            }
        }
    }

    @Test
    fun verdict_ruling_tooClose_tr() = capture("verdict_ruling_too_close_tr") {
        Themed(AppLang.TR) {
            Column(Modifier.fillMaxSize()) {
                TopBar(onBack = null, onNew = {})
                SampleVerdict(sample("lean_tie"), AppLang.TR, Modifier.padding(horizontal = 16.dp, vertical = 4.dp), summary = true)
            }
        }
    }

    @Test
    fun verdicts_en() {
        for (name in Fixtures.sampleNames) renderVerdict("verdict_${name}_en", name, AppLang.EN)
    }

    @Test
    fun verdict_win_a_self_tr() = renderVerdict("verdict_win_a_self_tr", "win_a_self", AppLang.TR)

    @Test
    fun verdict_overturned_tr_tr() = renderVerdict("verdict_overturned_tr_tr", "overturned_tr", AppLang.TR)

    @Test
    fun verdict_lean_translating_tr() =
        renderVerdict("verdict_lean_loading_tr", "lean_b_majority_escalated", AppLang.TR, TranslationStatus.LOADING)

    private var verdictStarted = false
    private val current = androidx.compose.runtime.mutableStateOf<(@Composable () -> Unit)?>(null)

    private fun renderVerdict(file: String, name: String, lang: AppLang, status: TranslationStatus = TranslationStatus.ORIGINAL) {
        val outcome = sample(name)
        val content: @Composable () -> Unit = {
            Themed(lang) {
                Column(Modifier.fillMaxSize()) {
                    TopBar(onBack = {}, onNew = {}, backText = UiTestSupport.s(lang).appVerdictBack)
                    SampleVerdict(outcome, lang, Modifier.padding(horizontal = 16.dp, vertical = 4.dp), status)
                }
            }
        }
        if (verdictStarted) {
            compose.runOnUiThread { current.value = content }
            androidx.compose.runtime.snapshots.Snapshot.sendApplyNotifications()
        } else {
            current.value = content
        }
        if (!verdictStarted) {
            verdictStarted = true
            RuntimeEnvironment.setQualifiers("+w393dp-h2900dp")
            compose.mainClock.autoAdvance = false
            compose.setContent { current.value?.invoke() }
        }
        compose.mainClock.advanceTimeBy(2_000)
        compose.onRoot().captureRoboImage(UiTestSupport.shot(file))
    }

    @Test
    fun history_en() = capture("history_en") {
        val items = listOf("win_a_self", "win_b_named", "lean_tie", "overturned_tr", "conditional").mapIndexed { i, n ->
            val o = sample(n)
            SavedVerdict(o.id, 1_760_900_000_000L - i * 86_400_000L, o.result, o.nameMap, emptyMap())
        }
        Themed(AppLang.EN) { HistoryScreen(items, {}, {}, {}, {}) }
    }

    @Test
    fun settings_tr() = capture("settings_tr") {
        Themed(AppLang.TR) { SettingsScreen(LangPref.SYSTEM, "0.1.0", {}, {}, {}, "https://okjudge.com") }
    }

    @Test
    fun settings_signedIn_en() = capture("settings_signed_in_en", tall = true) {
        val me = MeResponse(
            user = Viewer(id = "u1", email = "ada@example.com", name = "Ada"),
            entitlement = Entitlement(
                canUsePremium = true,
                credits = 3,
                subscription = SubscriptionView(periodEnd = "2026-11-18T12:00:00.000Z", willRenew = true, used = 12, cap = 100),
            ),
        )
        Themed(AppLang.EN) {
            SettingsScreen(LangPref.SYSTEM, "0.1.0", {}, {}, {}, "https://okjudge.com", account = Account.State.SignedIn(me))
        }
    }

    private val bothProviders = Account.Providers.Ready(ServerConfig(SignInProviders(apple = true, google = true, email = true, emailCode = true)))

    @Test
    fun signin_en() = capture("signin_en") {
        Themed(AppLang.EN) { SignInScreen(SignInUiState(providers = bothProviders), onBack = {}, onNew = {}, actions = SignInActions()) }
    }

    @Test
    fun signin_tr() = capture("signin_tr") {
        Themed(AppLang.TR) { SignInScreen(SignInUiState(providers = bothProviders), onBack = {}, onNew = {}, actions = SignInActions()) }
    }

    @Test
    fun signin_code_en() = capture("signin_code_en") {
        val state = SignInUiState(
            providers = bothProviders,
            step = SignInStep.CODE,
            email = "ada@example.com",
            code = "482913",
            error = SignInError.CODE_INVALID,
        )
        Themed(AppLang.EN) { SignInScreen(state, onBack = {}, onNew = {}, actions = SignInActions()) }
    }

    // --- Premium ---------------------------------------------------------------------

    private fun me(name: String): MeResponse =
        WireJson.json.decodeFromString(MeResponse.serializer(), Fixtures.verdicts["me"]!!.jsonObject[name].toString())

    private fun premiumHome(lang: AppLang, meName: String, evidence: EvidenceState = EvidenceState(max = 3)) =
        homeState(lang).copy(
            signedIn = true,
            entitlement = me(meName).entitlement,
            features = Features(cases = true, evidence = true),
            evidence = evidence,
        )

    @Test
    fun home_noVerdictsLeft_en() = capture("home_balance_none_en", tall = true) {
        Themed(AppLang.EN) { HomeScreen(premiumHome(AppLang.EN, "fair_use"), {}, {}, {}, {}) }
    }

    @Test
    fun home_monthlyLeft_en() = capture("home_balance_monthly_en", tall = true) {
        Themed(AppLang.EN) {
            HomeScreen(premiumHome(AppLang.EN, "subscriber").copy(features = Features()), {}, {}, {}, {})
        }
    }

    @Test
    fun evidence_mixedStatuses_en() = capture("evidence_mixed_en", tall = true) {
        val thumb = android.graphics.Bitmap.createBitmap(96, 160, android.graphics.Bitmap.Config.ARGB_8888).apply {
            eraseColor(android.graphics.Color.rgb(0xDD, 0xE7, 0xE0))
        }
        val items = listOf(
            EvidenceItem("ev1", 1, EvidenceStatus.OK, token = "t1", preview = "Sam: it's a hot dog, not a sandwich", thumb = thumb),
            EvidenceItem("ev2", 2, EvidenceStatus.READING),
            EvidenceItem("ev3", 3, EvidenceStatus.UNREADABLE),
        )
        Themed(AppLang.EN) {
            HomeScreen(premiumHome(AppLang.EN, "credits7", EvidenceState(items, max = 3)), {}, {}, {}, {})
        }
    }

    @Test
    fun clarify_en() = capture("clarify_en") {
        val questions = WireJson.json.decodeFromString(
            ClarifyResponse.serializer(),
            Fixtures.verdicts["clarifyResponse"]!!.jsonObject["two_questions"].toString(),
        ).questions
        Themed(AppLang.EN) {
            ClarifyScreen(questions, mapOf("q1" to "No, we never settled it."), { _, _ -> }, {}, {}, {}, {})
        }
    }

    @Test
    fun pricing_en() = capture("pricing_en", tall = true) {
        Themed(AppLang.EN) {
            PricingScreen(PricingInfo(), Features(true, true), true, true, me("credits7").entitlement, {}, {}, {})
        }
    }

    @Test
    fun pricing_tr() = capture("pricing_tr", tall = true) {
        Themed(AppLang.TR) {
            PricingScreen(PricingInfo(), Features(true, true), false, true, null, null, {}, {})
        }
    }

    /** Purchases on: the store's own prices on the buttons, a pack being bought, and the arriving line. */
    private fun storeUi(notice: PurchaseController.Notice?, buying: String?) = StoreUi(
        available = true,
        offers = mapOf(
            "pack_1" to StoreOffer("pack_1", "₺44,99", 44_990_000, "TRY"),
            "pack_10" to StoreOffer("pack_10", "₺329,99", 329_990_000, "TRY"),
            "monthly" to StoreOffer("monthly", "₺649,99", 649_990_000, "TRY"),
        ),
        buying = buying,
        notice = notice,
    )

    @Test
    fun pricing_store_tr() = capture("pricing_store_tr", tall = true) {
        Themed(AppLang.TR) {
            PricingScreen(
                PricingInfo(purchasesEnabled = true), Features(true, true), true, true, me("credits7").entitlement, {}, {}, {},
                store = storeUi(notice = PurchaseController.Notice.ARRIVING, buying = null),
            )
        }
    }

    @Test
    fun pricing_store_buying_en() = capture("pricing_store_buying_en", tall = true) {
        Themed(AppLang.EN) {
            PricingScreen(
                PricingInfo(purchasesEnabled = true), Features(true, true), true, true, me("credits7").entitlement, {}, {}, {},
                store = storeUi(notice = null, buying = "pack_10"),
            )
        }
    }

    @Test
    fun judging_premium_en() = capture("judging_premium_en") {
        Themed(AppLang.EN) {
            JudgingScreen(done = false, result = null, startedAt = System.currentTimeMillis() - 8_000, reducedMotion = true, onFinished = {}, onCancel = {}, premium = true, onNew = {})
        }
    }

    private fun premiumOutcome(): VerdictOutcome =
        WireJson.decodeVerdictResponse(Fixtures.verdicts["premiumVerdictResponse"]!!.jsonObject["response"].toString())

    private fun caseOutcome(view: String): VerdictOutcome {
        val v = Fixtures.verdicts["cases"]!!.jsonObject["views"]!!.jsonObject[view]!!.jsonObject
        val last = v["verdicts"]!!.jsonArray.last().jsonObject
        return VerdictOutcome(last["id"]!!.jsonPrimitive.content, WireJson.decodeResult(last["result"]!!), Fixtures.nameMap(v["names"]!!))
    }

    private fun shotVerdict(name: String, outcome: VerdictOutcome, lang: AppLang) = capture(name, tall = true) {
        Themed(lang) {
            Column(Modifier.fillMaxSize()) {
                TopBar(onBack = {}, onNew = {}, backText = UiTestSupport.s(lang).appVerdictBack)
                SampleVerdict(outcome, lang, Modifier.padding(horizontal = 16.dp, vertical = 12.dp))
            }
        }
    }

    @Test
    fun verdict_premiumFactCheck_en() = shotVerdict("verdict_premium_en", premiumOutcome(), AppLang.EN)

    @Test
    fun verdict_premiumFactCheck_tr() = shotVerdict("verdict_premium_tr", premiumOutcome(), AppLang.TR)

    @Test
    fun verdict_twoSided_en() = shotVerdict("verdict_two_sided_en", caseOutcome("judged"), AppLang.EN)

    @Test
    fun verdict_appealOutcome_en() = shotVerdict("verdict_appeal_overturned_en", caseOutcome("appeal_overturned"), AppLang.EN)

    /** The writer's ruling with "Add context & appeal" next to Share, and the sheet it opens (drawn in place). */
    private fun shotAddContext(name: String, area: com.okjudge.judge.core.cases.AppealArea, text: String = "") = capture(name, tall = true) {
        val outcome = sample("win_a_self")
        val en = UiTestSupport.s(AppLang.EN)
        Themed(AppLang.EN) {
            Column(Modifier.fillMaxSize()) {
                TopBar(onBack = {}, onNew = {})
                com.okjudge.judge.ui.verdict.RulingSummary(
                    view = sampleView(outcome, AppLang.EN).personalized(outcome.nameMap, AppLang.EN),
                    parties = com.okjudge.judge.core.display.PartyNames.partyNames(outcome.nameMap, AppLang.EN, en),
                    actions = com.okjudge.judge.ui.verdict.CardActions(onShare = {}, onCopy = {}, copied = false, onAddContext = {}),
                    onDetails = {},
                    reducedMotion = true,
                    modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 24.dp),
                )
                Box(Modifier.background(Palette.paper)) {
                    com.okjudge.judge.ui.cases.AppealPanel(
                        area = area,
                        draft = com.okjudge.judge.ui.cases.AppealDraft(text = text),
                        evidenceOn = true,
                        cost = en.appAppealCost("2"),
                        actions = com.okjudge.judge.ui.cases.AppealFormActions(),
                        onClose = {},
                    )
                }
            }
        }
    }

    @Test
    fun verdict_addContext_en() = shotAddContext(
        "verdict_add_context_en",
        com.okjudge.judge.core.cases.AppealArea.Form(null),
        "Sam paid me back the next week, so the money part is settled.",
    )

    @Test
    fun verdict_addContext_tr_narrowPhone() {
        RuntimeEnvironment.setQualifiers("+w360dp")
        val outcome = sample("win_a_self")
        val tr = UiTestSupport.s(AppLang.TR)
        capture("verdict_add_context_tr_360") {
            Themed(AppLang.TR) {
                com.okjudge.judge.ui.verdict.RulingSummary(
                    view = sampleView(outcome, AppLang.TR).personalized(outcome.nameMap, AppLang.EN),
                    parties = com.okjudge.judge.core.display.PartyNames.partyNames(outcome.nameMap, AppLang.EN, tr),
                    actions = com.okjudge.judge.ui.verdict.CardActions(onShare = {}, onCopy = {}, copied = false, onAddContext = {}),
                    onDetails = {},
                    reducedMotion = true,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
                )
            }
        }
        val layouts = mutableListOf<TextLayoutResult>()
        val label = compose.onNodeWithText(tr.appAppealTitle, useUnmergedTree = true).fetchSemanticsNode()
        label.config[SemanticsActions.GetTextLayoutResult].action!!(layouts)
        assertFalse("the label wraps instead of being cut", layouts.single().hasVisualOverflow)
    }

    @Test
    fun verdict_addContext_locked_en() =
        shotAddContext("verdict_add_context_locked_en", com.okjudge.judge.core.cases.AppealArea.Blocked("premium_required"))


    // --- Two-sided cases ---------------------------------------------------------------

    private fun caseState(name: String): com.okjudge.judge.ui.cases.CaseUiState {
        val v = WireJson.json.decodeFromString(
            com.okjudge.judge.core.model.CaseView.serializer(),
            Fixtures.verdicts["cases"]!!.jsonObject["views"]!!.jsonObject[name].toString(),
        )
        val base = com.okjudge.judge.ui.cases.CaseViewModel.preview(v)
        return if (v.statusRaw == "judging") base.copy(overlay = com.okjudge.judge.ui.cases.CaseOverlay(false)) else base
    }

    private fun shotCase(file: String, name: String, lang: AppLang = AppLang.EN, tall: Boolean = true) = capture(file, tall = tall) {
        Themed(lang) {
            com.okjudge.judge.ui.cases.CaseScreen(caseState(name), evidenceOn = true, actions = com.okjudge.judge.ui.cases.CaseActions(onBack = {}), reducedMotion = true)
        }
    }

    @Test
    fun case_awaiting_en() = shotCase("case_awaiting_en", "waiting_for_respondent")

    @Test
    fun case_judging_en() = shotCase("case_judging_en", "judging", tall = false)

    @Test
    fun case_judged_en() = shotCase("case_judged_en", "judged")

    @Test
    fun case_failed_en() = shotCase("case_failed_en", "failed")

    @Test
    fun case_expired_en() = shotCase("case_expired_en", "expired")

    @Test
    fun case_removed_en() = shotCase("case_removed_en", "removed")

    @Test
    fun case_judged_tr() = shotCase("case_judged_tr", "judged_tr", AppLang.TR)

    @Test
    fun case_awaiting_named_en() = capture("case_awaiting_named_en", tall = true) {
        Themed(AppLang.EN) {
            com.okjudge.judge.ui.cases.CaseScreen(
                caseState("waiting_for_respondent"),
                evidenceOn = true,
                actions = com.okjudge.judge.ui.cases.CaseActions(onBack = {}),
                reducedMotion = true,
                otherName = "Sam",
            )
        }
    }

    @Test
    fun history_cases_en() = capture("history_cases_en") {
        val list = WireJson.json.decodeFromString(
            com.okjudge.judge.core.model.CaseListResponse.serializer(),
            Fixtures.verdicts["cases"]!!.jsonObject["list"].toString(),
        )
        val items = listOf("win_a_self", "win_b_named", "lean_tie").mapIndexed { i, n ->
            val o = sample(n)
            SavedVerdict(o.id, 1_761_000_000_000L - i * 2 * 86_400_000L, o.result, o.nameMap, emptyMap())
        }
        Themed(AppLang.EN) {
            HistoryScreen(items, {}, {}, {}, {}, cases = com.okjudge.judge.ui.cases.CaseListState.Ready(list.cases))
        }
    }

    @Test
    fun case_judged_respondent_en() = capture("case_judged_respondent_en", tall = true) {
        val view = caseState("judged").view!!.copy(role = "respondent", yourParty = "b")
        Themed(AppLang.EN) {
            com.okjudge.judge.ui.cases.CaseScreen(
                com.okjudge.judge.ui.cases.CaseViewModel.preview(view),
                evidenceOn = true,
                actions = com.okjudge.judge.ui.cases.CaseActions(onBack = {}),
                reducedMotion = true,
            )
        }
    }

    @Test
    fun home_twoSides_en() = capture("home_two_sides_en", tall = true) {
        Themed(AppLang.EN) {
            HomeScreen(
                premiumHome(AppLang.EN, "credits7").copy(
                    argument = "A hot dog is its own thing. Nobody orders a sandwich and expects one, and no menu lists it under sandwiches.",
                    otherSide = "It's a filling inside sliced bread. That's a sandwich, end of story.",
                    suggestedName = "Alex",
                    otherName = "Sam",
                ),
                {}, {}, {}, {},
            )
        }
    }
}
