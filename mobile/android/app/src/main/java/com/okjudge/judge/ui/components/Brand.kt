package com.okjudge.judge.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.okjudge.judge.ui.theme.Palette

/** The Judge mark (components/BrandMark.tsx): 28:20, tipped toward the terracotta sphere. */
@Composable
fun BrandMark(width: Dp, modifier: Modifier = Modifier) {
    Canvas(modifier.size(width, width * 20f / 28f)) {
        val k = size.width / 28f
        scale(k, k, pivot = Offset.Zero) {
            drawLine(Palette.ink, Offset(2.5f, 12.6f), Offset(25.5f, 9.4f), strokeWidth = 2f, cap = StrokeCap.Round)
            drawCircle(Palette.terra, radius = 3.9f, center = Offset(6.4f, 8.1f))
            drawCircle(Palette.sage, radius = 3.9f, center = Offset(21.6f, 6f))
            drawPath(triangle(14f, 11.4f, 10.6f, 18.6f, 17.4f, 18.6f), Palette.ink)
        }
    }
}

/**
 * The judging balance: the mark redrawn as a level beam on the ink pivot,
 * Party A (terracotta) on the left and Party B (sage) on the right. `angle`
 * is clockwise-positive degrees, so a negative angle drops Party A's end.
 */
@Composable
fun Balance(angle: Float, modifier: Modifier = Modifier) {
    Canvas(modifier) {
        // Design space 120 x 80; the pivot apex sits at (60, 44).
        val k = minOf(size.width / 120f, size.height / 80f)
        val dx = (size.width - 120f * k) / 2f
        val dy = (size.height - 80f * k) / 2f
        translate(dx, dy) {
            scale(k, k, pivot = Offset.Zero) { drawBalance(angle) }
        }
    }
}

private fun DrawScope.drawBalance(angle: Float) {
    val pivot = Offset(60f, 44f)
    // Base and pivot.
    drawPath(triangle(60f, 44f, 47f, 72f, 73f, 72f), Palette.ink)
    drawLine(Palette.ink, Offset(40f, 74f), Offset(80f, 74f), strokeWidth = 3f, cap = StrokeCap.Round)
    rotate(angle, pivot) {
        drawLine(Palette.ink, Offset(10f, 44f), Offset(110f, 44f), strokeWidth = 5f, cap = StrokeCap.Round)
        drawCircle(Palette.terra, radius = 13f, center = Offset(22f, 30f))
        drawCircle(Palette.sage, radius = 13f, center = Offset(98f, 30f))
        drawCircle(Palette.paper, radius = 2.4f, center = pivot)
    }
}

internal fun triangle(x1: Float, y1: Float, x2: Float, y2: Float, x3: Float, y3: Float) = Path().apply {
    moveTo(x1, y1)
    lineTo(x2, y2)
    lineTo(x3, y3)
    close()
}

/** The warm card shadow (globals.css --shadow-card). */
fun Modifier.warmShadow(elevation: Dp, shape: Shape): Modifier =
    shadow(elevation, shape, clip = false, ambientColor = Palette.warmShadow, spotColor = Palette.warmShadow)

val CardElevation = 10.dp
