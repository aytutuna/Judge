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
 * The viewer's own side green, the other red (sideColors in lib/palette.ts). Sides C and D of a case
 * with more than two sides are blue and violet; whoever is looking is still green, and their letter's
 * usual colour moves to Party A, as Party B's does in a two-sided case. [you] is the viewer's party,
 * "a" to "d". Only the other side of a two-sided case is "b": the writer of a one-person verdict wrote
 * Party A as themselves, and when nobody is known Party A is whoever started it.
 */
@Immutable
class Sides private constructor(
    val you: String,
    val a: SideColors,
    val b: SideColors,
    val c: SideColors,
    val d: SideColors,
) {
    /** A party this build does not know gets a neutral colour, never Party A's. */
    fun of(party: String): SideColors = when (party) {
        "a" -> a
        "b" -> b
        "c" -> c
        "d" -> d
        else -> neutral
    }

    private val neutral = SideColors(b.fill.copy(alpha = 0.4f), b.strong, b.ink, b.tint)

    val mine: SideColors get() = of(you)
    val theirs: SideColors get() = if (you == "b") a else b

    companion object {
        fun forViewer(you: String?, palette: JudgePalette): Sides {
            val green = SideColors(palette.sage, palette.sageStrong, palette.sageInk, palette.sageTint)
            val red = SideColors(palette.terra, palette.terra, palette.terraInk, palette.terraTint)
            val blue = if (palette.dark) SideColors(Color(0xFF5C97DB), Color(0xFF5C97DB), Color(0xFF9CC2F2), Color(0xFF1F3047))
            else SideColors(Color(0xFF3F7CC4), Color(0xFF3F7CC4), Color(0xFF2B5F9E), Color(0xFFDDE8F6))
            val violet = if (palette.dark) SideColors(Color(0xFFA07FD6), Color(0xFFA07FD6), Color(0xFFC9ADF0), Color(0xFF31264A))
            else SideColors(Color(0xFF8B63C4), Color(0xFF8B63C4), Color(0xFF6B459F), Color(0xFFE9DFF5))
            return when (you) {
                "b" -> Sides("b", red, green, blue, violet)
                "c" -> Sides("c", blue, red, green, violet)
                "d" -> Sides("d", violet, red, blue, green)
                else -> Sides("a", green, red, blue, violet)
            }
        }
    }
}

/** Set by [JudgeTheme] and, for the respondent, by the case screens; everything else draws Party A green. */
val LocalSides = staticCompositionLocalOf { Sides.forViewer(null, LightPalette) }
