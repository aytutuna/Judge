package com.okjudge.judge.ui.age

import androidx.compose.ui.test.junit4.StateRestorationTester
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsFocused
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.assertContentDescriptionEquals
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.performTextInput
import com.okjudge.judge.i18n.AppLang
import com.okjudge.judge.ui.Themed
import com.okjudge.judge.ui.UiTestSupport
import com.okjudge.judge.ui.settings.SettingsScreen
import com.okjudge.judge.ui.settings.SettingsTags
import com.okjudge.judge.i18n.LangPref
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
class AgeScreensTest {
    @get:Rule
    val compose = createComposeRule()

    private val s = UiTestSupport.s(AppLang.EN)
    private val ADULT = LocalDate.of(1990, 5, 17)
    private val CHILD = LocalDate.now().minusYears(5)

    private val farFuture = { System.currentTimeMillis() }

    private fun screen(
        submitted: MutableList<LocalDate> = mutableListOf(),
        busy: Boolean = false,
        failed: Boolean = false,
        now: () -> Long = farFuture,
    ): @androidx.compose.runtime.Composable () -> Unit = {
        Themed(AppLang.EN) {
            AgeDateScreen(busy, failed, { submitted += it }, onSignOut = {}, onDelete = {}, nowMillis = now)
        }
    }

    @Test
    fun dateStep_continueWaitsForADate() {
        compose.setContent(screen())
        compose.onNodeWithText(s.ageTitle).assertExists()
        compose.onNodeWithText(s.ageLead).assertExists()
        compose.onNodeWithTag(AgeTags.PICKER).assertContentDescriptionEquals(s.ageTitle)
        compose.onNodeWithTag(AgeTags.CONTINUE).assertIsNotEnabled()
        enterBirthDate(compose, ADULT)
        compose.onNodeWithTag(AgeTags.CONTINUE).assertIsEnabled()
    }

    @Test
    fun dateStep_pickerTextsAndPatternFollowTheAppLanguage() {
        compose.setContent {
            Themed(AppLang.TR) {
                AgeDateScreen(busy = false, failed = false, onSubmit = {}, onSignOut = {}, onDelete = {})
            }
        }
        // Material's own label and the day-first pattern come from the app's language, not the phone's.
        compose.onNodeWithText("Tarih").assertExists()
        compose.onAllNodesWithText("Date").assertCountEquals(0)
        // 13.05.2000 only reads as a date when the day comes first, as in Turkish.
        compose.onNodeWithTag(AgeTags.CONTINUE).assertIsNotEnabled()
        compose.onNode(hasSetTextAction()).performTextInput("13052000")
        compose.onNodeWithTag(AgeTags.CONTINUE).assertIsEnabled()
    }

    @Test
    fun dateStep_goingToTheConfirmStep_andBack_clearsTheFailure() {
        var edits = 0
        compose.setContent {
            Themed(AppLang.EN) {
                AgeDateScreen(false, true, {}, {}, {}, onEdit = { edits++ }, nowMillis = System::currentTimeMillis)
            }
        }
        enterBirthDate(compose, CHILD)
        compose.onNodeWithTag(AgeTags.CONTINUE).performClick()
        assertEquals(1, edits)
        compose.onNodeWithTag(AgeTags.CHANGE).performClick()
        assertEquals(2, edits)
    }

    @Test
    fun dateStep_anAdultDateIsSentWithoutAConfirmStep() {
        val submitted = mutableListOf<LocalDate>()
        compose.setContent(screen(submitted))
        enterBirthDate(compose, ADULT)
        compose.onNodeWithTag(AgeTags.CONTINUE).performClick()
        assertEquals(1, submitted.size)
        assertEquals(ADULT, submitted[0])
        compose.onAllNodesWithTag(AgeTags.CONFIRM).assertCountEquals(0)
    }

    @Test
    fun dateStep_anUnder13Date_asksOnceFirst_andChangeKeepsTheDate() {
        val submitted = mutableListOf<LocalDate>()
        // "Now" is the real clock, so a date five years back is a child's.
        compose.setContent(screen(submitted, now = System::currentTimeMillis))
        enterBirthDate(compose, CHILD)
        compose.onNodeWithTag(AgeTags.CONTINUE).performClick()
        assertEquals(0, submitted.size)
        compose.onNodeWithTag(AgeTags.CONFIRM).assertExists()
        compose.onNodeWithTag(AgeTags.CONFIRM_TEXT).assertIsFocused()
        compose.onNodeWithTag(AgeTags.CONFIRM_YES).assertIsEnabled()

        compose.onNodeWithTag(AgeTags.CHANGE).performClick()
        compose.onNodeWithTag(AgeTags.DATE).assertExists()
        compose.onNodeWithTag(AgeTags.CONTINUE).assertIsEnabled()

        compose.onNodeWithTag(AgeTags.CONTINUE).performClick()
        compose.onNodeWithTag(AgeTags.CONFIRM_YES).performClick()
        assertEquals(1, submitted.size)
    }

    @Test
    fun confirmStep_survivesRecreation_withTheDate() {
        val restore = StateRestorationTester(compose)
        val submitted = mutableListOf<LocalDate>()
        restore.setContent(screen(submitted, now = System::currentTimeMillis))
        enterBirthDate(compose, CHILD)
        compose.onNodeWithTag(AgeTags.CONTINUE).performClick()
        compose.onNodeWithTag(AgeTags.CONFIRM).assertExists()

        restore.emulateSavedInstanceStateRestore()
        compose.onNodeWithTag(AgeTags.CONFIRM).assertExists()
        compose.onNodeWithTag(AgeTags.CONFIRM_YES).performClick()
        assertEquals(1, submitted.size)
        assertEquals(CHILD, submitted[0])
    }

    @Test
    fun dateStep_keepsThePickedDate_acrossRecreation() {
        val restore = StateRestorationTester(compose)
        restore.setContent(screen())
        enterBirthDate(compose, ADULT)
        compose.onNodeWithTag(AgeTags.CONTINUE).assertIsEnabled()
        restore.emulateSavedInstanceStateRestore()
        compose.onNodeWithTag(AgeTags.CONTINUE).assertIsEnabled()
    }

    @Test
    fun dateStep_keepsTheCalendarMode_acrossRecreation() {
        val restore = StateRestorationTester(compose)
        restore.setContent(screen())
        compose.onNode(hasContentDescription("Switch to calendar", substring = true)).performClick()
        compose.onNode(hasContentDescription("Switch to text input", substring = true)).assertExists()
        restore.emulateSavedInstanceStateRestore()
        compose.onNode(hasContentDescription("Switch to text input", substring = true)).assertExists()
    }

    @Test
    fun dateStep_failureShowsTheNote_andBusyLocksTheButtons() {
        compose.setContent(screen(failed = true, busy = true))
        compose.onNodeWithTag(AgeTags.ERROR).assertTextContains(s.ageFailed)
        compose.onNodeWithTag(AgeTags.CONTINUE).assertIsNotEnabled()
        compose.onNodeWithTag(AgeTags.SIGN_OUT).assertIsNotEnabled()
    }

    @Test
    fun dateStep_hasNoWayPastIt_butSigningOutAndDeleting() {
        compose.setContent(screen())
        compose.onNodeWithTag(AgeTags.SIGN_OUT).assertIsEnabled()
        compose.onNodeWithTag(AgeTags.DELETE).assertIsEnabled()
    }

    @Test
    fun refusal_hasNoDateField_andLinksTheAddress() {
        compose.setContent {
            Themed(AppLang.EN) { AgeBlockedScreen(signedIn = true, busy = false, onSignOut = {}, onDelete = {}, onContact = {}) }
        }
        compose.onNodeWithText(s.ageBlockedTitle).assertExists()
        compose.onNodeWithText(s.ageBlocked).assertExists()
        compose.onAllNodesWithTag(AgeTags.PICKER).assertCountEquals(0)
        compose.onAllNodesWithTag(AgeTags.CONTINUE).assertCountEquals(0)
        compose.onNodeWithTag(AgeTags.SIGN_OUT).assertIsEnabled()
        compose.onNodeWithTag(AgeTags.DELETE).assertIsEnabled()
    }

    @Test
    fun approvalCover_offersCheckAgain_signOutAndDelete_only() {
        var checks = 0
        compose.setContent {
            Themed(AppLang.EN) { AgeApprovalScreen(busy = false, onCheckAgain = { checks++ }, onSignOut = {}, onDelete = {}) }
        }
        compose.onAllNodesWithTag(AgeTags.PICKER).assertCountEquals(0)
        compose.onNodeWithTag(AgeTags.SIGN_OUT).assertIsEnabled()
        compose.onNodeWithTag(AgeTags.DELETE).assertIsEnabled()
        compose.onNodeWithTag(AgeTags.CHECK_AGAIN).performClick()
        assertEquals(1, checks)
        compose.onNodeWithText(s.ageApprovalTitle).assertExists()
        compose.onNodeWithText(s.ageApproval).assertExists()
    }

    @Test
    fun settings_forATeen_locksStatistics_andOffersNoTrainingSwitch() {
        compose.setContent {
            Themed(AppLang.EN) {
                SettingsScreen(LangPref.SYSTEM, "0.1.0", {}, {}, "https://okjudge.com", usageStats = true, teen = true)
            }
        }
        compose.onNodeWithTag(SettingsTags.USAGE_STATS).assertIsNotEnabled()
        compose.onNodeWithText(s.settingsUsageStatsTeen).assertExists()
        compose.onAllNodesWithTag(SettingsTags.HELP_IMPROVE).assertCountEquals(0)
    }

    @Test
    fun settings_forAnAdult_keepsBothSwitches() {
        compose.setContent {
            Themed(AppLang.EN) { SettingsScreen(LangPref.SYSTEM, "0.1.0", {}, {}, "https://okjudge.com") }
        }
        compose.onNodeWithTag(SettingsTags.USAGE_STATS).assertIsEnabled()
        compose.onNodeWithTag(SettingsTags.HELP_IMPROVE).assertExists()
    }
}

/** Types [date] into the picker's input field (the en-US order, month first). */
fun enterBirthDate(compose: androidx.compose.ui.test.junit4.ComposeContentTestRule, date: LocalDate) {
    val typed = "%02d%02d%04d".format(date.monthValue, date.dayOfMonth, date.year)
    compose.onNode(hasSetTextAction()).performTextInput(typed)
}
