package com.okjudge.judge.ui.judging

import android.provider.Settings
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
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
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.okjudge.judge.core.display.CourtScene
import com.okjudge.judge.core.display.Story
import com.okjudge.judge.core.model.VerdictResult
import com.okjudge.judge.core.session.VerdictFlow
import com.okjudge.judge.i18n.LocalStrings
import com.okjudge.judge.i18n.Strings
import com.okjudge.judge.ui.components.CourtView
import com.okjudge.judge.ui.components.LocalGamify
import com.okjudge.judge.ui.components.JudgeIcons
import com.okjudge.judge.ui.components.Kicker
import com.okjudge.judge.ui.components.TextAction
import com.okjudge.judge.ui.components.TintedIcon
import com.okjudge.judge.ui.components.rememberIcon
import com.okjudge.judge.ui.components.uppercaseForUi
import com.okjudge.judge.ui.components.warmShadow
import com.okjudge.judge.ui.theme.JudgeShapes
import com.okjudge.judge.ui.theme.JudgeType
import com.okjudge.judge.ui.theme.LocalSides
import com.okjudge.judge.ui.theme.Palette
import com.okjudge.judge.ui.theme.forScript
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
    const val COURT = "judging.court"
}

/**
 * The judges at work: what each side wrote as short tiles, then a card with
 * the street court acting out each step (Story, from components/court/story.ts)
 * over a log of what is going on. After the ending has played, [onFinished]
 * hands over. [sides] is empty where they are not shown (a case's judging).
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
    sides: List<VerdictFlow.Side> = emptyList(),
) {
    val s = LocalStrings.current
    val finishedCallback by rememberUpdatedState(onFinished)
    BackHandler(onBack = onCancel)

    // The app has no separate signal for the server taking the case, so the names count from the start.
    var elapsed by remember { mutableLongStateOf(System.currentTimeMillis() - startedAt) }
    LaunchedEffect(done) {
        while (!done) {
            elapsed = System.currentTimeMillis() - startedAt
            delay(250)
        }
    }
    val waiting = Story.waitingAt(elapsed, 0)
    val summary = remember(done) { if (done && result != null) Story.summarize(result) else null }
    val ending = remember(done) { if (done) Story.ending(waiting, summary, reducedMotion) else null }

    var reached by remember { mutableIntStateOf(0) }
    LaunchedEffect(ending) {
        val e = ending ?: return@LaunchedEffect
        var t = 0L
        e.steps.forEachIndexed { i, step ->
            delay(step.at - t)
            t = step.at
            reached = i + 1
        }
        delay(e.finishAt - t)
        finishedCallback()
    }

    val steps = ending?.steps?.take(reached).orEmpty()
    val lines = Story.WAITING.take(waiting + 1).map { Story.Line("story.${it.wire}") } + steps.mapNotNull { it.line }
    val beat = steps.lastOrNull()?.beat ?: Story.WAITING[waiting]
    val last = lines.lastIndex
    val texts = lines.map { lineText(s, it) }

    val screen = LocalConfiguration.current
    // Large screens let the card and the court grow; the court stops short of half the height so the log stays in view.
    val cardMax = if (screen.screenWidthDp >= 960) 880.dp else 640.dp
    val courtHeight = if (screen.screenWidthDp >= 600) (screen.screenHeightDp * 0.48f).dp else 360.dp
    val courtWidth = if (screen.screenWidthDp >= 600) courtHeight * 16f / 9f else 480.dp

    Column(modifier.fillMaxSize().background(Palette.ivory), horizontalAlignment = Alignment.CenterHorizontally) {
        Column(
            Modifier
                .weight(1f)
                .widthIn(max = cardMax)
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp, vertical = 16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            if (sides.isNotEmpty()) SideTiles(sides)
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
                Kicker(s.thinkingEyebrow, Modifier.padding(bottom = 14.dp))
                val gamify = LocalGamify.current
                if (gamify) {
                    CourtView(
                        scene = CourtScene.Judging(beat, summary),
                        reducedMotion = reducedMotion,
                        modifier = Modifier
                            .heightIn(max = courtHeight)
                            .widthIn(max = courtWidth)
                            .fillMaxWidth()
                            .aspectRatio(16f / 9f)
                            .testTag(JudgingTags.COURT),
                    )
                }
                Column(Modifier.fillMaxWidth().padding(top = if (gamify) 16.dp else 0.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    texts.forEachIndexed { i, text ->
                        val live = i == last && beat != Story.Beat.FINAL
                        Row(
                            (if (i == last) Modifier.testTag(JudgingTags.CAPTION) else Modifier).clearAndSetSemantics { },
                            horizontalArrangement = Arrangement.spacedBy(10.dp),
                        ) {
                            Box(Modifier.size(18.dp, 20.dp), contentAlignment = Alignment.Center) {
                                if (live) {
                                    CircularProgressIndicator(Modifier.size(12.dp), color = Palette.ink2, strokeWidth = 1.5.dp)
                                } else {
                                    TintedIcon(rememberIcon(Palette.sageStrong) { JudgeIcons.check(it) }, 16)
                                }
                            }
                            if (i == last) {
                                TypeLine(text, reducedMotion, JudgeType.slotText.copy(fontSize = 14.sp, color = Palette.ink, fontWeight = FontWeight.Medium))
                            } else {
                                Text(text, style = JudgeType.slotText.copy(fontSize = 14.sp))
                            }
                        }
                    }
                }
                // One polite live region with the current line.
                Box(Modifier.size(1.dp).semantics {
                    liveRegion = LiveRegionMode.Polite
                    contentDescription = texts.lastOrNull().orEmpty()
                })
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

private val LEADING_SYMBOLS = Regex("^[\\p{So}\\p{Sk}\u200D\uFE0F\u20E3\u2713]+\\s*")

private fun lineText(s: Strings, line: Story.Line): String = when {
    line.n != null && line.total != null -> s.storyAgree(line.n.toString(), line.total.toString())
    line.key.startsWith("trial.") -> (s.text(line.key) ?: "").replace(LEADING_SYMBOLS, "")
    else -> s.text(line.key) ?: ""
}

/** The newest log line, typed out; the rest of it is laid out already, so nothing jumps. */
@Composable
private fun TypeLine(text: String, reducedMotion: Boolean, style: TextStyle) {
    var n by remember(text) { mutableIntStateOf(if (reducedMotion) text.length else 0) }
    LaunchedEffect(text, reducedMotion) {
        while (!reducedMotion && n < text.length) {
            delay(22)
            n++
        }
    }
    val shown = if (reducedMotion) text.length else n
    Text(
        buildAnnotatedString {
            append(text.take(shown))
            withStyle(SpanStyle(color = Color.Transparent)) { append(text.drop(shown)) }
        },
        style = style,
    )
}

/** What each side wrote, three lines at most, yours first. */
@Composable
private fun SideTiles(sides: List<VerdictFlow.Side>) {
    val s = LocalStrings.current
    val colors = LocalSides.current
    Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        sides.forEach { side ->
            val (ink, tint) = (if (side.mine) colors.mine else colors.theirs).let { it.ink to it.tint }
            Column(
                Modifier
                    .weight(1f)
                    .fillMaxHeight()
                    .clip(RoundedCornerShape(18.dp))
                    .background(tint)
                    .semantics(mergeDescendants = true) {}
                    .padding(horizontal = 12.dp, vertical = 10.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Text(
                    side.name.ifEmpty { if (side.mine) s.appHomeYourSide else s.appHomeTheirSide }.uppercaseForUi(),
                    style = JudgeType.micro.copy(color = ink, letterSpacing = 0.08.em).forScript(),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    side.text,
                    style = JudgeType.body.copy(fontSize = 13.sp, lineHeight = (13 * 1.4).sp, fontWeight = FontWeight.Normal),
                    maxLines = 3,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}
