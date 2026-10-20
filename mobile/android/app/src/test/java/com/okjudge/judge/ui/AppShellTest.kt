package com.okjudge.judge.ui

import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import com.okjudge.judge.MainActivity
import com.okjudge.judge.i18n.AppLang
import com.okjudge.judge.ui.history.HistoryTags
import com.okjudge.judge.ui.home.HomeTags
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** The real activity: splash, theme, Navigation 3 back stack, tabs and the language toggle. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], qualifiers = "en-rUS-w393dp-h852dp")
class AppShellTest {
    @get:Rule
    val compose = createAndroidComposeRule<MainActivity>()

    @Test
    fun tabs_andLanguageToggle() {
        val en = UiTestSupport.s(AppLang.EN)
        val tr = UiTestSupport.s(AppLang.TR)
        compose.waitUntil(5_000) { compose.onAllNodesWithText(en.heroTitleLine1).fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag(HomeTags.SUBMIT).assertExists()

        compose.onNodeWithText(en.appTabHistory).performClick()
        compose.waitUntil(5_000) { compose.onAllNodesWithText(en.appHistoryEmpty).fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag(HistoryTags.EMPTY).assertExists()

        compose.onNodeWithText(en.appTabSettings).performClick()
        compose.onNodeWithText(en.appSettingsLanguageDevice).assertExists()
        compose.onNodeWithText(tr.appLangTr).performClick()
        compose.waitUntil(5_000) { compose.onAllNodesWithText(tr.appTabSettings).fetchSemanticsNodes().isNotEmpty() }

        compose.onNodeWithText(tr.appTabNew).performClick()
        compose.waitUntil(5_000) { compose.onAllNodesWithText(tr.heroTitleLine1).fetchSemanticsNodes().isNotEmpty() }
    }
}
