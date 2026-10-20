package com.okjudge.judge.ui.theme

import androidx.compose.ui.graphics.Color

/**
 * Ivory & Terracotta (lib/palette.ts). A test compares these with
 * display-vectors.json, which is exported from lib/palette.ts.
 */
object Palette {
    val ivory = Color(0xFFF6F1E9)
    val ivory2 = Color(0xFFEEE6D9)
    val paper = Color(0xFFFFFCF7)
    val ink = Color(0xFF1C1916)
    val ink2 = Color(0xFF4A433C)
    val muted = Color(0xFF6B6258)
    val placeholder = Color(0xFF776D61)
    val terra = Color(0xFFC8553D)
    val terraInk = Color(0xFFA9442F)
    val terraTint = Color(0xFFF3DDD5)
    val sage = Color(0xFF8AA899)
    val sageStrong = Color(0xFF6E8F80)
    val sageInk = Color(0xFF4F6F60)
    val sageTint = Color(0xFFDDE7E0)
    val stone = Color(0xFFD6C7B0)
    val strata = Color(0xFFE6DCCB)
    val danger = Color(0xFFB3261E)

    val line = Color(28, 25, 22).copy(alpha = 0.09f)
    val line2 = Color(28, 25, 22).copy(alpha = 0.14f)
    val glass = Color(255, 252, 247).copy(alpha = 0.68f)

    /** verdict.module.css literals. */
    val bestPointBg = Color(0xFFFBF6EF)
    val mainTop = Color(0xFFFBF7F0)
    val mainBottom = Color(0xFFF7F1E7)
    val warmShadow = Color(0xFF3C2814)

    /** Opaque colours by lib/palette.ts key, for the drift test. */
    val byKey: Map<String, Color> = mapOf(
        "ivory" to ivory, "ivory2" to ivory2, "paper" to paper, "ink" to ink, "ink2" to ink2,
        "muted" to muted, "placeholder" to placeholder, "terra" to terra, "terraInk" to terraInk,
        "terraTint" to terraTint, "sage" to sage, "sageStrong" to sageStrong, "sageInk" to sageInk,
        "sageTint" to sageTint, "stone" to stone, "strata" to strata, "danger" to danger,
    )

    val alphaByKey: Map<String, Color> = mapOf("line" to line, "line2" to line2, "glass" to glass)
}
