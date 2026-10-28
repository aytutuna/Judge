package com.okjudge.judge.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.okjudge.judge.i18n.LocalStrings
import com.okjudge.judge.ui.theme.JudgeType
import com.okjudge.judge.ui.theme.Palette

object TopBarTags {
    const val NEW = "topbar.new"
}

/**
 * Brand row with an optional back button and the "+" that starts a new
 * argument ([onNew], null hides it). `backLabel` names where back goes,
 * for screen readers; `backText` writes it next to the arrow as well.
 */
@Composable
fun TopBar(onBack: (() -> Unit)?, onNew: (() -> Unit)?, modifier: Modifier = Modifier, backLabel: String? = null, backText: String? = null) {
    val s = LocalStrings.current
    Row(
        modifier.fillMaxWidth().height(56.dp).padding(horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (onBack != null && backText != null) {
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
                TintedIcon(remember { JudgeIcons.back(Palette.ink) }, 18)
                Text(backText, style = JudgeType.slotTitle.copy(fontSize = 15.sp))
            }
        } else if (onBack != null) {
            RoundButton(backLabel ?: s.appCancel, onBack) {
                TintedIcon(remember { JudgeIcons.back(Palette.ink) }, 20)
            }
        } else {
            Spacer(Modifier.width(8.dp))
            Text(
                s.appName,
                style = JudgeType.button.copy(color = Palette.ink, fontSize = 18.sp),
                modifier = Modifier.clearAndSetSemantics { },
            )
        }
        Spacer(Modifier.weight(1f))
        if (onNew != null) {
            RoundButton(s.shellNew, onNew, Modifier.testTag(TopBarTags.NEW), outlined = true) {
                TintedIcon(remember { JudgeIcons.plus(Palette.ink) }, 18)
            }
        }
    }
}

@Composable
private fun RoundButton(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    outlined: Boolean = false,
    icon: @Composable () -> Unit,
) {
    Box(
        modifier
            .size(44.dp)
            .clip(CircleShape)
            .then(if (outlined) Modifier.background(Palette.paper).border(1.dp, Palette.line2, CircleShape) else Modifier)
            .semantics {
                role = Role.Button
                contentDescription = label
            }
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        icon()
    }
}
