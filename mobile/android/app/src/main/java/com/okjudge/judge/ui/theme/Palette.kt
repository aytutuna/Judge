package com.okjudge.judge.ui.theme

import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

/**
 * Ivory & Terracotta (lib/palette.ts), light and dark. A test compares the
 * light set with display-vectors.json, which is exported from lib/palette.ts.
 */
@Immutable
class JudgePalette(
    val dark: Boolean,
    val ivory: Color,
    val ivory2: Color,
    val paper: Color,
    val ink: Color,
    val ink2: Color,
    val muted: Color,
    val placeholder: Color,
    val terra: Color,
    val terraInk: Color,
    val terraTint: Color,
    val sage: Color,
    val sageStrong: Color,
    val sageInk: Color,
    val sageTint: Color,
    val stone: Color,
    val strata: Color,
    val danger: Color,
    val line: Color,
    val line2: Color,
    val glass: Color,
    // --well: a fill sunk into a paper card. Page and paper are both white in
    // light, so it can't be the page colour there.
    val well: Color,
    // verdict.module.css: paper mixed into the well, and the well.
    val bestPointBg: Color,
    val mainTop: Color,
    val mainBottom: Color,
    val warmShadow: Color,
) {
    /** Opaque colours by lib/palette.ts key, for the drift test. */
    val byKey: Map<String, Color>
        get() = mapOf(
            "ivory" to ivory, "ivory2" to ivory2, "paper" to paper, "ink" to ink, "ink2" to ink2,
            "muted" to muted, "placeholder" to placeholder, "terra" to terra, "terraInk" to terraInk,
            "terraTint" to terraTint, "sage" to sage, "sageStrong" to sageStrong, "sageInk" to sageInk,
            "sageTint" to sageTint, "stone" to stone, "strata" to strata, "danger" to danger,
        )

    val alphaByKey: Map<String, Color>
        get() = mapOf("line" to line, "line2" to line2, "glass" to glass)
}

val LightPalette = JudgePalette(
    dark = false,
    ivory = Color(0xFFFFFFFF),
    ivory2 = Color(0xFFF2F0EC),
    paper = Color(0xFFFFFFFF),
    ink = Color(0xFF1C1916),
    ink2 = Color(0xFF4A433C),
    muted = Color(0xFF6B6258),
    placeholder = Color(0xFF776D61),
    terra = Color(0xFFC8553D),
    terraInk = Color(0xFFA9442F),
    terraTint = Color(0xFFF3DDD5),
    sage = Color(0xFF8AA899),
    sageStrong = Color(0xFF6E8F80),
    sageInk = Color(0xFF4C6B5D),
    sageTint = Color(0xFFDDE7E0),
    stone = Color(0xFFDAD6CF),
    strata = Color(0xFFE9E6E1),
    danger = Color(0xFFB3261E),
    line = Color(28, 25, 22).copy(alpha = 0.1f),
    line2 = Color(28, 25, 22).copy(alpha = 0.14f),
    glass = Color(255, 255, 255).copy(alpha = 0.68f),
    well = Color(0xFFF2F0EC),
    bestPointBg = Color(0xFFF9F8F6),
    mainTop = Color(0xFFF9F8F6),
    mainBottom = Color(0xFFF2F0EC),
    warmShadow = Color(0xFF3C2814),
)

// TODO: check these against PALETTE_DARK too once export-fixtures writes it.
val DarkPalette = JudgePalette(
    dark = true,
    ivory = Color(0xFF15120F),
    ivory2 = Color(0xFF27231F),
    paper = Color(0xFF1D1A17),
    ink = Color(0xFFF1EBE1),
    ink2 = Color(0xFFCFC6BA),
    muted = Color(0xFFA89E92),
    placeholder = Color(0xFF9A9084),
    terra = Color(0xFFD9694F),
    terraInk = Color(0xFFEE8C74),
    terraTint = Color(0xFF432A22),
    sage = Color(0xFF7F9C8E),
    sageStrong = Color(0xFF8FB0A0),
    sageInk = Color(0xFFA3C2B3),
    sageTint = Color(0xFF2D3832),
    stone = Color(0xFF4F463C),
    strata = Color(0xFF3A342E),
    danger = Color(0xFFF5727E),
    line = Color(241, 235, 225).copy(alpha = 0.1f),
    line2 = Color(241, 235, 225).copy(alpha = 0.16f),
    glass = Color(29, 26, 23).copy(alpha = 0.72f),
    well = Color(0xFF15120F),
    bestPointBg = Color(0xFF191613),
    mainTop = Color(0xFF191613),
    mainBottom = Color(0xFF15120F),
    warmShadow = Color.Black,
)

val LocalPalette = staticCompositionLocalOf { LightPalette }

/** The current theme's palette, provided by [JudgeTheme]. */
val Palette: JudgePalette
    @Composable
    @ReadOnlyComposable
    get() = LocalPalette.current
