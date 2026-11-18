package com.okjudge.judge.ui.home

import androidx.compose.ui.geometry.Offset
import com.okjudge.judge.core.display.ArgumentRules
import com.okjudge.judge.core.display.jsTrim

/** Which boxes light up when Send is tapped too early, and for how long. Same timing as the web and iOS. */
object SendFlash {
    data class Step(val lit: Boolean, val ms: Long)

    /** The boxes (by index, A first) whose text is too short to judge. */
    fun shortBoxes(texts: List<String>): List<Int> = texts.indices.filter { texts[it].jsTrim().length < ArgumentRules.MIN }

    /** Two pulses, 350 ms lit and 200 ms dark; one steady 900 ms flash when motion is reduced. */
    fun steps(reducedMotion: Boolean): List<Step> =
        if (reducedMotion) {
            listOf(Step(true, 900), Step(false, 0))
        } else {
            listOf(Step(true, 350), Step(false, 200), Step(true, 350), Step(false, 200))
        }
}

/** When a lifted box that is dragged and let go flies off instead of springing back. */
object BoxThrow {
    /** Pulled this far (dp), or about to travel [SPEED] with the speed it has, and it goes. */
    const val DISTANCE = 90f
    const val SPEED = 360f

    /** How far ahead (seconds) the finger's speed is carried, standing in for the predicted end of a fling. */
    private const val LOOKAHEAD = 0.25f

    /** Where the box would end up (dp), had the finger kept its speed a little longer. */
    fun predicted(translation: Offset, velocityDpPerSec: Offset): Offset = translation + velocityDpPerSec * LOOKAHEAD

    /** The direction to fly in (translation or, with speed, the predicted end), or null to spring back. */
    fun direction(translation: Offset, velocityDpPerSec: Offset): Offset? {
        val ahead = predicted(translation, velocityDpPerSec)
        if (translation.getDistance() <= DISTANCE && ahead.getDistance() <= SPEED) return null
        return when {
            ahead.getDistance() > 0f -> ahead
            translation.getDistance() > 0f -> translation
            else -> null
        }
    }
}
