package com.okjudge.judge.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

/** Corner radii (globals.css --radius-*). */
object JudgeShapes {
    val chip = RoundedCornerShape(999.dp)
    val field = RoundedCornerShape(18.dp)
    val block = RoundedCornerShape(22.dp)
    val card = RoundedCornerShape(28.dp)
    val verdict = RoundedCornerShape(30.dp)
    val branch = RoundedCornerShape(16.dp)
    val crux = RoundedCornerShape(20.dp)
}

private fun colorsOf(p: JudgePalette) = (if (p.dark) darkColorScheme() else lightColorScheme()).copy(
    primary = p.ink,
    onPrimary = p.ivory,
    primaryContainer = p.ivory2,
    onPrimaryContainer = p.ink,
    secondary = p.terra,
    onSecondary = p.paper,
    secondaryContainer = p.terraTint,
    onSecondaryContainer = p.ink,
    tertiary = p.sageInk,
    onTertiary = p.paper,
    tertiaryContainer = p.sageTint,
    onTertiaryContainer = p.ink,
    background = p.ivory,
    onBackground = p.ink,
    surface = p.paper,
    onSurface = p.ink,
    surfaceVariant = p.ivory2,
    onSurfaceVariant = p.ink2,
    surfaceContainerLowest = p.paper,
    surfaceContainerLow = p.paper,
    surfaceContainer = p.paper,
    surfaceContainerHigh = p.ivory2,
    surfaceContainerHighest = p.ivory2,
    surfaceBright = p.paper,
    surfaceDim = p.ivory2,
    inverseSurface = p.ink,
    inverseOnSurface = p.ivory,
    outline = p.line2,
    outlineVariant = p.line,
    error = p.danger,
    onError = p.paper,
    scrim = if (p.dark) Color.Black else p.ink,
)

private val LightColors = colorsOf(LightPalette)
private val DarkColors = colorsOf(DarkPalette)

/** The brand palette, light or dark, never dynamic colour. */
@Composable
fun JudgeTheme(dark: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    val palette = if (dark) DarkPalette else LightPalette
    CompositionLocalProvider(
        LocalPalette provides palette,
        LocalSides provides Sides.forViewer(null, palette),
    ) {
        MaterialTheme(
            colorScheme = if (dark) DarkColors else LightColors,
            typography = JudgeType.material,
            shapes = Shapes(
                extraSmall = RoundedCornerShape(8.dp),
                small = RoundedCornerShape(12.dp),
                medium = JudgeShapes.field,
                large = JudgeShapes.block,
                extraLarge = JudgeShapes.card,
            ),
            content = content,
        )
    }
}
