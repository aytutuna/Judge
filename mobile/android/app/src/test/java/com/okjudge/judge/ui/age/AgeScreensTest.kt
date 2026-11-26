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
import androidx.compose.ui.test.assertContentDescriptionEquals
import androidx.compose.ui.test.hasText
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

    // Far in the future, so day 1 of the current month is an adult's date; the real clock decides the month shown.
    private val farFuture = { java.time.Instant.parse("2060-01-01T00:00:00Z").toEpochMilli() }

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
        pickFirstOfMonth(compose)
        compose.onNodeWithTag(AgeTags.CONTINUE).assertIsEnabled()
    }

    @Test
    fun dateStep_anAdultDateIsSentWithoutAConfirmStep() {
        val submitted = mutableListOf<LocalDate>()
        compose.setContent(screen(submitted))
        pickFirstOfMonth(compose)
        compose.onNodeWithTag(AgeTags.CONTINUE).performClick()
        assertEquals(1, submitted.size)
        assertEquals(1, submitted[0].dayOfMonth)
        compose.onAllNodesWithTag(AgeTags.CONFIRM).assertCountEquals(0)
    }

    @Test
    fun dateStep_anUnder13Date_asksOnceFirst_andChangeKeepsTheDate() {
        val submitted = mutableListOf<LocalDate>()
        // "Now" is the real clock, so day 1 of this month is a child's date.
        compose.setContent(screen(submitted, now = System::currentTimeMillis))
        pickFirstOfMonth(compose)
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
        pickFirstOfMonth(compose)
        compose.onNodeWithTag(AgeTags.CONTINUE).performClick()
        compose.onNodeWithTag(AgeTags.CONFIRM).assertExists()

        restore.emulateSavedInstanceStateRestore()
        compose.onNodeWithTag(AgeTags.CONFIRM).assertExists()
        compose.onNodeWithTag(AgeTags.CONFIRM_YES).performClick()
        assertEquals(1, submitted.size)
        assertEquals(1, submitted[0].dayOfMonth)
    }

    @Test
    fun dateStep_keepsThePickedDate_acrossRecreation() {
        val restore = StateRestorationTester(compose)
        restore.setContent(screen())
        pickFirstOfMonth(compose)
        compose.onNodeWithTag(AgeTags.CONTINUE).assertIsEnabled()
        restore.emulateSavedInstanceStateRestore()
        compose.onNodeWithTag(AgeTags.CONTINUE).assertIsEnabled()
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

/** Taps the 1st of the month the picker opens on (this month by the real clock): a day cell reads as its whole date. */
fun pickFirstOfMonth(compose: androidx.compose.ui.test.junit4.ComposeContentTestRule) {
    val month = LocalDate.now().month.getDisplayName(java.time.format.TextStyle.FULL, java.util.Locale.US)
    compose.onNode(hasText("$month 1,", substring = true)).performClick()
}
