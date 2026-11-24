package com.okjudge.judge.core.display

import com.okjudge.judge.core.display.CardThrow.Sample
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CardThrowTest {
    @Test
    fun velocityUsesTheLastHundredMilliseconds() {
        val (vx, vy) = CardThrow.velocity(
            listOf(Sample(0f, 0f, 0), Sample(100f, 0f, 380), Sample(120f, 10f, 420), Sample(160f, 30f, 500)),
        )
        assertEquals(0.5f, vx, 0.001f)
        assertEquals(0.25f, vy, 0.001f)
        assertEquals(0f to 0f, CardThrow.velocity(emptyList()))
    }

    @Test
    fun throwsOnDistanceOrSpeed() {
        assertTrue(CardThrow.isThrow(120f, 0f, 0f, 0f))
        assertFalse(CardThrow.isThrow(60f, 60f, 0f, 0f))
        assertTrue(CardThrow.isThrow(40f, 0f, 1f, 0f))
        assertFalse(CardThrow.isThrow(40f, 0f, 0.3f, 0f))
        assertFalse(CardThrow.isThrow(5f, 0f, 3f, 0f))
    }

    @Test
    fun targetFollowsTheVelocityThenTheDrag() {
        val (ux, uy) = CardThrow.target(10f, 0f, 0f, -2f, 1000f)
        assertEquals(10f, ux, 0.001f)
        assertEquals(-1000f, uy, 0.001f)
        val (sx, sy) = CardThrow.target(30f, 40f, 0f, 0f, 100f)
        assertEquals(90f, sx, 0.001f)
        assertEquals(120f, sy, 0.001f)
    }
}
