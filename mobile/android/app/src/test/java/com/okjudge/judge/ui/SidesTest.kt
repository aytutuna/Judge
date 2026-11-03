package com.okjudge.judge.ui

import com.okjudge.judge.ui.theme.DarkPalette
import com.okjudge.judge.ui.theme.LightPalette
import com.okjudge.judge.ui.theme.Sides
import org.junit.Assert.assertEquals
import org.junit.Test

class SidesTest {
    private val p = LightPalette

    @Test
    fun partyA_isGreen_unlessTheViewerIsB() {
        for (you in listOf(null, "a", "unknown")) {
            val sides = Sides.forViewer(you, p)
            assertEquals(p.sage, sides.a.fill)
            assertEquals(p.sageInk, sides.a.ink)
            assertEquals(p.terra, sides.b.fill)
            assertEquals(p.terraInk, sides.b.ink)
        }
        val b = Sides.forViewer("b", p)
        assertEquals(p.terra, b.a.fill)
        assertEquals(p.sageStrong, b.b.strong)
        assertEquals(p.sageTint, b.of("b").tint)
        assertEquals("b", b.you)
    }

    @Test
    fun mine_isAlwaysGreen() {
        for (you in listOf("a", "b")) {
            val sides = Sides.forViewer(you, p)
            assertEquals(p.sageInk, sides.mine.ink)
            assertEquals(p.terraInk, sides.theirs.ink)
        }
    }

    @Test
    fun dark_usesTheDarkInks() {
        val sides = Sides.forViewer("b", DarkPalette)
        assertEquals(DarkPalette.sageInk, sides.mine.ink)
        assertEquals(DarkPalette.terraTint, sides.theirs.tint)
        assertEquals(DarkPalette.sage, sides.b.fill)
    }
}
