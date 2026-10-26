package com.okjudge.judge.ui

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
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
import com.okjudge.judge.core.display.Errors
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
            compose.onNodeWithTag(CaseTags.STATUS).assertTextContains(en.text(v.status.key)!!)
            when (name) {
                "waiting_for_respondent" -> compose.onNodeWithText(en.caseNotYet).assertExists()
                "respondent_answered" -> compose.onNodeWithText(en.caseAnswered).assertExists()
                "judging" -> compose.onNodeWithText(en.caseAnswered).assertExists()
                "failed" -> compose.onNodeWithTag(CaseTags.BANNER).assertTextContains(en.errorQuota)
                "expired" -> compose.onNodeWithTag(CaseTags.BANNER).assertTextContains(en.caseExpiredBody)
                "waiting_free" -> compose.onNodeWithText(en.caseNotYet).assertExists()
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
        compose.onNodeWithTag(CaseTags.INVITE_URL).assertTextContains(url)
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
        compose.onNodeWithTag(CaseTags.APPEAL_SUBMIT).performScrollTo().assertIsNotEnabled()
        state = state.copy(appealText = "x".repeat(19))
        compose.onNodeWithTag(CaseTags.APPEAL_SUBMIT).assertIsNotEnabled()
        state = state.copy(appealText = "x".repeat(20))
        compose.onNodeWithText("20 / 2000").assertExists()
        compose.onNodeWithTag(CaseTags.APPEAL_SUBMIT).assertIsEnabled().performClick()
        assertEquals(1, sent)
    }

    @Test
    fun appealBlocked_forTheOwner_saysWhy_andOffersPricing() {
        var pricing = 0
        compose.setContent { Themed(AppLang.EN) { CaseScreen(stateOf("judged_one_sided"), true, CaseActions(onPricing = { pricing++ }), true) } }
        compose.onNodeWithTag(CaseTags.APPEAL_NOTE).assertTextContains(en.errorPremiumRequired)
        compose.onNodeWithTag(CaseTags.APPEAL_PRICING).performScrollTo().performClick()
        assertEquals(1, pricing)
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
    fun premiumCase_mentionsTheHeldUnit_freeCaseDoesNot() {
        val view = view("waiting_for_respondent")
        val held = Errors.formatDate(AppLang.EN, view.expiresAt)?.let { en.caseHeld(it) } ?: en.caseHeldSoon
        var state by mutableStateOf(stateOf("waiting_for_respondent"))
        compose.setContent { Themed(AppLang.EN) { CaseScreen(state, true, CaseActions(), true) } }
        compose.onAllNodesWithText(held).assertCountEquals(1)
        state = stateOf("waiting_free")
        compose.waitForIdle()
        compose.onNodeWithText(en.caseNotYet).assertExists()
        compose.onAllNodesWithText(held).assertCountEquals(0)
        compose.onNodeWithTag(CaseTags.JUDGE_NOW).performClick()
        compose.onNodeWithText(en.caseJudgeNowConfirm).assertExists()
    }

    @Test
    fun freeCase_failedAndExpired_neverMentionCredits() {
        val free = { name: String -> stateOf(name).let { it.copy(view = it.view!!.copy(tier = "free")) } }
        var state by mutableStateOf(free("failed").let { it.copy(view = it.view!!.copy(lastError = null)) })
        compose.setContent { Themed(AppLang.EN) { CaseScreen(state, true, CaseActions(), true) } }
        compose.onNodeWithTag(CaseTags.BANNER).assertTextContains(en.caseFailedBodyFree)
        state = stateOf("failed").let { it.copy(view = it.view!!.copy(lastError = null)) }
        compose.onNodeWithTag(CaseTags.BANNER).assertTextContains(en.caseFailedBody)

        state = free("expired").let { it.copy(view = it.view!!.copy(canJudgeNow = true)) }
        compose.onNodeWithTag(CaseTags.BANNER).assertTextContains(en.caseExpiredBodyFree)
        compose.onNodeWithTag(CaseTags.JUDGE_NOW).performClick()
        compose.onNodeWithText(en.caseJudgeExpiredConfirmFree).assertExists()
        compose.onNodeWithTag(CaseTags.CONFIRM).assertTextContains(en.caseJudgeNowYes)
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
    fun history_showsTheCasesSegment_withTheirTitles() {
        val list = WireJson.json.decodeFromString(CaseListResponse.serializer(), Fixtures.verdicts["cases"]!!.jsonObject["list"].toString())
        val opened = mutableListOf<String>()
        compose.setContent {
            Themed(AppLang.EN) {
                HistoryScreen(emptyList(), {}, {}, {}, {}, cases = CaseListState.Ready(list.cases), onOpenCase = { opened += it })
            }
        }
        compose.onNodeWithTag(HistoryTags.segment(1)).performClick()
        compose.onNodeWithTag(CaseListTags.LIST).assertExists()
        compose.onNodeWithText("Party A's menu test settles it").assertExists()
        compose.onNodeWithText(en.accountVerdictsRemoved).assertExists()
        compose.onNodeWithTag(CaseListTags.row("case0000002")).performClick()
        assertEquals(listOf("case0000002"), opened)
    }
}
