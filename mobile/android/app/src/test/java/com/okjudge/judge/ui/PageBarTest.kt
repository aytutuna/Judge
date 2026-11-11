package com.okjudge.judge.ui

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PageBarTest {
    @Test
    fun hiddenWhileJudging() {
        assertFalse(showsPageBar(JudgingKey))
    }

    @Test
    fun hiddenOnSignInAndQuestions() {
        assertFalse(showsPageBar(SignInKey(thenVerdict = true)))
        assertFalse(showsPageBar(ClarifyKey))
    }

    @Test
    fun hiddenOnPushedPages() {
        for (key in listOf(PricingKey, CaseKey("c1"), VerdictKey("v1"))) {
            assertFalse(key.toString(), showsPageBar(key))
        }
    }

    @Test
    fun shownOnTheTwoMainPages() {
        for (key in listOf(HomeKey, SettingsKey)) {
            assertTrue(key.toString(), showsPageBar(key))
        }
    }
}
