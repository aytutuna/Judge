package com.okjudge.judge.ui.components

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.okjudge.judge.i18n.LocalStrings
import com.okjudge.judge.ui.theme.JudgeType
import com.okjudge.judge.ui.theme.Palette

/**
 * The back button row; nothing at all without [onBack]. `backLabel` names
 * where back goes, for screen readers; `backText` writes it next to the
 * arrow as well.
 */
@Composable
fun TopBar(
    onBack: (() -> Unit)?,
    modifier: Modifier = Modifier,
    backLabel: String? = null,
    backText: String? = null,
    trailing: (@Composable () -> Unit)? = null,
) {
    if (onBack == null) return
    val s = LocalStrings.current
    Row(
        modifier.fillMaxWidth().heightIn(min = 56.dp).padding(horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (backText != null) {
            Row(
                Modifier
                    .height(44.dp)
                    .clip(CircleShape)
                    .semantics(mergeDescendants = true) { role = Role.Button }
                    .clickable(onClick = onBack)
                    .padding(start = 8.dp, end = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                TintedIcon(rememberIcon(Palette.ink) { JudgeIcons.back(it) }, 18)
                Text(backText, style = JudgeType.slotTitle.copy(fontSize = 15.sp))
            }
        } else {
            Box(
                Modifier
                    .size(44.dp)
                    .clip(CircleShape)
                    .semantics {
                        role = Role.Button
                        contentDescription = backLabel ?: s.appCancel
                    }
                    .clickable(onClick = onBack),
                contentAlignment = Alignment.Center,
            ) {
                TintedIcon(rememberIcon(Palette.ink) { JudgeIcons.back(it) }, 20)
            }
        }
        if (trailing != null) {
            Box(Modifier.weight(1f).padding(start = 8.dp), contentAlignment = Alignment.CenterEnd) { trailing() }
        }
    }
}
