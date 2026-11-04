package com.okjudge.judge.ui

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class BottomBarTest {
    @Test
    fun hiddenWhileJudging() {
        assertFalse(showsBottomBar(JudgingKey))
    }

    @Test
    fun hiddenOnSignInAndQuestions() {
        assertFalse(showsBottomBar(SignInKey(thenVerdict = true)))
        assertFalse(showsBottomBar(ClarifyKey))
    }

    @Test
    fun shownEverywhereElse() {
        for (key in listOf(HomeKey, HistoryKey, SettingsKey, PricingKey, CaseKey("c1"), VerdictKey("v1"))) {
            assertTrue(key.toString(), showsBottomBar(key))
        }
    }
}
