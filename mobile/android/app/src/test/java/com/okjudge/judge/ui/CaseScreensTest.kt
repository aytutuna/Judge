package com.okjudge.judge.ui

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertContentDescriptionEquals
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import com.okjudge.judge.Fixtures
import com.okjudge.judge.core.data.SavedVerdict
import com.okjudge.judge.core.display.Errors
import com.okjudge.judge.core.display.UiError
import com.okjudge.judge.core.model.AppealGate
import com.okjudge.judge.core.model.CaseListResponse
import com.okjudge.judge.core.model.CaseView
import com.okjudge.judge.core.model.WireJson
import com.okjudge.judge.i18n.AppLang
import com.okjudge.judge.ui.cases.CaseActions
import com.okjudge.judge.ui.cases.CaseListState
import com.okjudge.judge.ui.cases.CaseListTags
import com.okjudge.judge.ui.cases.CaseOverlay
import com.okjudge.judge.ui.cases.CaseScreen
import com.okjudge.judge.ui.cases.CaseTags
import com.okjudge.judge.ui.cases.CaseUiState
import com.okjudge.judge.ui.cases.CaseViewModel
import com.okjudge.judge.ui.history.HistoryScreen
import com.okjudge.judge.ui.history.HistoryTags
import com.okjudge.judge.ui.history.mergeHistory
import com.okjudge.judge.ui.premium.EvidenceTags
import com.okjudge.judge.ui.verdict.VerdictTags
import java.time.Instant
import java.util.Locale
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], qualifiers = "w400dp-h2600dp-xhdpi")
class CaseScreensTest {
    @get:Rule
    val compose = createComposeRule()

    private val en = UiTestSupport.s(AppLang.EN)

    private fun view(name: String): CaseView = WireJson.json.decodeFromString(
        CaseView.serializer(),
        Fixtures.verdicts["cases"]!!.jsonObject["views"]!!.jsonObject[name].toString(),
    )

    private fun stateOf(name: String): CaseUiState {
        val v = view(name)
        val base = CaseViewModel.preview(v)
        return if (v.statusRaw == "judging") base.copy(overlay = CaseOverlay(false)) else base
    }

    @Test
    fun everyFixtureView_renders_withItsStatus() {
        var state by mutableStateOf(stateOf("waiting_for_respondent"))
        compose.setContent { Themed(AppLang.EN) { CaseScreen(state, evidenceOn = true, actions = CaseActions(), reducedMotion = true) } }
        val names = Fixtures.verdicts["cases"]!!.jsonObject["views"]!!.jsonObject.keys
        assertEquals(15, names.size)
        for (name in names) {
            state = stateOf(name)
            compose.waitForIdle()
            val v = view(name)
            if (v.statusRaw == "awaiting_respondent") {
                compose.onNodeWithText(en.appCaseWaitingKicker.uppercase(Locale.US)).assertExists()
            } else {
                compose.onNodeWithTag(CaseTags.STATUS).assertTextContains(en.text(v.status.key)!!)
            }
            when (name) {
                "waiting_for_respondent" -> compose.onNodeWithText(en.appCaseStepThemAnon).assertExists()
                "respondent_answered" -> compose.onNodeWithText(en.caseAnswered).assertExists()
                "judging" -> compose.onNodeWithText(en.caseAnswered).assertExists()
                "failed" -> compose.onNodeWithTag(CaseTags.BANNER).assertTextContains(en.errorQuota)
                "expired" -> compose.onNodeWithTag(CaseTags.BANNER).assertTextContains(en.caseExpiredBody)
                "waiting_free" -> compose.onNodeWithText(en.appCaseStepThemAnon).assertExists()
                "removed" -> compose.onNodeWithTag(CaseTags.BANNER).assertTextContains(en.caseRemovedBanner)
                "judged_one_sided" -> compose.onNodeWithText(en.caseOneSided).assertExists()
                "appeal_judging" -> compose.onNodeWithTag(CaseTags.APPEAL_NOTE).assertTextContains(en.appealBusy)
                "appeal_upheld" -> compose.onNodeWithText(en.appealOutcomeUpheld).assertExists()
                "appeal_changed" -> compose.onNodeWithText(en.appealOutcomeChanged).assertExists()
                else -> Unit
            }
            if (v.statusRaw == "judged") {
                compose.onNodeWithTag(CaseTags.VERDICT).assertExists()
                if (v.verdicts.size > 1) compose.onNodeWithTag(CaseTags.HISTORY).assertExists()
            }
        }
    }

    @Test
    fun awaiting_copyShareResetAndJudgeNow_goThroughTheirConfirms() {
        val calls = mutableListOf<String>()
        val actions = CaseActions(
            onCopyInvite = { calls += "copy:$it" },
            onShareInvite = { calls += "share:$it" },
            onResetInvite = { calls += "reset" },
            onJudgeNow = { calls += "judgeNow" },
        )
        compose.setContent { Themed(AppLang.EN) { CaseScreen(stateOf("waiting_for_respondent"), true, actions, true) } }
        val url = view("waiting_for_respondent").inviteUrl!!
        compose.onNodeWithTag(CaseTags.INVITE_URL).assertContentDescriptionEquals(url)
        compose.onNodeWithTag(CaseTags.COPY).performClick()
        compose.onNodeWithText(en.caseInviteCopied).assertExists()
        compose.onNodeWithTag(CaseTags.SHARE).performClick()
        compose.onNodeWithTag(CaseTags.RESET).performClick()
        compose.onNodeWithText(en.caseInviteResetConfirm).assertExists()
        compose.onNodeWithTag(CaseTags.CONFIRM).performClick()
        compose.onNodeWithTag(CaseTags.JUDGE_NOW).performClick()
        compose.onNodeWithText(en.caseJudgeNowConfirm).assertExists()
        compose.onNodeWithTag(CaseTags.CONFIRM).performClick()
        assertEquals(listOf("copy:$url", "share:$url", "reset", "judgeNow"), calls)
    }

    @Test
    fun appealForm_waitsFor20Characters() {
        var state by mutableStateOf(stateOf("judged"))
        var sent = 0
        compose.setContent {
            Themed(AppLang.EN) {
                CaseScreen(state, false, CaseActions(onAppealText = { state = state.copy(appealText = it) }, onSubmitAppeal = { sent++ }), true)
            }
        }
        compose.onNodeWithTag(CaseTags.APPEAL_SUBMIT).assertDoesNotExist()
        compose.onNodeWithTag(VerdictTags.ADD_CONTEXT).performScrollTo().performClick()
        compose.onNodeWithTag(CaseTags.APPEAL_SUBMIT).assertIsNotEnabled()
        compose.onNodeWithText(en.appAppealCostCase).assertExists()
        state = state.copy(appealText = "x".repeat(19))
        compose.onNodeWithTag(CaseTags.APPEAL_SUBMIT).assertIsNotEnabled()
        state = state.copy(appealText = "x".repeat(20))
        compose.onNodeWithText("20 / 2000").assertExists()
        compose.onNodeWithTag(CaseTags.APPEAL_SUBMIT).assertIsEnabled().performClick()
        assertEquals(1, sent)
    }

    @Test
    fun appealForm_offersAScreenshot_onlyOnAPremiumCase() {
        var state by mutableStateOf(stateOf("judged"))
        compose.setContent { Themed(AppLang.EN) { CaseScreen(state, evidenceOn = true, actions = CaseActions(), reducedMotion = true) } }
        compose.onNodeWithTag(VerdictTags.ADD_CONTEXT).performScrollTo().performClick()
        compose.onNodeWithTag(CaseTags.APPEAL_SUBMIT).assertExists()
        compose.onAllNodesWithTag(EvidenceTags.ADD).assertCountEquals(1)
        state = stateOf("judged_free")
        compose.waitForIdle()
        compose.onNodeWithTag(CaseTags.APPEAL_SUBMIT).assertExists()
        compose.onAllNodesWithTag(EvidenceTags.ADD).assertCountEquals(0)
    }

    @Test
    fun appealBlocked_forTheOwner_saysWhy_andOffersPricing() {
        var pricing = 0
        compose.setContent { Themed(AppLang.EN) { CaseScreen(stateOf("judged_one_sided"), true, CaseActions(onPricing = { pricing++ }), true) } }
        compose.onNodeWithTag(VerdictTags.ADD_CONTEXT).performScrollTo().performClick()
        compose.onNodeWithTag(CaseTags.APPEAL_NOTE).assertTextContains(en.errorPremiumRequired)
        compose.onNodeWithTag(CaseTags.APPEAL_PRICING).performClick()
        assertEquals(1, pricing)
    }

    @Test
    fun aRefusedRound_bringsTheSheetBack_withWhy() {
        val judging = stateOf("appeal_judging").let { st ->
            st.copy(view = st.view!!.copy(appeals = st.view!!.appeals.map { it.copy(party = "a") }))
        }
        var state by mutableStateOf(judging)
        compose.setContent { Themed(AppLang.EN) { CaseScreen(state, false, CaseActions(), true) } }
        compose.onNodeWithTag(CaseTags.APPEAL_NOTE).assertTextContains(en.appealJudging)
        val v = judging.view!!
        state = judging.copy(
            view = v.copy(appeals = v.appeals.map { it.copy(status = "failed", error = "refused") }, appeal = AppealGate(allowed = true)),
        )
        compose.onNodeWithText(en.appealRefused).assertExists()
    }

    @Test
    fun failedAndExpired_offerTheirWayOn() {
        val calls = mutableListOf<String>()
        var state by mutableStateOf(stateOf("failed"))
        compose.setContent {
            Themed(AppLang.EN) { CaseScreen(state, true, CaseActions(onRetry = { calls += "retry" }, onStartOver = { calls += "over" }), true) }
        }
        compose.onNodeWithTag(CaseTags.RETRY).performClick()
        state = stateOf("expired")
        compose.waitForIdle()
        compose.onAllNodesWithTag(CaseTags.JUDGE_NOW).assertCountEquals(0)
        compose.onNodeWithTag(CaseTags.START_OVER).performClick()
        assertEquals(listOf("retry", "over"), calls)
    }

    @Test
    fun awaiting_namesWhoItWaitsFor() {
        var judgeNow = 0
        compose.setContent {
            Themed(AppLang.EN) {
                CaseScreen(stateOf("waiting_for_respondent"), true, CaseActions(onJudgeNow = { judgeNow++ }), true, otherName = " Sam ")
            }
        }
        compose.onNodeWithText(en.appCaseWaitingFor("Sam")).assertExists()
        compose.onNodeWithText(en.appCaseSendTo("Sam")).assertExists()
        compose.onNodeWithText(en.appCaseStepThem("Sam")).assertExists()
        compose.onNodeWithTag(CaseTags.JUDGE_NOW).assertTextContains(en.appCaseJudgeNowWithout("Sam")).performClick()
        compose.onNodeWithTag(CaseTags.CONFIRM).performClick()
        assertEquals(1, judgeNow)
    }

    @Test
    fun judged_rowsOpenTheDetails_andBackReturns() {
        compose.setContent { Themed(AppLang.EN) { CaseScreen(stateOf("judged"), true, CaseActions(), true) } }
        compose.onNodeWithText(en.appVerdictBack).assertDoesNotExist()
        compose.onNodeWithTag(VerdictTags.CRUX_ROW).performScrollTo().performClick()
        compose.onNodeWithText(en.appVerdictBack).assertExists().performClick()
        compose.onNodeWithTag(VerdictTags.CRUX_ROW).assertExists()
    }

    @Test
    fun premiumCase_mentionsTheHeldUnit_freeCaseDoesNot() {
        val view = view("waiting_for_respondent")
        val held = Errors.formatDate(AppLang.EN, view.expiresAt)?.let { en.caseHeld(it) } ?: en.caseHeldSoon
        var state by mutableStateOf(stateOf("waiting_for_respondent"))
        compose.setContent { Themed(AppLang.EN) { CaseScreen(state, true, CaseActions(), true) } }
        compose.onAllNodesWithText(held).assertCountEquals(1)
        state = stateOf("waiting_free")
        compose.waitForIdle()
        compose.onNodeWithText(en.appCaseStepThemAnon).assertExists()
        compose.onAllNodesWithText(held).assertCountEquals(0)
        compose.onNodeWithTag(CaseTags.JUDGE_NOW).performClick()
        compose.onNodeWithText(en.caseJudgeNowConfirm).assertExists()
    }

    @Test
    fun oldFreeCase_bannersSkipCredits_butJudgingNowSpendsOne() {
        val free = { name: String -> stateOf(name).let { it.copy(view = it.view!!.copy(tier = "free")) } }
        var state by mutableStateOf(free("failed").let { it.copy(view = it.view!!.copy(lastError = null)) })
        compose.setContent { Themed(AppLang.EN) { CaseScreen(state, true, CaseActions(), true) } }
        compose.onNodeWithTag(CaseTags.BANNER).assertTextContains(en.caseFailedBodyFree)
        state = stateOf("failed").let { it.copy(view = it.view!!.copy(lastError = null)) }
        compose.onNodeWithTag(CaseTags.BANNER).assertTextContains(en.caseFailedBody)

        state = free("expired").let { it.copy(view = it.view!!.copy(canJudgeNow = true)) }
        compose.onNodeWithTag(CaseTags.BANNER).assertTextContains(en.caseExpiredBodyFree)
        compose.onNodeWithTag(CaseTags.JUDGE_NOW).performClick()
        compose.onNodeWithText(en.caseJudgeExpiredConfirm).assertExists()
        compose.onNodeWithTag(CaseTags.CONFIRM).assertTextContains(en.caseJudgeExpiredYes)
    }

    @Test
    fun premiumCase_expired_judgeNowSpendsAVerdict() {
        val state = stateOf("expired").let { it.copy(view = it.view!!.copy(canJudgeNow = true)) }
        compose.setContent { Themed(AppLang.EN) { CaseScreen(state, true, CaseActions(), true) } }
        compose.onNodeWithTag(CaseTags.BANNER).assertTextContains(en.caseExpiredBody)
        compose.onNodeWithTag(CaseTags.JUDGE_NOW).performClick()
        compose.onNodeWithText(en.caseJudgeExpiredConfirm).assertExists()
        compose.onNodeWithTag(CaseTags.CONFIRM).assertTextContains(en.caseJudgeExpiredYes)
    }

    @Test
    fun expired_judgeNowWithNothingLeft_offersPricing() {
        var pricing = 0
        val expired = stateOf("expired").let { it.copy(view = it.view!!.copy(canJudgeNow = true)) }
        var state by mutableStateOf(expired.copy(actionError = UiError.Api("no_credits", 402)))
        compose.setContent { Themed(AppLang.EN) { CaseScreen(state, true, CaseActions(onPricing = { pricing++ }), true) } }
        compose.onNodeWithTag(CaseTags.ERROR).assertTextContains(en.errorNoCredits)
        compose.onNodeWithTag(CaseTags.PRICING).performClick()
        assertEquals(1, pricing)

        state = expired.copy(actionError = UiError.Api("unavailable", 503))
        compose.onNodeWithTag(CaseTags.ERROR).assertExists()
        compose.onAllNodesWithTag(CaseTags.PRICING).assertCountEquals(0)
    }

    @Test
    fun loadStates_haveTheirMessages() {
        var state by mutableStateOf(CaseUiState())
        var signIn = 0
        compose.setContent { Themed(AppLang.EN) { CaseScreen(state, true, CaseActions(onSignIn = { signIn++ }), true) } }
        compose.onNodeWithTag(CaseTags.MESSAGE).assertTextContains(en.caseLoading)
        state = CaseUiState(status = com.okjudge.judge.ui.cases.CaseLoadStatus.MISSING)
        compose.onNodeWithTag(CaseTags.MESSAGE).assertTextContains(en.caseNotFound)
        state = CaseUiState(status = com.okjudge.judge.ui.cases.CaseLoadStatus.SIGNIN)
        compose.onNodeWithTag(CaseTags.MESSAGE).assertTextContains(en.caseSignIn)
        compose.onNodeWithText(en.navSignIn).performClick()
        assertEquals(1, signIn)
    }

    @Test
    fun history_listsCasesWithTheVerdicts_newestFirst() {
        val list = WireJson.json.decodeFromString(CaseListResponse.serializer(), Fixtures.verdicts["cases"]!!.jsonObject["list"].toString())
        val o = sample("win_a_self")
        // Between the first two cases (Oct 20 and Oct 18).
        val saved = SavedVerdict(o.id, Instant.parse("2026-10-19T12:00:00Z").toEpochMilli(), o.result, o.nameMap, emptyMap())
        val opened = mutableListOf<String>()
        compose.setContent {
            Themed(AppLang.EN) {
                HistoryScreen(listOf(saved), {}, {}, {}, {}, cases = CaseListState.Ready(list.cases), onOpenCase = { opened += it })
            }
        }
        compose.onNodeWithText(en.navVerdicts).assertExists()
        compose.onNodeWithTag(HistoryTags.LIST).assertExists()
        compose.onNodeWithTag(HistoryTags.row(o.id)).assertExists()
        compose.onNodeWithText("Party A's menu test settles it").assertExists()
        compose.onNodeWithText(en.caseStatusAwaiting).assertExists()
        compose.onNodeWithText(en.accountVerdictsRemoved).assertExists()
        compose.onNodeWithTag(CaseListTags.row("case0000002")).performClick()
        assertEquals(listOf("case0000002"), opened)
        assertEquals(
            listOf("c:case0000001", "v:${o.id}", "c:case0000002", "c:case0000003"),
            mergeHistory(listOf(saved), list.cases).map { it.key },
        )
    }

    @Test
    fun history_saysWhenTheCasesFailed_andKeepsTheVerdicts() {
        val o = sample("win_a_self")
        var retried = 0
        compose.setContent {
            Themed(AppLang.EN) {
                HistoryScreen(
                    listOf(SavedVerdict(o.id, 1_760_900_000_000L, o.result, o.nameMap, emptyMap())), {}, {}, {}, {},
                    cases = CaseListState.Error,
                    onRetryCases = { retried++ },
                )
            }
        }
        compose.onNodeWithTag(CaseListTags.ERROR).assertExists()
        compose.onNodeWithTag(HistoryTags.row(o.id)).assertExists()
        compose.onNodeWithText(en.appRetry).performClick()
        assertEquals(1, retried)
    }
}
