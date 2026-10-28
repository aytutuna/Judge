package com.okjudge.judge.ui.theme

import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

/**
 * One side's colours: [fill] for large areas, [strong] for thin marks that
 * need 3:1, [ink] for text and behind a white letter, [tint] behind text.
 */
@Immutable
data class SideColors(val fill: Color, val strong: Color, val ink: Color, val tint: Color)

/**
 * The viewer's own side green, the other red (sideColors in lib/palette.ts).
 * [you] is the viewer's party, "a" or "b". Only the other side of a
 * two-sided case is "b": the writer of a one-person verdict wrote Party A as
 * themselves, and when nobody is known Party A is whoever started it.
 */
@Immutable
class Sides private constructor(val you: String, val a: SideColors, val b: SideColors) {
    fun of(party: String): SideColors = if (party == "b") b else a

    val mine: SideColors get() = of(you)
    val theirs: SideColors get() = if (you == "b") a else b

    companion object {
        private val GREEN = SideColors(Palette.sage, Palette.sageStrong, Palette.sageInk, Palette.sageTint)
        private val RED = SideColors(Palette.terra, Palette.terra, Palette.terraInk, Palette.terraTint)

        val A = Sides("a", GREEN, RED)
        val B = Sides("b", RED, GREEN)

        fun forViewer(you: String?): Sides = if (you == "b") B else A
    }
}

/** Set by the case screens for the respondent; everything else draws Party A green. */
val LocalSides = staticCompositionLocalOf { Sides.A }
