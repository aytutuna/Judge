package com.okjudge.judge.ui.components

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.unit.dp
import com.okjudge.judge.ui.theme.Palette

/**
 * The web card's inline SVG icons, built from the same path data. Stroke
 * icons use `currentColor` on the web; here the colour is passed in.
 */
object JudgeIcons {
    private class P(val d: String, val fill: Color? = null, val stroke: Color? = null, val width: Float = 0f)

    private fun icon(name: String, view: Float, vararg paths: P): ImageVector =
        ImageVector.Builder(name, view.dp, view.dp, view, view).apply {
            for (p in paths) {
                addPath(
                    pathData = addPathNodes(p.d),
                    fill = p.fill?.let { SolidColor(it) },
                    stroke = p.stroke?.let { SolidColor(it) },
                    strokeLineWidth = p.width,
                    strokeLineCap = StrokeCap.Round,
                    strokeLineJoin = StrokeJoin.Round,
                )
            }
        }.build()

    fun check(color: Color = Color.White, width: Float = 2.2f) =
        icon("check", 16f, P("M3.5 8.4 6.6 11.4 12.6 4.9", stroke = color, width = width))

    fun levelBeam(color: Color = Color.White) = icon(
        "level", 16f,
        P("M2.5 6.5h11", stroke = color, width = 2f),
        P("M8 6.5 5.6 12.5h4.8z", fill = color),
    )

    fun shield(color: Color) =
        icon("shield", 16f, P("M8 1.8 13 3.6v4c0 3-2.2 5.4-5 6.6-2.8-1.2-5-3.6-5-6.6v-4z", stroke = color, width = 1.5f))

    fun alert(color: Color) = icon(
        "alert", 16f,
        P("M8 2 14.5 13.5h-13z", stroke = color, width = 1.5f),
        P("M8 6.5v3.2", stroke = color, width = 1.5f),
        P("M7.1 11.6a0.9 0.9 0 1 0 1.8 0a0.9 0.9 0 1 0 -1.8 0", fill = color),
    )

    fun share(color: Color) = icon(
        "share", 16f,
        P(
            "M8 10V2.5M5 5.2 8 2.2l3 3M4 8H3.5A1.5 1.5 0 0 0 2 9.5v3A1.5 1.5 0 0 0 3.5 14h9a1.5 1.5 0 0 0 1.5-1.5v-3A1.5 1.5 0 0 0 12.5 8H12",
            stroke = color, width = 1.5f,
        ),
    )

    fun link(color: Color) = icon(
        "link", 16f,
        P(
            "M6.5 9.5 9.5 6.5M7 4.5l1.2-1.2a2.5 2.5 0 0 1 3.5 3.5L10.5 8M9 11.5l-1.2 1.2a2.5 2.5 0 0 1-3.5-3.5L5.5 8",
            stroke = color, width = 1.5f,
        ),
    )

    val diamond = icon("diamond", 12f, P("M6 0.8 11.2 6 6 11.2 0.8 6z", fill = Palette.ink))

    val kindFact = icon(
        "fact", 12f,
        P("M6 .8 11 3.6v4.8L6 11.2 1 8.4V3.6z", fill = Palette.ink),
        P("M6 6v5.2M6 6 1 3.6M6 6l5-2.4", stroke = Palette.paper, width = 0.9f),
    )
    val kindValue = icon("value", 12f, P("M1 6a5 5 0 1 0 10 0a5 5 0 1 0 -10 0", fill = Palette.ink))
    val kindDefinition = icon("definition", 12f, P("M6 1.2 11.2 10.6H.8z", fill = Palette.ink))
    val kindLogic = icon("logic", 12f, P("M6 .8 11.2 6 6 11.2.8 6z", fill = Palette.ink))

    val factCheck = icon("factCheck", 10f, P("M2 5.3 4.1 7.3 8 2.9", stroke = Color.White, width = 1.6f))

    fun close(color: Color) = icon("close", 16f, P("M4 4l8 8M12 4l-8 8", stroke = color, width = 1.6f))

    fun plus(color: Color) = icon("plus", 16f, P("M8 3v10M3 8h10", stroke = color, width = 1.6f))

    fun list(color: Color) = icon("list", 16f, P("M5 4h8M5 8h8M5 12h8M2.5 4h.01M2.5 8h.01M2.5 12h.01", stroke = color, width = 1.6f))

    fun gear(color: Color) = icon(
        "gear", 16f,
        P("M5.5 8a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0 -5 0", stroke = color, width = 1.5f),
        P("M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4", stroke = color, width = 1.5f),
    )

    fun trash(color: Color) = icon(
        "trash", 16f,
        P("M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5", stroke = color, width = 1.4f),
    )

    fun back(color: Color) = icon("back", 16f, P("M10 3 5 8l5 5", stroke = color, width = 1.8f))

    /** Premium's four-point spark (PremiumSpark). */
    fun spark(color: Color) = icon("spark", 12f, P("M6 0.8 7.3 4.7 11.2 6 7.3 7.3 6 11.2 4.7 7.3 0.8 6 4.7 4.7z", fill = color))

    fun lock(color: Color) = icon(
        "lock", 12f,
        P("M3.8 5.3h4.4a1.3 1.3 0 0 1 1.3 1.3v2.6a1.3 1.3 0 0 1-1.3 1.3H3.8a1.3 1.3 0 0 1-1.3-1.3V6.6a1.3 1.3 0 0 1 1.3-1.3z", fill = color),
        P("M4.2 5.3V4a1.8 1.8 0 0 1 3.6 0v1.3", stroke = color, width = 1.3f),
    )

    fun image(color: Color) = icon(
        "image", 20f,
        P("M5 3.5h10a2.5 2.5 0 0 1 2.5 2.5v8a2.5 2.5 0 0 1-2.5 2.5H5A2.5 2.5 0 0 1 2.5 14V6A2.5 2.5 0 0 1 5 3.5z", stroke = color, width = 1.5f),
        P("M5.6 8a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0 -3.2 0", fill = color),
        P("m3.5 14.5 4.2-4 3 2.6 2.4-2 3.4 3.4", stroke = color, width = 1.5f),
    )

    /** Fact-check status glyphs (StatusGlyph in components/FactCheckList.tsx). */
    fun factStatus(status: String, color: Color): ImageVector? = when (status) {
        "supported" -> icon("supported", 12f, P("M2.5 6.3 5 8.6 9.6 3.6", stroke = color, width = 1.7f))
        "refuted" -> icon("refuted", 12f, P("M3.3 3.3l5.4 5.4M8.7 3.3 3.3 8.7", stroke = color, width = 1.7f))
        "mixed" -> icon("mixed", 12f, P("M2.8 6h6.4", stroke = color, width = 1.7f))
        "unverified" -> icon(
            "unverified", 12f,
            P("M4.4 4.4a1.7 1.7 0 1 1 2.4 1.5c-.5.3-.8.6-.8 1.2", stroke = color, width = 1.7f),
            P("M5.2 9.2a0.8 0.8 0 1 0 1.6 0a0.8 0.8 0 1 0 -1.6 0", fill = color),
        )
        else -> null
    }

    /** Appeal outcome glyphs (OutcomeGlyph in components/case/AppealOutcome.tsx). */
    fun appealOutcome(outcome: String, color: Color): ImageVector? = when (outcome) {
        "upheld" -> icon("upheld", 12f, P("M2.5 4.6h7M2.5 7.4h7", stroke = color, width = 1.7f))
        "overturned" -> icon("overturned", 12f, P("M2.5 4.5h6.5l-2-2M9.5 7.5H3l2 2", stroke = color, width = 1.7f))
        "changed" -> icon("changed", 12f, P("M2.5 6h7M6.5 3l3 3-3 3", stroke = color, width = 1.7f))
        else -> null
    }

    /** The decisive dispute's bolt (DecisiveGlyph). */
    fun bolt(color: Color) = icon("bolt", 12f, P("M6.6 1 2.5 7h3L5 11l4.5-6.2h-3z", fill = color))

    fun external(color: Color) = icon("external", 10f, P("M4 2h4v4M8 2 3 7", stroke = color, width = 1.4f))
}
