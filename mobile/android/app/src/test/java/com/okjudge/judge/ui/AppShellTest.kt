package com.okjudge.judge.ui

import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.semantics.SemanticsProperties
import com.okjudge.judge.MainActivity
import com.okjudge.judge.core.display.Examples
import com.okjudge.judge.i18n.AppLang
import com.okjudge.judge.i18n.LangPref
import com.okjudge.judge.ui.components.TopBarTags
import com.okjudge.judge.ui.history.HistoryTags
import com.okjudge.judge.ui.home.HomeTags
import com.okjudge.judge.ui.settings.SettingsTags
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** The real activity: splash, theme, Navigation 3 back stack, tabs, the "+" and the language setting. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], qualifiers = "en-rUS-w393dp-h852dp")
class AppShellTest {
    @get:Rule
    val compose = createAndroidComposeRule<MainActivity>()

    private fun awaitText(text: String) =
        compose.waitUntil(5_000) { compose.onAllNodesWithText(text).fetchSemanticsNodes().isNotEmpty() }

    @Test
    fun tabs_andLanguageToggle() {
        val en = UiTestSupport.s(AppLang.EN)
        val tr = UiTestSupport.s(AppLang.TR)
        awaitText(en.appHomeExample)
        compose.onNodeWithTag(HomeTags.SUBMIT).assertExists()

        compose.onNodeWithText(en.appTabHistory).performClick()
        awaitText(en.appHistoryEmpty)
        compose.onNodeWithTag(HistoryTags.EMPTY).assertExists()

        compose.onNodeWithText(en.appTabSettings).performClick()
        compose.onNodeWithTag(SettingsTags.LANGUAGE).assertTextContains(en.appSettingsLanguageDevice).performClick()
        compose.onNodeWithTag(SettingsTags.langOption(LangPref(AppLang.TR))).performClick()
        awaitText(tr.appTabSettings)
        compose.onNodeWithTag(SettingsTags.LANGUAGE).assertTextContains("Türkçe")

        compose.onNodeWithText(tr.appTabNew).performClick()
        awaitText(tr.appHomeExample)
    }

    @Test
    fun newButton_clearsTheDraft_andComesBackFromOtherTabs() {
        val en = UiTestSupport.s(AppLang.EN)
        awaitText(en.appHomeExample)
        compose.onNodeWithTag(TopBarTags.NEW).assertDoesNotExist()
        compose.onNodeWithTag(HomeTags.INPUT).performTextInput("My roommate never does the dishes")
        compose.onNodeWithTag(TopBarTags.NEW).performClick()
        compose.waitForIdle()
        compose.onNodeWithTag(HomeTags.COUNTER).assertDoesNotExist()
        compose.onNodeWithTag(TopBarTags.NEW).assertDoesNotExist()

        compose.onNodeWithText(en.appTabHistory).performClick()
        awaitText(en.appHistoryEmpty)
        compose.onNodeWithTag(TopBarTags.NEW).performClick()
        awaitText(en.appHomeExample)
        compose.onNodeWithTag(HistoryTags.EMPTY).assertDoesNotExist()
    }

    private fun typed(tag: String) = compose.onNodeWithTag(tag).fetchSemanticsNode().config[SemanticsProperties.EditableText].text

    @Test
    fun example_fillsBothSides_andTheNewButtonClearsIt() {
        compose.waitUntil(5_000) { compose.onAllNodesWithTag(HomeTags.EXAMPLE).fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag(HomeTags.INPUT).performTextInput("My roommate never does the dishes")
        compose.onNodeWithTag(HomeTags.EXAMPLE).performClick()
        compose.waitForIdle()
        // The language another test picked may still be set.
        val all = AppLang.entries.flatMap { lang -> Examples.ids.map { Examples.of(it, UiTestSupport.s(lang)) } }
        val example = all.single { it.mine == typed(HomeTags.INPUT) }
        assertEquals(example.theirs, typed(HomeTags.OTHER))
        assertEquals(example.theirName, typed(HomeTags.OTHER_NAME))
        assertEquals(example.myName, typed(HomeTags.NAME))

        compose.onNodeWithTag(TopBarTags.NEW).performClick()
        compose.waitForIdle()
        assertEquals("", typed(HomeTags.INPUT))
        assertEquals("", typed(HomeTags.OTHER))
        assertEquals("", typed(HomeTags.NAME))
    }
}
