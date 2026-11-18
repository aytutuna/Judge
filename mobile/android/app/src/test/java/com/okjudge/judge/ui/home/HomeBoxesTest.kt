package com.okjudge.judge.ui.home

import androidx.compose.ui.geometry.Offset
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class HomeBoxesTest {
    @Test
    fun shortBoxes_listsTheBoxesUnderTwentyTrimmedCharacters() {
        val long = "Sam says a hot dog is a sandwich."
        assertEquals(listOf(1, 3), SendFlash.shortBoxes(listOf(long, "   too short   ", long, "")))
        assertEquals(emptyList<Int>(), SendFlash.shortBoxes(listOf(long, long)))
    }

    @Test
    fun steps_areTwoPulses_orOneLongFlashWhenMotionIsReduced() {
        assertEquals(
            listOf(SendFlash.Step(true, 350), SendFlash.Step(false, 200), SendFlash.Step(true, 350), SendFlash.Step(false, 200)),
            SendFlash.steps(false),
        )
        assertEquals(listOf(SendFlash.Step(true, 900), SendFlash.Step(false, 0)), SendFlash.steps(true))
    }

    @Test
    fun aBoxPulledFarOrFlungFlies_aSmallSlowOneSpringsBack() {
        assertNull(BoxThrow.direction(Offset(10f, 20f), Offset(0f, 100f)))
        assertNull(BoxThrow.direction(Offset.Zero, Offset.Zero))
        val far = BoxThrow.direction(Offset(0f, 120f), Offset.Zero)
        assertNotNull(far)
        assertTrue(far!!.y > 0f)
        val flung = BoxThrow.direction(Offset(0f, 20f), Offset(0f, 2000f))
        assertNotNull(flung)
        assertTrue(flung!!.y > 0f)
        val away = BoxThrow.direction(Offset(-100f, 0f), Offset.Zero)
        assertTrue(away!!.x < 0f)
    }
}
