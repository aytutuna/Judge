package com.okjudge.judge.ui.age

import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.performScrollToNode
import com.okjudge.judge.core.display.UiError
import com.okjudge.judge.core.model.AgeHint
import com.okjudge.judge.core.model.ParentView
import com.okjudge.judge.i18n.AppLang
import com.okjudge.judge.ui.Themed
import com.okjudge.judge.ui.UiTestSupport
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.time.LocalDate

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [36], qualifiers = "w393dp-h852dp-xxhdpi")
class AgeParentScreensTest {
    @get:Rule
    val compose = createComposeRule()

    private val s = UiTestSupport.s(AppLang.EN)

    private fun sent(resends: Int = 3, changes: Int = 3, expired: Boolean = false) = ParentView(
        status = "pending", sent = true, emailHint = "m***@example.com", expired = expired,
        resendsLeft = resends, changesLeft = changes, deleteAt = "2026-12-28T12:00:00.000Z",
    )

    private fun parent(
        status: String = "pending",
        view: ParentView? = ParentView(status = "none", deleteAt = "2026-12-28T12:00:00.000Z"),
        error: UiError? = null,
        sends: MutableList<String> = mutableListOf(),
        resends: MutableList<Unit> = mutableListOf(),
    ) = compose.setContent {
        Themed(AppLang.EN) {
            AgeParentScreen(status, view, busy = false, error = error, onSend = { sends += it }, onResend = { resends += Unit }, onReload = {}, onSignOut = {}, onDelete = {})
        }
    }

    @Test
    fun notSent_asksForTheAddress() {
        val sends = mutableListOf<String>()
        parent(sends = sends)
        compose.onNodeWithTag(AgeTags.PARENT).assertExists()
        compose.onNodeWithText(s.ageParentTitle).assertExists()
        compose.onNodeWithText(s.ageParentLead).assertExists()
        compose.onAllNodesWithText(s.ageParentDelete("December 28"), substring = true).assertCountEquals(1)
        compose.onNodeWithTag(AgeTags.PARENT_SEND).assertIsNotEnabled()
        compose.onNode(hasSetTextAction()).performTextInput("mum@example.com")
        compose.onNodeWithTag(AgeTags.PARENT_SEND).assertIsEnabled().performClick()
        assertEquals(listOf("mum@example.com"), sends)
        compose.onNodeWithTag(AgeTags.SIGN_OUT).assertExists()
        compose.onNodeWithTag(AgeTags.DELETE).assertExists()
    }

    @Test
    fun sent_showsTheMaskedAddress_resendAndChange() {
        val resends = mutableListOf<Unit>()
        parent(view = sent(), resends = resends)
        compose.onNodeWithTag(AgeTags.PARENT_WAIT).assertExists()
        compose.onNodeWithText(s.ageParentWaitTitle).assertExists()
        compose.onNodeWithText(s.ageParentSentTo("m***@example.com")).assertExists()
        compose.onAllNodesWithText(s.ageParentExpired).assertCountEquals(0)
        compose.onNodeWithTag(AgeTags.PARENT_RESEND).assertIsEnabled().performClick()
        assertEquals(1, resends.size)
        compose.onNodeWithTag(AgeTags.PARENT_CHANGE).assertIsEnabled()
    }

    @Test
    fun sent_expiredSaysSo() {
        parent(view = sent(expired = true))
        compose.onNodeWithText(s.ageParentExpired).assertExists()
    }

    @Test
    fun sent_noTriesLeft_turnsTheButtonsOff() {
        parent(view = sent(resends = 0, changes = 0))
        compose.onNodeWithTag(AgeTags.PARENT_RESEND).assertIsNotEnabled()
        compose.onNodeWithTag(AgeTags.PARENT_CHANGE).assertIsNotEnabled()
    }

    @Test
    fun change_opensTheFormAndCancelGoesBack() {
        val sends = mutableListOf<String>()
        parent(view = sent(), sends = sends)
        compose.onNodeWithTag(AgeTags.PARENT_CHANGE).performClick()
        compose.onNodeWithTag(AgeTags.PARENT_EMAIL).assertExists()
        compose.onNodeWithTag(AgeTags.PARENT_CANCEL).assertExists()
        compose.onNode(hasSetTextAction()).performTextInput("dad@example.com")
        compose.onNodeWithTag(AgeTags.PARENT_SEND).performClick()
        assertEquals(listOf("dad@example.com"), sends)
        compose.onNodeWithTag(AgeTags.PARENT_CANCEL).performClick()
        compose.onNodeWithTag(AgeTags.PARENT_RESEND).assertExists()
    }

    @Test
    fun declined_hasNoRetry() {
        parent(status = "declined", view = sent())
        compose.onNodeWithTag(AgeTags.PARENT_DECLINED).assertExists()
        compose.onNodeWithText(s.ageParentDeclinedTitle).assertExists()
        compose.onNodeWithText(s.ageParentDeclined("December 28")).assertExists()
        compose.onAllNodesWithTag(AgeTags.PARENT_SEND).assertCountEquals(0)
        compose.onAllNodesWithTag(AgeTags.PARENT_RESEND).assertCountEquals(0)
        compose.onNodeWithTag(AgeTags.SIGN_OUT).assertExists()
        compose.onNodeWithTag(AgeTags.DELETE).assertExists()
    }

    @Test
    fun revoked_asksAgainWithTheEmailForm() {
        parent(status = "revoked", view = sent())
        compose.onNodeWithTag(AgeTags.PARENT_REVOKED).assertExists()
        compose.onNodeWithText(s.ageParentRevokedTitle).assertExists()
        compose.onNodeWithText(s.ageParentRevoked("December 28")).assertExists()
        compose.onNodeWithTag(AgeTags.PARENT_EMAIL).assertExists()
        compose.onNodeWithTag(AgeTags.PARENT_SEND).assertExists()
    }

    @Test
    fun anError_showsItsMessage() {
        parent(error = UiError.Api(code = "parent_email", status = 400))
        compose.onNodeWithText(s.errorParentEmail).assertExists()
    }

    @Test
    fun beforeTheServerAnswers_thereIsOnlyARetry() {
        parent(view = null)
        compose.onAllNodesWithTag(AgeTags.PARENT_SEND).assertCountEquals(0)
        compose.onNodeWithTag(AgeTags.PARENT_RELOAD).assertExists()
        compose.onNodeWithTag(AgeTags.SIGN_OUT).assertExists()
    }

    @Test
    fun brazil_hasNoRetryField() {
        compose.setContent {
            Themed(AppLang.EN) { AgeRegionScreen(busy = false, onSignOut = {}, onDelete = {}, onContact = {}) }
        }
        compose.onNodeWithTag(AgeTags.REGION).assertExists()
        compose.onNodeWithText(s.ageRegionTitle).assertExists()
        compose.onNodeWithText(s.ageRegion).assertExists()
        compose.onNodeWithTag(AgeTags.SIGN_OUT).assertExists()
        compose.onNodeWithTag(AgeTags.DELETE).assertExists()
        compose.onAllNodesWithTag(AgeTags.CONTINUE).assertCountEquals(0)
    }

    private fun date(
        submitted: MutableList<Triple<LocalDate, String?, Boolean?>> = mutableListOf(),
        hint: AgeHint? = null,
    ) = compose.setContent {
        Themed(AppLang.EN) {
            AgeDateScreen(false, false, { d, c, q -> submitted += Triple(d, c, q) }, onSignOut = {}, onDelete = {}, hint = hint)
        }
    }

    private fun yearsAgo(years: Long) = LocalDate.now().minusYears(years).minusDays(40)

    @Test
    fun dateStep_asksWhereOf13To15_andWaitsForTheAnswer() {
        val submitted = mutableListOf<Triple<LocalDate, String?, Boolean?>>()
        date(submitted, hint = AgeHint(country = null))
        enterBirthDate(compose, yearsAgo(14))
        compose.onNodeWithText(s.ageWhere).assertExists()
        compose.onNodeWithText(s.ageWhereWhy).assertExists()
        compose.onNodeWithTag(AgeTags.CONTINUE).assertIsNotEnabled()
        compose.onNodeWithTag(AgeTags.COUNTRY).performClick()
        compose.onNodeWithTag(AgeTags.COUNTRY_LIST).assertExists()
        compose.onNodeWithTag(AgeTags.COUNTRY_LIST).performScrollToNode(hasText("Germany"))
        compose.onNodeWithText("Germany").performClick()
        compose.onNodeWithTag(AgeTags.CONTINUE).assertIsEnabled().performClick()
        assertEquals("DE", submitted.single().second)
        assertEquals(null, submitted.single().third)
    }

    @Test
    fun dateStep_ipGuessFillsTheCountry_andQuebecFor13InCanada() {
        val submitted = mutableListOf<Triple<LocalDate, String?, Boolean?>>()
        date(submitted, hint = AgeHint(country = "CA", quebec = null))
        enterBirthDate(compose, yearsAgo(13))
        compose.onNodeWithText(s.ageQuebec).assertExists()
        compose.onNodeWithTag(AgeTags.CONTINUE).assertIsNotEnabled()
        compose.onNodeWithTag(AgeTags.QUEBEC_NO).performClick()
        compose.onNodeWithTag(AgeTags.CONTINUE).assertIsEnabled().performClick()
        assertEquals("CA", submitted.single().second)
        assertEquals(false, submitted.single().third)
    }

    @Test
    fun dateStep_quebecIsNotAskedOf14() {
        date(hint = AgeHint(country = "CA", quebec = true))
        enterBirthDate(compose, yearsAgo(14))
        compose.onNodeWithText(s.ageWhere).assertExists()
        compose.onAllNodesWithText(s.ageQuebec).assertCountEquals(0)
        compose.onNodeWithTag(AgeTags.CONTINUE).assertIsEnabled()
    }

    @Test
    fun dateStep_sixteenAndOverAreAskedNothingExtra() {
        val submitted = mutableListOf<Triple<LocalDate, String?, Boolean?>>()
        date(submitted, hint = AgeHint(country = "CA", quebec = true))
        enterBirthDate(compose, yearsAgo(16))
        compose.onAllNodesWithText(s.ageWhere).assertCountEquals(0)
        compose.onAllNodesWithText(s.ageQuebec).assertCountEquals(0)
        compose.onNodeWithTag(AgeTags.CONTINUE).assertIsEnabled().performClick()
        assertEquals(null, submitted.single().second)
        assertEquals(null, submitted.single().third)
    }
}
