package com.okjudge.judge.ui.judging

import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.VectorConverter
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import androidx.compose.ui.util.lerp
import com.okjudge.judge.core.display.CardThrow
import com.okjudge.judge.i18n.LocalStrings
import com.okjudge.judge.ui.components.JudgeIcons
import com.okjudge.judge.ui.components.TintedIcon
import com.okjudge.judge.ui.components.rememberIcon
import com.okjudge.judge.ui.components.uppercaseForUi
import com.okjudge.judge.ui.components.warmShadow
import com.okjudge.judge.ui.theme.JudgeType
import com.okjudge.judge.ui.theme.forScript
import kotlin.math.hypot
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

object SideCardTags {
    const val CARD = "judging.sideCard"
    const val CLOSE = "judging.sideCard.close"
    const val SCRIM = "judging.sideCard.scrim"
}

/**
 * One side's full text as a card in the middle of the screen, grown from its tile ([from], in this
 * box's own pixels). The X, a tap on the dimmed background, back, or throwing the card closes it;
 * [onClosed] runs once it has gone.
 */
@Composable
internal fun SideCard(
    title: String,
    text: String,
    ink: Color,
    tint: Color,
    from: Rect,
    reducedMotion: Boolean,
    onClosed: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val s = LocalStrings.current
    val scope = rememberCoroutineScope()
    val screen = LocalConfiguration.current
    val density = LocalDensity.current
    val reach = with(density) { hypot(screen.screenWidthDp.dp.toPx(), screen.screenHeightDp.dp.toPx()) }

    // 0 is the card on its tile, 1 is open in the middle.
    val open = remember { Animatable(0f) }
    val drag = remember { Animatable(Offset.Zero, Offset.VectorConverter) }
    val fade = remember { Animatable(1f) }
    var size by remember { mutableStateOf(IntSize.Zero) }
    var container by remember { mutableStateOf(IntSize.Zero) }
    var closing by remember { mutableStateOf(false) }
    val samples = remember { mutableListOf<CardThrow.Sample>() }
    val scroll = rememberScrollState()
    val focus = remember { FocusRequester() }

    LaunchedEffect(size != IntSize.Zero) {
        if (size == IntSize.Zero) return@LaunchedEffect
        focus.requestFocus()
        open.animateTo(1f, if (reducedMotion) tween(150) else spring(dampingRatio = 0.82f, stiffness = Spring.StiffnessMediumLow))
    }

    fun finish(block: suspend CoroutineScope.() -> Unit) {
        if (closing) return
        closing = true
        scope.launch {
            block()
            onClosed()
        }
    }

    /** Back to the tile. */
    fun shrink() = finish {
        launch { drag.animateTo(Offset.Zero) }
        if (reducedMotion) {
            fade.animateTo(0f, tween(150))
        } else {
            open.animateTo(0f, tween(260))
        }
    }

    fun toss(dx: Float, dy: Float, vx: Float, vy: Float) = finish {
        if (reducedMotion) {
            fade.animateTo(0f, tween(150))
        } else {
            val (x, y) = CardThrow.target(dx, dy, vx, vy, reach)
            launch { fade.animateTo(0f, tween(280)) }
            drag.animateTo(Offset(x, y), tween(280))
        }
    }

    BackHandler(onBack = ::shrink)

    Box(modifier.fillMaxSize().onSizeChanged { container = it }, contentAlignment = Alignment.Center) {
        Box(
            Modifier
                .fillMaxSize()
                .graphicsLayer { alpha = open.value * fade.value }
                .background(Color.Black.copy(alpha = 0.5f))
                .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null, onClick = ::shrink)
                .testTag(SideCardTags.SCRIM),
        )
        Column(
            Modifier
                .padding(16.dp)
                .widthIn(max = 520.dp)
                .fillMaxWidth()
                .heightIn(max = 560.dp)
                .onSizeChanged { size = it }
                .graphicsLayer {
                    val p = open.value
                    val d = drag.value
                    if (size == IntSize.Zero) {
                        alpha = 0f
                        return@graphicsLayer
                    }
                    alpha = (if (reducedMotion) p else lerp(0.4f, 1f, p)) * fade.value
                    rotationZ = if (reducedMotion) 0f else (d.x / 40f).coerceIn(-30f, 30f)
                    if (reducedMotion) {
                        translationX = d.x
                        translationY = d.y
                    } else {
                        scaleX = lerp(from.width / size.width, 1f, p)
                        scaleY = lerp(from.height / size.height, 1f, p)
                        translationX = lerp(from.center.x - container.width / 2f, 0f, p) + d.x
                        translationY = lerp(from.center.y - container.height / 2f, 0f, p) + d.y
                    }
                }
                .warmShadow(3.dp, RoundedCornerShape(24.dp))
                .clip(RoundedCornerShape(24.dp))
                .background(tint)
                .pointerInput(Unit) {
                    var at = Offset.Zero
                    detectDragGestures(
                        onDragStart = {
                            at = Offset.Zero
                            samples.clear()
                        },
                        onDrag = { change, amount ->
                            if (closing) return@detectDragGestures
                            at += amount
                            samples += CardThrow.Sample(at.x, at.y, change.uptimeMillis)
                            scope.launch { drag.snapTo(at) }
                        },
                        onDragEnd = {
                            if (closing) return@detectDragGestures
                            val (vx, vy) = CardThrow.velocity(samples)
                            if (CardThrow.isThrow(at.x, at.y, vx, vy)) {
                                toss(at.x, at.y, vx, vy)
                            } else {
                                scope.launch { drag.animateTo(Offset.Zero, spring(dampingRatio = 0.6f, stiffness = Spring.StiffnessLow)) }
                            }
                        },
                        onDragCancel = { scope.launch { drag.animateTo(Offset.Zero) } },
                    )
                }
                .focusRequester(focus)
                .focusable()
                .semantics { contentDescription = title }
                .testTag(SideCardTags.CARD)
                .padding(start = 18.dp, end = 8.dp, top = 8.dp, bottom = 20.dp),
        ) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text(
                    title.uppercaseForUi(),
                    style = JudgeType.micro.copy(color = ink, letterSpacing = 0.08.em).forScript(),
                    modifier = Modifier.weight(1f).semantics { heading() },
                )
                Box(
                    Modifier
                        .size(44.dp)
                        .clip(CircleShape)
                        .semantics { contentDescription = s.appClose }
                        .clickable(role = Role.Button, onClick = ::shrink)
                        .testTag(SideCardTags.CLOSE),
                    contentAlignment = Alignment.Center,
                ) { TintedIcon(rememberIcon(ink) { JudgeIcons.close(it) }, 18) }
            }
            Text(
                text,
                style = JudgeType.body.copy(fontSize = 16.sp, lineHeight = (16 * 1.5).sp, fontWeight = FontWeight.Normal),
                modifier = Modifier.weight(1f, fill = false).padding(end = 10.dp).verticalScroll(scroll),
            )
        }
    }
}
