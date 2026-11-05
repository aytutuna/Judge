package com.okjudge.judge.ui

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TabBarTest {
    @Test
    fun hiddenWhileJudging() {
        assertFalse(showsTabBar(JudgingKey))
    }

    @Test
    fun hiddenOnSignInAndQuestions() {
        assertFalse(showsTabBar(SignInKey(thenVerdict = true)))
        assertFalse(showsTabBar(ClarifyKey))
    }

    @Test
    fun shownEverywhereElse() {
        for (key in listOf(HomeKey, HistoryKey, SettingsKey, PricingKey, CaseKey("c1"), VerdictKey("v1"))) {
            assertTrue(key.toString(), showsTabBar(key))
        }
    }
}
