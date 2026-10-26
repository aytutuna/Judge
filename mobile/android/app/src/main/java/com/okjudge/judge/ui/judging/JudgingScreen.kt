package com.okjudge.judge.ui.judging

import android.provider.Settings
import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
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
import com.okjudge.judge.core.display.SceneMode
import com.okjudge.judge.core.display.Thinking
import com.okjudge.judge.core.display.VerdictDisplay
import com.okjudge.judge.core.model.VerdictResult
import com.okjudge.judge.i18n.LocalStrings
import com.okjudge.judge.ui.components.ArgumentBubble
import com.okjudge.judge.ui.components.JudgeIcons
import com.okjudge.judge.ui.components.JudgesBadge
import com.okjudge.judge.ui.components.Kicker
import com.okjudge.judge.ui.components.SceneView
import com.okjudge.judge.ui.components.TextAction
import com.okjudge.judge.ui.components.TintedIcon
import com.okjudge.judge.ui.components.TopBar
import com.okjudge.judge.ui.components.warmShadow
import com.okjudge.judge.ui.theme.JudgeShapes
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
 * The judging turn of the thread: the user's argument, the judges' badge
 * and a card with the 3D balance (beats from lib/judging-ui.ts while
 * waiting, the verdict tilt once it is in) over the rotating captions of
 * lib/thinking.ts. After the finish steps and a short hold [onFinished]
 * hands over. [argument] is null where it is not shown (a case's judging);
 * [onNew] puts the header with its "+" on top (the home thread).
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
    argument: String? = null,
    onNew: (() -> Unit)? = null,
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

    var progress by remember { mutableFloatStateOf(0f) }
    LaunchedEffect(done) {
        while (true) {
            progress = Thinking.progressAt(System.currentTimeMillis() - startedAt, done)
            if (done) break
            delay(250)
        }
    }

    val scene = if (done && result != null) VerdictDisplay.sceneVerdict(result) else SceneMode.Judging(Thinking.beatFor(dig))
    val caption = s.text(Thinking.captionKey(dig, finished)) ?: ""
    val announcement = s.text(Thinking.announcementKey(dig, done)) ?: ""

    Column(modifier.fillMaxSize().background(Palette.ivory), horizontalAlignment = Alignment.CenterHorizontally) {
        if (onNew != null) TopBar(onBack = null, onNew = onNew)
        Column(
            Modifier
                .weight(1f)
                .widthIn(max = 640.dp)
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp, vertical = 16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            if (argument != null) ArgumentBubble(argument, Modifier.padding(bottom = 12.dp))
            JudgesBadge(s.threadJudges)
            Column(
                Modifier
                    .fillMaxWidth()
                    .warmShadow(3.dp, JudgeShapes.card)
                    .clip(JudgeShapes.card)
                    .background(Palette.paper)
                    .border(1.dp, Palette.line, JudgeShapes.card)
                    .padding(22.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                SceneView(
                    mode = scene,
                    reducedMotion = reducedMotion,
                    modifier = Modifier
                        .heightIn(max = 360.dp)
                        .fillMaxWidth()
                        .aspectRatio(4f / 3f)
                        .testTag(JudgingTags.BALANCE),
                )
                Kicker(s.thinkingEyebrow, Modifier.padding(top = 20.dp, bottom = 14.dp))
                JudgeDots(done, result, reducedMotion)
                Text(
                    caption,
                    style = JudgeType.lead.copy(color = Palette.ink),
                    textAlign = TextAlign.Center,
                    modifier = Modifier
                        .padding(top = 16.dp)
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
                ProgressBar(progress, Modifier.padding(top = 18.dp).widthIn(max = 280.dp).fillMaxWidth())
                Text(
                    if (premium) s.thinkingPremiumHelper else s.thinkingHelper,
                    style = JudgeType.slotText,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.padding(top = 16.dp).widthIn(max = 360.dp),
                )
            }
        }
        if (showCancel) TextAction(s.appCancel, onCancel, Modifier.padding(vertical = 12.dp), color = Palette.ink2)
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
