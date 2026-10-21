package com.okjudge.judge.ui.judging

import android.provider.Settings
import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.okjudge.judge.core.display.Thinking
import com.okjudge.judge.core.display.VerdictDisplay
import com.okjudge.judge.core.model.VerdictResult
import com.okjudge.judge.i18n.LocalStrings
import com.okjudge.judge.ui.components.Balance
import com.okjudge.judge.ui.components.JudgeIcons
import com.okjudge.judge.ui.components.Kicker
import com.okjudge.judge.ui.components.TintedIcon
import com.okjudge.judge.ui.components.TextAction
import com.okjudge.judge.ui.theme.JudgeType
import com.okjudge.judge.ui.theme.Palette
import com.okjudge.judge.ui.verdict.VoteDot
import kotlinx.coroutines.delay

/** True when the user turned animations off (developer option or "Remove animations"). */
@Composable
fun rememberReducedMotion(): Boolean {
    val context = LocalContext.current
    return remember {
        Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f
    }
}

object JudgingTags {
    const val CAPTION = "judging.caption"
    const val BALANCE = "judging.balance"
    const val FACTCHECK = "judging.factcheck"
}

/**
 * The judging state: an animated balance and the rotating captions of
 * lib/thinking.ts. While waiting the beam rocks gently; once the verdict is
 * in it springs to the tug-bar angle (the winner's end goes down), the
 * finish steps play, and after a short hold [onFinished] hands over.
 */
@Composable
fun JudgingScreen(
    done: Boolean,
    result: VerdictResult?,
    startedAt: Long,
    reducedMotion: Boolean,
    onFinished: () -> Unit,
    onCancel: () -> Unit,
    modifier: Modifier = Modifier,
    premium: Boolean = false,
    showCancel: Boolean = true,
) {
    val s = LocalStrings.current
    val finishedCallback by rememberUpdatedState(onFinished)
    BackHandler(onBack = onCancel)

    var dig by remember { mutableStateOf(Thinking.INITIAL) }
    var finished by remember { mutableStateOf(false) }
    LaunchedEffect(dig, done, finished) {
        if (finished) return@LaunchedEffect
        val plan = Thinking.plan(dig, done, reducedMotion)
        delay(plan.delayMs)
        when (val to = plan.to) {
            Thinking.Next.Finished -> finished = true
            is Thinking.Next.To -> dig = to.state
        }
    }
    LaunchedEffect(finished) {
        if (!finished) return@LaunchedEffect
        delay(if (reducedMotion) 0 else Thinking.REVEAL_HOLD_MS)
        finishedCallback()
    }

    // Beam: rock ±4° (2.4 s period) while waiting, spring to the verdict angle when done.
    val angle = remember { Animatable(0f) }
    val target = if (done && result != null) VerdictDisplay.finalBeamDeg(result).toFloat() else null
    LaunchedEffect(target, reducedMotion) {
        if (target != null) {
            if (reducedMotion) angle.snapTo(target) else angle.animateTo(target, spring(dampingRatio = 0.55f, stiffness = 120f))
        } else if (!reducedMotion) {
            angle.animateTo(4f, tween(600, easing = FastOutSlowInEasing))
            while (true) {
                angle.animateTo(-4f, tween(1200, easing = FastOutSlowInEasing))
                angle.animateTo(4f, tween(1200, easing = FastOutSlowInEasing))
            }
        }
    }

    var progress by remember { mutableFloatStateOf(0f) }
    LaunchedEffect(done) {
        while (true) {
            progress = Thinking.progressAt(System.currentTimeMillis() - startedAt, done)
            if (done) break
            delay(250)
        }
    }

    val caption = s.text(Thinking.captionKey(dig, finished)) ?: ""
    val announcement = s.text(Thinking.announcementKey(dig, done)) ?: ""

    Column(
        modifier.fillMaxSize().padding(horizontal = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.weight(1f))
        Kicker(s.thinkingEyebrow)
        Balance(
            angle = angle.value,
            modifier = Modifier
                .padding(vertical = 28.dp)
                .size(width = 240.dp, height = 160.dp)
                .testTag(JudgingTags.BALANCE)
                .clearAndSetSemantics { },
        )
        JudgeDots(done, result, reducedMotion)
        Text(
            caption,
            style = JudgeType.lead.copy(color = Palette.ink),
            textAlign = TextAlign.Center,
            modifier = Modifier
                .padding(top = 24.dp)
                .widthIn(max = 420.dp)
                .testTag(JudgingTags.CAPTION)
                .clearAndSetSemantics { },
        )
        // One polite live region with the announcement() text.
        Box(Modifier.size(1.dp).semantics {
            liveRegion = LiveRegionMode.Polite
            contentDescription = announcement
        })
        if (premium) FactCheckRow(done)
        ProgressBar(progress, Modifier.padding(top = 20.dp).widthIn(max = 280.dp).fillMaxWidth())
        Text(
            if (premium) s.thinkingPremiumHelper else s.thinkingHelper,
            style = JudgeType.slotText,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(top = 18.dp).widthIn(max = 360.dp),
        )
        Spacer(Modifier.weight(1f))
        if (showCancel) TextAction(s.appCancel, onCancel, Modifier.padding(bottom = 24.dp), color = Palette.ink2)
    }
}

/** Premium's web fact-check line (JudgingOverlay): in progress, then finished once the verdict is in. */
@Composable
private fun FactCheckRow(done: Boolean) {
    val s = LocalStrings.current
    val text = if (done) s.thinkingFactcheckDone else s.thinkingFactcheck
    Row(
        Modifier
            .padding(top = 14.dp)
            .testTag(JudgingTags.FACTCHECK)
            .semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Polite },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        if (done) {
            Box(Modifier.size(16.dp).clip(RoundedCornerShape(8.dp)).background(Palette.sageInk), contentAlignment = Alignment.Center) {
                TintedIcon(JudgeIcons.factCheck, 10)
            }
        } else {
            CircularProgressIndicator(Modifier.size(14.dp), color = Palette.ink2, strokeWidth = 1.5.dp)
        }
        Text(text, style = JudgeType.slotText.copy(color = Palette.ink2))
    }
}

@Composable
private fun JudgeDots(done: Boolean, result: VerdictResult?, reducedMotion: Boolean) {
    val votes = if (done && result != null) VerdictDisplay.votes(result) else emptyList()
    val pulse = rememberInfiniteTransition(label = "dots")
    val alpha by pulse.animateFloat(
        initialValue = 0.45f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(tween(900), RepeatMode.Reverse),
        label = "dotAlpha",
    )
    Row(Modifier.clearAndSetSemantics { }, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        if (votes.isEmpty()) {
            repeat(3) {
                Box(Modifier.alpha(if (reducedMotion || done) 1f else alpha)) { VoteDot(null, 12) }
            }
        } else {
            votes.forEach { VoteDot(it, 12) }
        }
    }
}

@Composable
private fun ProgressBar(value: Float, modifier: Modifier) {
    Box(modifier.height(4.dp).clip(RoundedCornerShape(4.dp)).background(Palette.ink.copy(alpha = 0.1f))) {
        Box(Modifier.fillMaxWidth(value.coerceIn(0f, 1f)).height(4.dp).background(Palette.ink))
    }
}
