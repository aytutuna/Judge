package com.okjudge.judge.ui

import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import com.okjudge.judge.MainActivity
import com.okjudge.judge.i18n.AppLang
import com.okjudge.judge.ui.components.TopBarTags
import com.okjudge.judge.ui.history.HistoryTags
import com.okjudge.judge.ui.home.HomeTags
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
        awaitText(en.appHomeTitle)
        compose.onNodeWithTag(HomeTags.SUBMIT).assertExists()

        compose.onNodeWithText(en.appTabHistory).performClick()
        awaitText(en.appHistoryEmpty)
        compose.onNodeWithTag(HistoryTags.EMPTY).assertExists()

        compose.onNodeWithText(en.appTabSettings).performClick()
        compose.onNodeWithText(en.appSettingsLanguageDevice).assertExists()
        compose.onNodeWithText(tr.appLangTr).performClick()
        awaitText(tr.appTabSettings)

        compose.onNodeWithText(tr.appTabNew).performClick()
        awaitText(tr.appHomeTitle)
    }

    @Test
    fun newButton_clearsTheDraft_andComesBackFromOtherTabs() {
        val en = UiTestSupport.s(AppLang.EN)
        awaitText(en.appHomeTitle)
        compose.onNodeWithTag(TopBarTags.NEW).assertDoesNotExist()
        compose.onNodeWithTag(HomeTags.INPUT).performTextInput("My roommate never does the dishes")
        compose.onNodeWithTag(TopBarTags.NEW).performClick()
        compose.waitForIdle()
        compose.onNodeWithTag(HomeTags.COUNTER).assertDoesNotExist()
        compose.onNodeWithTag(TopBarTags.NEW).assertDoesNotExist()

        compose.onNodeWithText(en.appTabHistory).performClick()
        awaitText(en.appHistoryEmpty)
        compose.onNodeWithTag(TopBarTags.NEW).performClick()
        awaitText(en.appHomeTitle)
        compose.onNodeWithTag(HistoryTags.EMPTY).assertDoesNotExist()
    }
}
