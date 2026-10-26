package com.okjudge.judge.ui.theme

import androidx.compose.material3.Typography
import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.ExperimentalTextApi
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.okjudge.judge.R

/**
 * Brand faces (all OFL, bundled from google/fonts): variable Inter (wght +
 * opsz), variable Inter Tight (wght) and Instrument Serif. Android does not
 * apply optical size automatically, so each style picks an `opsz` close to
 * its size, clamped to Inter's 14..32 range.
 */
@OptIn(ExperimentalTextApi::class)
object BrandFonts {
    private val cache = HashMap<String, FontFamily>()

    fun inter(weight: Int, opsz: Float): FontFamily = cache.getOrPut("inter-$weight-$opsz") {
        FontFamily(
            Font(
                R.font.inter,
                weight = FontWeight(weight),
                variationSettings = FontVariation.Settings(
                    FontVariation.weight(weight),
                    FontVariation.Setting("opsz", opsz.coerceIn(14f, 32f)),
                ),
            ),
        )
    }

    fun interTight(weight: Int): FontFamily = cache.getOrPut("tight-$weight") {
        FontFamily(
            Font(
                R.font.inter_tight,
                weight = FontWeight(weight),
                variationSettings = FontVariation.Settings(FontVariation.weight(weight)),
            ),
        )
    }

    val serif: FontFamily by lazy {
        FontFamily(
            Font(R.font.instrument_serif, FontWeight.Normal, FontStyle.Normal),
            Font(R.font.instrument_serif_italic, FontWeight.Normal, FontStyle.Italic),
        )
    }
}

/** The type scale of the design doc (8.2). */
object JudgeType {
    private fun inter(size: Float, weight: Int, lineHeight: Float, color: androidx.compose.ui.graphics.Color = Palette.ink) =
        TextStyle(
            fontFamily = BrandFonts.inter(weight, size),
            fontWeight = FontWeight(weight),
            fontSize = size.sp,
            lineHeight = (size * lineHeight).sp,
            color = color,
        )

    val display1 = TextStyle(
        fontFamily = BrandFonts.interTight(700),
        fontWeight = FontWeight.Bold,
        fontSize = 44.sp,
        lineHeight = (44 * 0.98).sp,
        letterSpacing = (-0.04).em,
        color = Palette.ink,
    )

    val verdictLabel = TextStyle(
        fontFamily = BrandFonts.interTight(800),
        fontWeight = FontWeight.ExtraBold,
        fontSize = 36.sp,
        lineHeight = 36.sp,
        letterSpacing = (-0.04).em,
        color = Palette.ink,
    )

    val verdictLabelLong = verdictLabel.copy(fontSize = 28.sp, lineHeight = (28 * 1.04).sp, letterSpacing = (-0.035).em)

    /** The case card's "State your case." (thread.module.css .title). */
    val caseTitle = TextStyle(
        fontFamily = BrandFonts.serif,
        fontWeight = FontWeight.Normal,
        fontSize = 36.sp,
        lineHeight = (36 * 1.05).sp,
        letterSpacing = (-0.01).em,
        color = Palette.ink,
    )

    /** The verdict headline (verdict.module.css .ruling); the card picks 30..34 sp by width. */
    val ruling = caseTitle.copy(fontSize = 32.sp, lineHeight = (32 * 1.05).sp, letterSpacing = 0.em)

    /** Italic serif labels: the card's date and the verdict's section labels. */
    val serifLabel = TextStyle(
        fontFamily = BrandFonts.serif,
        fontStyle = FontStyle.Italic,
        fontWeight = FontWeight.Normal,
        fontSize = 16.sp,
        lineHeight = 20.sp,
        color = Palette.muted,
    )

    val headline = inter(15.5f, 400, 1.45f, Palette.ink2)
    val lead = inter(17f, 400, 1.5f, Palette.ink2)
    val body = inter(16f, 400, 1.5f)
    val bodyStrong = inter(16f, 600, 1.5f)
    val slotTitle = inter(14f, 600, 1.4f)
    val slotText = inter(13f, 400, 1.45f, Palette.muted)
    val footnote = inter(12.5f, 400, 1.5f, Palette.muted)
    val branch = inter(14.5f, 400, 1.5f)
    val branchLead = inter(14.5f, 600, 1.5f)
    val small = inter(13f, 600, 1.35f, Palette.ink2)
    val sectionTitle = TextStyle(
        fontFamily = BrandFonts.interTight(700),
        fontWeight = FontWeight.Bold,
        fontSize = 20.sp,
        lineHeight = 24.sp,
        letterSpacing = (-0.02).em,
        color = Palette.ink,
    )

    val micro = TextStyle(
        fontFamily = BrandFonts.inter(700, 14f),
        fontWeight = FontWeight.Bold,
        fontSize = 11.sp,
        lineHeight = (11 * 1.3).sp,
        letterSpacing = 0.12.em,
        color = Palette.muted,
    )

    val button = TextStyle(
        fontFamily = BrandFonts.interTight(600),
        fontWeight = FontWeight.SemiBold,
        fontSize = 16.sp,
        lineHeight = 20.sp,
        color = Palette.ivory,
    )

    val brandTag = TextStyle(
        fontFamily = BrandFonts.interTight(600),
        fontWeight = FontWeight.SemiBold,
        fontSize = 13.sp,
        lineHeight = 13.sp,
        letterSpacing = (-0.01).em,
        color = Palette.muted,
    )

    val material = Typography(
        displayLarge = display1,
        headlineMedium = sectionTitle,
        titleLarge = sectionTitle,
        titleMedium = inter(16f, 600, 1.4f),
        titleSmall = slotTitle,
        bodyLarge = body,
        bodyMedium = inter(14f, 400, 1.45f),
        bodySmall = slotText,
        labelLarge = button.copy(color = Palette.ink),
        labelMedium = inter(12f, 600, 1.3f),
        labelSmall = micro,
    )
}

/**
 * Display sizes follow the user's font scale up to 1.3x, so the hero and the
 * verdict label never take over the screen.
 */
@Composable
@ReadOnlyComposable
fun TextStyle.cappedScale(max: Float = 1.3f): TextStyle {
    val scale = LocalDensity.current.fontScale
    if (scale <= max) return this
    val factor = max / scale
    fun TextUnit.scaled(): TextUnit = if (this == TextUnit.Unspecified || !isSp) this else (value * factor).sp
    return copy(fontSize = fontSize.scaled(), lineHeight = lineHeight.scaled())
}
