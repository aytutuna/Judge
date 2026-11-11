package com.okjudge.judge.ui

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsFocused
import androidx.compose.ui.test.assertIsNotDisplayed
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.core.view.WindowCompat
import androidx.test.core.app.ApplicationProvider
import com.okjudge.judge.JudgeApp
import com.okjudge.judge.MainActivity
import com.okjudge.judge.core.data.Appearance
import com.okjudge.judge.i18n.AppLang
import com.okjudge.judge.i18n.LangPref
import com.okjudge.judge.ui.history.HistoryTags
import com.okjudge.judge.ui.home.HomeTags
import com.okjudge.judge.ui.settings.SettingsTags
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.ExternalResource
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** The real activity: splash, theme, Navigation 3 back stack, the side menu, the clear button and the language and appearance settings. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], qualifiers = "en-rUS-w393dp-h852dp")
class AppShellTest {
    /** The activity talks to the configured server: keep usage events from tests out of its counts. The language starts as the device's, whatever an earlier test picked. */
    @get:Rule(order = 0)
    val noUsageStats = object : ExternalResource() {
        override fun before() = runBlocking {
            val settings = ApplicationProvider.getApplicationContext<JudgeApp>().container.settings
            settings.setUsageStats(false)
            settings.setLangPref(LangPref.SYSTEM)
        }
    }

    @get:Rule(order = 1)
    val compose = createAndroidComposeRule<MainActivity>()

    private fun awaitText(text: String) =
        compose.waitUntil(5_000) { compose.onAllNodesWithText(text).fetchSemanticsNodes().isNotEmpty() }

    /** Opens the side menu and taps the row named [label]. */
    private fun goTo(label: String, menuName: String) {
        compose.onNodeWithContentDescription(menuName).performClick()
        compose.waitForIdle()
        compose.onNodeWithText(label).performClick()
        compose.waitForIdle()
    }

    @Test
    fun menu_andLanguageToggle() {
        val en = UiTestSupport.s(AppLang.EN)
        val tr = UiTestSupport.s(AppLang.TR)
        awaitText(en.appHomeExample)
        compose.onNodeWithTag(HomeTags.SUBMIT).assertExists()

        goTo(en.navVerdicts, en.navTabs)
        awaitText(en.appHistoryEmpty)
        compose.onNodeWithTag(HistoryTags.EMPTY).assertExists()

        goTo(en.appTabSettings, en.navTabs)
        compose.onNodeWithTag(SettingsTags.LANGUAGE).assertTextContains(en.appSettingsLanguageDevice).performClick()
        compose.onNodeWithTag(SettingsTags.langOption(LangPref(AppLang.TR))).performClick()
        awaitText(tr.appTabSettings)
        compose.onNodeWithTag(SettingsTags.LANGUAGE).assertTextContains("Türkçe")

        goTo(tr.appTabNew, tr.navTabs)
        awaitText(tr.appHomeExample)
    }

    @Test
    fun composeButton_returnsToTheDraft() {
        val en = UiTestSupport.s(AppLang.EN)
        awaitText(en.appHomeExample)
        compose.onNodeWithTag(HomeTags.INPUT).performTextInput("My roommate never does the dishes")
        goTo(en.navVerdicts, en.navTabs)
        awaitText(en.appHistoryEmpty)
        compose.onNodeWithContentDescription(en.shellNew).performClick()
        compose.waitUntil(5_000) { compose.onAllNodesWithTag(HomeTags.INPUT).fetchSemanticsNodes().isNotEmpty() }
        assertEquals("My roommate never does the dishes", typed(HomeTags.INPUT))
    }

    @Test
    fun clearButton_clearsTheDraft() {
        val en = UiTestSupport.s(AppLang.EN)
        awaitText(en.appHomeExample)
        compose.onNodeWithTag(HomeTags.CLEAR).assertDoesNotExist()
        compose.onNodeWithTag(HomeTags.INPUT).performTextInput("My roommate never does the dishes")
        compose.onNodeWithTag(HomeTags.CLEAR).performClick()
        compose.waitForIdle()
        compose.onNodeWithTag(HomeTags.COUNTER).assertTextEquals("0 / 6,000")
        compose.onNodeWithTag(HomeTags.CLEAR).assertDoesNotExist()
    }

    @Test
    fun counter_sitsInTheBoxAndFollowsWhatIsTyped() {
        val en = UiTestSupport.s(AppLang.EN)
        awaitText(en.appHomeExample)
        compose.onNodeWithTag(HomeTags.COUNTER).assertTextEquals("0 / 6,000")
        compose.onNodeWithTag(HomeTags.INPUT).performTextInput("abc")
        compose.onNodeWithTag(HomeTags.COUNTER).assertTextEquals("3 / 6,000")
    }

    @Test
    fun newPage_comesBackFromOtherPagesToTheDraft() {
        val en = UiTestSupport.s(AppLang.EN)
        awaitText(en.appHomeExample)
        compose.onNodeWithTag(HomeTags.INPUT).performTextInput("My roommate never does the dishes")
        goTo(en.navVerdicts, en.navTabs)
        awaitText(en.appHistoryEmpty)
        goTo(en.appTabNew, en.navTabs)
        compose.waitUntil(5_000) { compose.onAllNodesWithTag(HomeTags.INPUT).fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag(HistoryTags.EMPTY).assertDoesNotExist()
        assertEquals("My roommate never does the dishes", typed(HomeTags.INPUT))
    }

    @Test
    fun systemBack_closesTheMenuBeforeLeavingThePage() {
        val en = UiTestSupport.s(AppLang.EN)
        awaitText(en.appHomeExample)
        goTo(en.navVerdicts, en.navTabs)
        awaitText(en.appHistoryEmpty)
        compose.onNodeWithContentDescription(en.navTabs).performClick()
        compose.waitForIdle()
        compose.onNodeWithText(en.appTabSettings).assertIsDisplayed()
        compose.runOnUiThread { compose.activity.onBackPressedDispatcher.onBackPressed() }
        compose.waitForIdle()
        compose.onNodeWithTag(HistoryTags.EMPTY).assertExists()
        compose.onNodeWithText(en.appTabSettings).assertIsNotDisplayed()
    }

    @Test
    fun focus_movesIntoTheMenuAndBackToTheButton() {
        val en = UiTestSupport.s(AppLang.EN)
        awaitText(en.appHomeExample)
        goTo(en.navVerdicts, en.navTabs)
        awaitText(en.appHistoryEmpty)
        compose.onNodeWithContentDescription(en.navTabs).performClick()
        compose.waitForIdle()
        compose.onNodeWithText(en.appTabNew).assertIsFocused()
        compose.runOnUiThread { compose.activity.onBackPressedDispatcher.onBackPressed() }
        compose.waitForIdle()
        compose.onNodeWithContentDescription(en.navTabs).assertIsFocused()
    }

    private fun typed(tag: String) = compose.onNodeWithTag(tag).fetchSemanticsNode().config[SemanticsProperties.EditableText].text

    @Test
    fun example_fillsBothSides_andClearEmptiesIt() {
        compose.waitUntil(5_000) { compose.onAllNodesWithTag(HomeTags.EXAMPLE).fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag(HomeTags.EXAMPLE).performClick()
        compose.waitForIdle()
        // The language another test picked may still be set.
        val book = (compose.activity.application as JudgeApp).container.examples
        val example = AppLang.entries.flatMap { book.load(it) }.first { it.a == typed(HomeTags.INPUT) }
        assertEquals(example.b, typed(HomeTags.OTHER))
        assertEquals(example.bName, typed(HomeTags.OTHER_NAME))
        assertEquals(example.aName, typed(HomeTags.NAME))

        compose.onNodeWithTag(HomeTags.CLEAR).performClick()
        compose.waitForIdle()
        assertEquals("", typed(HomeTags.INPUT))
        compose.onNodeWithTag(HomeTags.OTHER).assertDoesNotExist()
        compose.onNodeWithTag(HomeTags.NAME).assertDoesNotExist()
    }

    @Test
    fun appearance_isStored_andSetsTheSystemBars() {
        val settings = (compose.activity.application as JudgeApp).container.settings
        runBlocking { settings.setLangPref(LangPref.SYSTEM) }
        val en = UiTestSupport.s(AppLang.EN)
        awaitText(en.appHomeExample)
        goTo(en.appTabSettings, en.navTabs)
        compose.onNodeWithTag(SettingsTags.appearanceOption(Appearance.SYSTEM)).assertIsSelected()
        val window = compose.activity.window
        val bars = WindowCompat.getInsetsController(window, window.decorView)
        assertTrue(bars.isAppearanceLightStatusBars)
        try {
            compose.onNodeWithTag(SettingsTags.appearanceOption(Appearance.DARK)).performClick()
            compose.waitUntil(5_000) { runBlocking { settings.appearance.first() } == Appearance.DARK }
            compose.waitForIdle()
            compose.onNodeWithTag(SettingsTags.appearanceOption(Appearance.DARK)).assertIsSelected()
            assertFalse(bars.isAppearanceLightStatusBars)
        } finally {
            runBlocking { settings.setAppearance(Appearance.SYSTEM) }
        }
    }
}
