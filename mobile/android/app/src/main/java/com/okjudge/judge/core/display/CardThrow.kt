package com.okjudge.judge.core.display

import kotlin.math.hypot

/** How a dragged card is let go; the same numbers as lib/card-throw.ts (px and ms). */
object CardThrow {
    class Sample(val x: Float, val y: Float, val t: Long)

    const val DISTANCE = 110f
    const val SPEED = 0.7f
    const val FLICK_MIN_MOVE = 24f
    const val WINDOW_MS = 100L

    /** Release velocity in px/ms from the last [WINDOW_MS] of samples. */
    fun velocity(samples: List<Sample>): Pair<Float, Float> {
        val last = samples.lastOrNull() ?: return 0f to 0f
        val first = samples.first { last.t - it.t <= WINDOW_MS }
        val dt = last.t - first.t
        if (dt <= 0) return 0f to 0f
        return (last.x - first.x) / dt to (last.y - first.y) / dt
    }

    fun isThrow(dx: Float, dy: Float, vx: Float, vy: Float): Boolean {
        val moved = hypot(dx, dy)
        return moved >= DISTANCE || (moved >= FLICK_MIN_MOVE && hypot(vx, vy) >= SPEED)
    }

    /** Where a thrown card ends up, [reach] away from where it was let go. */
    fun target(dx: Float, dy: Float, vx: Float, vy: Float, reach: Float): Pair<Float, Float> {
        val fast = hypot(vx, vy) > 0.05f
        val ux = if (fast) vx else dx
        val uy = if (fast) vy else dy
        val len = hypot(ux, uy).takeIf { it > 0f } ?: 1f
        return dx + ux / len * reach to dy + uy / len * reach
    }
}
