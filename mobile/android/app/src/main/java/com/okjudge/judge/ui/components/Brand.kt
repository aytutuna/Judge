package com.okjudge.judge.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.okjudge.judge.R
import com.okjudge.judge.ui.theme.LocalSides
import com.okjudge.judge.ui.theme.Palette
import com.okjudge.judge.ui.theme.Sides

/** The app icon's 3D mark; the art follows the app's own light or dark, not the system's. Decorative. */
@Composable
fun BrandLogo(size: Dp, modifier: Modifier = Modifier) {
    Image(
        painterResource(if (Palette.dark) R.drawable.brand_logo_dark else R.drawable.brand_logo_light),
        contentDescription = null,
        modifier = modifier.size(size),
        filterQuality = FilterQuality.High,
    )
}

/**
 * The judging balance: a level beam on the ink pivot,
 * Party A on the left and Party B on the right, in the side colours
 * ([LocalSides]). `angle` is clockwise-positive degrees, so a negative angle
 * drops Party A's end.
 */
@Composable
fun Balance(angle: Float, modifier: Modifier = Modifier) {
    val sides = LocalSides.current
    // Like the scene (--scene-beam), the dark beam is ink-2 rather than the near-white ink.
    val beam = if (Palette.dark) Palette.ink2 else Palette.ink
    val pin = Palette.paper
    Canvas(modifier) {
        // Design space 120 x 80; the pivot apex sits at (60, 44).
        val k = minOf(size.width / 120f, size.height / 80f)
        val dx = (size.width - 120f * k) / 2f
        val dy = (size.height - 80f * k) / 2f
        translate(dx, dy) {
            scale(k, k, pivot = Offset.Zero) { drawBalance(angle, sides, beam, pin) }
        }
    }
}

private fun DrawScope.drawBalance(angle: Float, sides: Sides, beam: Color, pin: Color) {
    val pivot = Offset(60f, 44f)
    // Base and pivot.
    drawPath(triangle(60f, 44f, 47f, 72f, 73f, 72f), beam)
    drawLine(beam, Offset(40f, 74f), Offset(80f, 74f), strokeWidth = 3f, cap = StrokeCap.Round)
    rotate(angle, pivot) {
        drawLine(beam, Offset(10f, 44f), Offset(110f, 44f), strokeWidth = 5f, cap = StrokeCap.Round)
        drawCircle(sides.a.fill, radius = 13f, center = Offset(22f, 30f))
        drawCircle(sides.b.fill, radius = 13f, center = Offset(98f, 30f))
        drawCircle(pin, radius = 2.4f, center = pivot)
    }
}

internal fun triangle(x1: Float, y1: Float, x2: Float, y2: Float, x3: Float, y3: Float) = Path().apply {
    moveTo(x1, y1)
    lineTo(x2, y2)
    lineTo(x3, y3)
    close()
}

/** The warm card shadow (globals.css --shadow-card), black in dark. */
@Composable
fun Modifier.warmShadow(elevation: Dp, shape: Shape): Modifier =
    shadow(elevation, shape, clip = false, ambientColor = Palette.warmShadow, spotColor = Palette.warmShadow)

/** The writing box's edge: a thin line and a glow, stronger with the focus. */
@Composable
fun Modifier.neonEdge(edge: Color, focused: Boolean, shape: Shape): Modifier {
    val glow = edge.copy(alpha = if (focused) 0.6f else 0.4f)
    return shadow(if (focused) 12.dp else 8.dp, shape, clip = false, ambientColor = glow, spotColor = glow)
        .clip(shape)
        .background(Palette.paper)
        .border(1.dp, edge.copy(alpha = if (focused) 0.95f else 0.75f), shape)
}

val CardElevation = 10.dp
