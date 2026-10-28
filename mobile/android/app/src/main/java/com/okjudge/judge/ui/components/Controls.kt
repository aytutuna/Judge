package com.okjudge.judge.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.okjudge.judge.i18n.LocalLang
import com.okjudge.judge.ui.theme.JudgeShapes
import com.okjudge.judge.ui.theme.JudgeType
import com.okjudge.judge.ui.theme.Palette

/** The ink pill CTA ("Get the verdict"). */
@Composable
fun PrimaryButton(text: String, enabled: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val bg = if (enabled) Palette.ink else Palette.ink.copy(alpha = 0.35f)
    Box(
        modifier
            .defaultMinSize(minHeight = 54.dp)
            .then(if (enabled) Modifier.warmShadow(6.dp, JudgeShapes.chip) else Modifier)
            .clip(JudgeShapes.chip)
            .background(bg)
            .semantics { role = Role.Button }
            .clickable(enabled = enabled, onClick = onClick)
            .padding(horizontal = 24.dp, vertical = 16.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, style = JudgeType.button, textAlign = TextAlign.Center)
    }
}

/** The small outlined pill buttons of the card (share, copy link). */
@Composable
fun GhostButton(text: String, icon: ImageVector?, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Row(
        modifier
            .defaultMinSize(minHeight = 40.dp)
            .clip(JudgeShapes.chip)
            .border(BorderStroke(1.dp, Palette.line2), JudgeShapes.chip)
            .background(Palette.paper)
            .semantics { role = Role.Button }
            .clickable(onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(7.dp),
    ) {
        if (icon != null) Image(icon, contentDescription = null, modifier = Modifier.size(15.dp))
        Text(text, style = JudgeType.small.copy(color = Palette.ink))
    }
}

/** A terracotta text action ("Judge another"). */
@Composable
fun TextAction(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, color: Color = Palette.terraInk, enabled: Boolean = true) {
    Box(
        modifier
            .defaultMinSize(minHeight = 40.dp)
            .clip(JudgeShapes.chip)
            .semantics { role = Role.Button }
            .clickable(enabled = enabled, onClick = onClick)
            .padding(horizontal = 10.dp, vertical = 9.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, style = JudgeType.small.copy(color = if (enabled) color else color.copy(alpha = 0.4f)))
    }
}

/** A selectable pill chip (examples, language). */
@Composable
fun Chip(
    text: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    leading: String? = null,
) {
    val bg = if (selected) Palette.terraTint else Palette.paper
    val border = if (selected) Palette.terra else Palette.line2
    Row(
        modifier
            .defaultMinSize(minHeight = 40.dp)
            .clip(JudgeShapes.chip)
            .border(BorderStroke(if (selected) 1.5.dp else 1.dp, border), JudgeShapes.chip)
            .background(bg)
            .semantics { this.selected = selected }
            .clickable(onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (leading != null) {
            Text(leading, style = JudgeType.small)
            Spacer(Modifier.width(6.dp))
        }
        Text(text, style = JudgeType.small.copy(color = Palette.ink))
    }
}

/** Uppercase micro kicker ("THE CRUX"). */
@Composable
fun Kicker(text: String, modifier: Modifier = Modifier, color: Color = Palette.muted) {
    Text(text.uppercaseForUi(), style = JudgeType.micro.copy(color = color), modifier = modifier)
}

@Composable
fun TintedIcon(icon: ImageVector, size: Int, modifier: Modifier = Modifier, tint: Color? = null) {
    val filter = remember(tint) { tint?.let { ColorFilter.tint(it) } }
    Image(icon, contentDescription = null, modifier = modifier.size(size.dp), colorFilter = filter)
}

/** A paper card with the warm shadow. */
@Composable
fun PaperCard(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    Box(
        modifier
            .fillMaxWidth()
            .warmShadow(CardElevation, JudgeShapes.verdict)
            .clip(JudgeShapes.verdict)
            .background(Palette.paper)
            .border(BorderStroke(1.dp, Palette.line), JudgeShapes.verdict),
    ) { content() }
}

/**
 * Uppercases with the UI language's rules, as CSS `text-transform` does under
 * `<html lang>`: Turkish maps "i" to "İ", which `uppercase()` (Locale.ROOT) does not.
 */
@Composable
fun String.uppercaseForUi(): String = uppercase(LocalLang.current.locale)
