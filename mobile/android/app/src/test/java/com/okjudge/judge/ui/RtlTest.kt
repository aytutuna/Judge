package com.okjudge.judge.ui

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.test.getBoundsInRoot
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.unit.LayoutDirection
import com.okjudge.judge.Fixtures
import com.okjudge.judge.i18n.AppLang
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** Arabic, Hebrew and Urdu run right to left; the two sides of a verdict do not swap. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class RtlTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun onlyArabicHebrewAndUrdu_runRightToLeft() {
        assertEquals(listOf(AppLang.AR, AppLang.HE, AppLang.UR), AppLang.entries.filter { it.rtl })
        assertEquals(false, AppLang.AR.tracking)
        assertEquals(false, AppLang.HI.tracking)
        assertEquals(true, AppLang.RU.tracking)
    }

    @Test
    fun arabicVerdict_runsRightToLeft_withPartyAStillOnTheLeft() {
        var direction: LayoutDirection? = null
        compose.setContent {
            Themed(AppLang.AR) {
                direction = LocalLayoutDirection.current
                SampleVerdict(Fixtures.sample("win_b_named"), AppLang.AR, modifier = Modifier.fillMaxWidth().verticalScroll(rememberScrollState()), summary = true)
            }
        }
        compose.waitForIdle()
        assertEquals(LayoutDirection.Rtl, direction)
        val a = compose.onAllNodesWithText("Alex").onFirst().getBoundsInRoot()
        val b = compose.onAllNodesWithText("Jordan").onFirst().getBoundsInRoot()
        assertTrue("Alex at ${a.left}, Jordan at ${b.left}", a.left < b.left)
    }
}
