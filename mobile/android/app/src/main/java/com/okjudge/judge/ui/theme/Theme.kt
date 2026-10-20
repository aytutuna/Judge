package com.okjudge.judge.ui.theme

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
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

private val JudgeColors = lightColorScheme(
    primary = Palette.ink,
    onPrimary = Palette.ivory,
    primaryContainer = Palette.ivory2,
    onPrimaryContainer = Palette.ink,
    secondary = Palette.terra,
    onSecondary = Palette.paper,
    secondaryContainer = Palette.terraTint,
    onSecondaryContainer = Palette.ink,
    tertiary = Palette.sageInk,
    onTertiary = Palette.paper,
    tertiaryContainer = Palette.sageTint,
    onTertiaryContainer = Palette.ink,
    background = Palette.ivory,
    onBackground = Palette.ink,
    surface = Palette.paper,
    onSurface = Palette.ink,
    surfaceVariant = Palette.ivory2,
    onSurfaceVariant = Palette.ink2,
    surfaceContainerLowest = Palette.paper,
    surfaceContainerLow = Palette.paper,
    surfaceContainer = Palette.paper,
    surfaceContainerHigh = Palette.ivory2,
    surfaceContainerHighest = Palette.ivory2,
    surfaceBright = Palette.paper,
    surfaceDim = Palette.ivory2,
    inverseSurface = Palette.ink,
    inverseOnSurface = Palette.ivory,
    outline = Palette.line2,
    outlineVariant = Palette.line,
    error = Palette.danger,
    onError = Palette.paper,
    scrim = Palette.ink,
)

/** Light only, no dynamic colour: the brand palette everywhere. */
@Composable
fun JudgeTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = JudgeColors,
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
