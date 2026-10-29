package com.okjudge.judge.ui.theme

import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

/**
 * One side's colours: [fill] for large areas, [strong] for thin marks that
 * need 3:1, [ink] for text and behind a paper letter, [tint] behind text.
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
        fun forViewer(you: String?, palette: JudgePalette): Sides {
            val green = SideColors(palette.sage, palette.sageStrong, palette.sageInk, palette.sageTint)
            val red = SideColors(palette.terra, palette.terra, palette.terraInk, palette.terraTint)
            return if (you == "b") Sides("b", red, green) else Sides("a", green, red)
        }
    }
}

/** Set by [JudgeTheme] and, for the respondent, by the case screens; everything else draws Party A green. */
val LocalSides = staticCompositionLocalOf { Sides.forViewer(null, LightPalette) }
