package com.okjudge.judge.core.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AppearanceTest {
    @Test
    fun fromStored_readsItsOwnValues_andFollowsThePhoneOtherwise() {
        for (a in Appearance.entries) assertEquals(a, Appearance.fromStored(a.stored))
        assertEquals(Appearance.SYSTEM, Appearance.fromStored(null))
        assertEquals(Appearance.SYSTEM, Appearance.fromStored("sepia"))
    }

    @Test
    fun isDark_onlyFollowsThePhoneForSystem() {
        assertTrue(Appearance.SYSTEM.isDark(systemDark = true))
        assertFalse(Appearance.SYSTEM.isDark(systemDark = false))
        assertFalse(Appearance.LIGHT.isDark(systemDark = true))
        assertTrue(Appearance.DARK.isDark(systemDark = false))
    }
}
