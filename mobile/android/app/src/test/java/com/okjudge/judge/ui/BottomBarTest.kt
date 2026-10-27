package com.okjudge.judge.ui

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class BottomBarTest {
    @Test
    fun hiddenOnTheThread() {
        assertFalse(showsBottomBar(JudgingKey))
        assertFalse(showsBottomBar(VerdictKey("v1", fresh = true)))
    }

    @Test
    fun hiddenOnSignInAndQuestions() {
        assertFalse(showsBottomBar(SignInKey(thenVerdict = true)))
        assertFalse(showsBottomBar(ClarifyKey))
    }

    @Test
    fun shownEverywhereElse() {
        for (key in listOf(HomeKey, HistoryKey, SettingsKey, PricingKey, CaseKey("c1"), VerdictKey("v1", fresh = false), VerdictKey("v1", fresh = false, fromHome = true))) {
            assertTrue(key.toString(), showsBottomBar(key))
        }
    }
}
