package com.okjudge.judge.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import com.okjudge.judge.ui.theme.JudgeShapes
import com.okjudge.judge.ui.theme.JudgeType
import com.okjudge.judge.ui.theme.Palette

object CheckboxTags {
    const val CHECKBOX = "checkbox"
}

/** A checkbox with its [label], the whole row tappable. */
@Composable
fun LabeledCheckbox(ticked: Boolean, onTicked: (Boolean) -> Unit, label: String, modifier: Modifier = Modifier, enabled: Boolean = true) {
    Row(
        modifier
            .fillMaxWidth()
            .clip(JudgeShapes.field)
            .toggleable(value = ticked, enabled = enabled, role = Role.Checkbox, onValueChange = onTicked)
            .testTag(CheckboxTags.CHECKBOX)
            .padding(vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        val box = RoundedCornerShape(6.dp)
        Box(
            Modifier
                .size(24.dp)
                .clip(box)
                .background(if (ticked) Palette.ink else Palette.paper)
                .border(1.5.dp, if (ticked) Palette.ink else Palette.line2, box),
            contentAlignment = Alignment.Center,
        ) {
            if (ticked) TintedIcon(rememberIcon(Palette.ivory) { JudgeIcons.check(it) }, 16)
        }
        Text(label, style = JudgeType.bodyStrong)
    }
}
