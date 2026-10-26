package com.okjudge.judge.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.okjudge.judge.i18n.LocalStrings
import com.okjudge.judge.ui.theme.BrandFonts
import com.okjudge.judge.ui.theme.JudgeShapes
import com.okjudge.judge.ui.theme.JudgeType
import com.okjudge.judge.ui.theme.Palette

private val BubbleShape = RoundedCornerShape(topStart = 22.dp, topEnd = 22.dp, bottomEnd = 6.dp, bottomStart = 22.dp)

/** What the user wrote, right-aligned like a sent message (thread.module.css .bubble). */
@Composable
fun ArgumentBubble(text: String, modifier: Modifier = Modifier) {
    val s = LocalStrings.current
    BoxWithConstraints(modifier.fillMaxWidth(), contentAlignment = Alignment.CenterEnd) {
        Text(
            text,
            style = JudgeType.body.copy(fontSize = 14.sp, lineHeight = (14 * 1.55).sp),
            modifier = Modifier
                .widthIn(max = maxWidth * 0.85f)
                .clip(BubbleShape)
                .background(Palette.ivory2)
                .semantics { contentDescription = "${s.threadYou}: $text" }
                .padding(horizontal = 16.dp, vertical = 12.dp),
        )
    }
}

private val badgeStyle = TextStyle(
    fontFamily = BrandFonts.interTight(700),
    fontWeight = FontWeight.Bold,
    fontSize = 13.sp,
    lineHeight = 16.sp,
    letterSpacing = (-0.01).em,
    color = Palette.terraInk,
)

/** "The judges" over their side of the thread, or how far they agreed (.who). */
@Composable
fun JudgesBadge(label: String, modifier: Modifier = Modifier) {
    Row(
        modifier
            .clip(JudgeShapes.chip)
            .background(Palette.terraTint)
            .padding(start = 6.dp, end = 12.dp, top = 5.dp, bottom = 5.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Box(Modifier.padding(vertical = 3.dp)) { BrandMark(22.dp) }
        Text(label, style = badgeStyle)
    }
}
