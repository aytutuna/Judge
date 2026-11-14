package com.okjudge.judge.ui.verdict

import androidx.compose.foundation.Image
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.okjudge.judge.core.model.Rating
import com.okjudge.judge.i18n.LocalStrings
import com.okjudge.judge.ui.components.GhostButton
import com.okjudge.judge.ui.components.JudgeIcons
import com.okjudge.judge.ui.components.PaperCard
import com.okjudge.judge.ui.components.rememberIcon
import com.okjudge.judge.ui.theme.JudgeType
import com.okjudge.judge.ui.theme.Palette

object FeedbackTags {
    const val CARD = "feedback.card"
    const val YES = "feedback.yes"
    const val NO = "feedback.no"
    const val UP = "feedback.up"
    const val DOWN = "feedback.down"
}

/** Asked once, after a person's first verdict; either answer is final here and changeable in Settings. */
@Composable
fun ConsentCard(onAnswer: (Boolean) -> Unit, modifier: Modifier = Modifier) {
    val s = LocalStrings.current
    PaperCard(modifier.testTag(FeedbackTags.CARD)) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(s.consentCardTitle, style = JudgeType.bodyStrong)
            Text(s.consentCardBody, style = JudgeType.slotText)
            Row(Modifier.padding(top = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                GhostButton(s.consentCardYes, null, { onAnswer(true) }, Modifier.testTag(FeedbackTags.YES))
                GhostButton(s.consentCardNo, null, { onAnswer(false) }, Modifier.testTag(FeedbackTags.NO))
            }
        }
    }
}

/** "Fair verdict?" with two thumbs; a tap on the chosen one clears it (the caller decides). */
@Composable
fun RatingRow(rating: Rating?, onRate: (Rating) -> Unit, modifier: Modifier = Modifier) {
    val s = LocalStrings.current
    Row(modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.Center) {
        Text(s.ratingPrompt, style = JudgeType.footnote)
        Thumb(Rating.UP, rating, s.ratingFair, onRate, Modifier.testTag(FeedbackTags.UP))
        Thumb(Rating.DOWN, rating, s.ratingNotFair, onRate, Modifier.testTag(FeedbackTags.DOWN))
    }
}

@Composable
private fun Thumb(which: Rating, chosen: Rating?, label: String, onRate: (Rating) -> Unit, modifier: Modifier) {
    val picked = chosen == which
    val icon = rememberIcon(if (picked) Palette.ink else Palette.muted) { JudgeIcons.thumb(it, filled = picked) }
    Image(
        icon,
        contentDescription = null,
        modifier = modifier
            .defaultMinSize(minWidth = 48.dp, minHeight = 48.dp)
            .semantics {
                contentDescription = label
                role = Role.Button
                selected = picked
            }
            .clickable { onRate(which) }
            .padding(14.dp)
            .size(20.dp)
            .then(if (which == Rating.DOWN) Modifier.rotate(180f) else Modifier),
    )
}
