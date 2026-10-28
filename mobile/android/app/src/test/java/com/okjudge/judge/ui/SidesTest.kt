package com.okjudge.judge.ui

import com.okjudge.judge.ui.theme.Palette
import com.okjudge.judge.ui.theme.Sides
import org.junit.Assert.assertEquals
import org.junit.Test

class SidesTest {
    @Test
    fun partyA_isGreen_unlessTheViewerIsB() {
        for (you in listOf(null, "a", "unknown")) {
            val sides = Sides.forViewer(you)
            assertEquals(Palette.sage, sides.a.fill)
            assertEquals(Palette.sageInk, sides.a.ink)
            assertEquals(Palette.terra, sides.b.fill)
            assertEquals(Palette.terraInk, sides.b.ink)
        }
        val b = Sides.forViewer("b")
        assertEquals(Palette.terra, b.a.fill)
        assertEquals(Palette.sageStrong, b.b.strong)
        assertEquals(Palette.sageTint, b.of("b").tint)
        assertEquals("b", b.you)
    }

    @Test
    fun mine_isAlwaysGreen() {
        for (you in listOf("a", "b")) {
            val sides = Sides.forViewer(you)
            assertEquals(Palette.sageInk, sides.mine.ink)
            assertEquals(Palette.terraInk, sides.theirs.ink)
        }
    }
}
