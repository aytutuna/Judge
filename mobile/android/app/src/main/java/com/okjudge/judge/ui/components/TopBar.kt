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
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.okjudge.judge.i18n.AppLang
import com.okjudge.judge.i18n.LocalLang
import com.okjudge.judge.i18n.LocalStrings
import com.okjudge.judge.ui.theme.JudgeShapes
import com.okjudge.judge.ui.theme.JudgeType
import com.okjudge.judge.ui.theme.Palette

/**
 * Brand row with an optional back button and the EN/TR pill (the web's
 * LangToggle). `backLabel` names where back goes, for screen readers.
 */
@Composable
fun TopBar(onBack: (() -> Unit)?, onToggleLang: () -> Unit, modifier: Modifier = Modifier, backLabel: String? = null) {
    val s = LocalStrings.current
    Row(
        modifier.fillMaxWidth().height(56.dp).padding(horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (onBack != null) {
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
                TintedIcon(remember { JudgeIcons.back(Palette.ink) }, 20)
            }
        } else {
            Spacer(Modifier.width(8.dp))
            Row(
                Modifier.clearAndSetSemantics { },
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                BrandMark(26.dp)
                Text(s.appName, style = JudgeType.button.copy(color = Palette.ink, fontSize = 18.sp))
            }
        }
        Spacer(Modifier.weight(1f))
        LangToggle(onToggleLang)
    }
}

@Composable
fun LangToggle(onToggle: () -> Unit) {
    val lang = LocalLang.current
    val s = LocalStrings.current
    val label = if (lang == AppLang.EN) s.langToggleToTr else s.langToggleToEn
    Row(
        Modifier
            .clip(JudgeShapes.chip)
            .border(1.dp, Palette.line2, JudgeShapes.chip)
            .background(Palette.paper)
            .semantics(mergeDescendants = true) {
                role = Role.Button
                contentDescription = label
            }
            .clickable(onClick = onToggle)
            .padding(3.dp),
    ) {
        for (option in AppLang.entries) {
            val selected = option == lang
            Text(
                option.tag.uppercase(),
                style = JudgeType.micro.copy(color = if (selected) Palette.ivory else Palette.ink2, letterSpacing = 0.08.sp * 11),
                modifier = Modifier
                    .clip(JudgeShapes.chip)
                    .background(if (selected) Palette.ink else Palette.paper)
                    .padding(horizontal = 11.dp, vertical = 6.dp),
            )
        }
    }
}
