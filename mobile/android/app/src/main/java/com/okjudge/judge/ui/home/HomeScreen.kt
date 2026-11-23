package com.okjudge.judge.ui.home

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutLinearInEasing
import androidx.compose.animation.core.VectorConverter
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.util.VelocityTracker
import androidx.compose.ui.layout.SubcomposeLayout
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.okjudge.judge.core.cases.CaseLogic
import com.okjudge.judge.core.display.ArgumentRules
import com.okjudge.judge.core.display.CourtScene
import com.okjudge.judge.core.display.Errors
import com.okjudge.judge.core.display.PartyNames
import com.okjudge.judge.core.display.UiError
import com.okjudge.judge.core.display.Venues
import com.okjudge.judge.core.evidence.EvidenceState
import com.okjudge.judge.core.evidence.ImageSource
import com.okjudge.judge.core.model.Side
import com.okjudge.judge.core.premium.Tiers
import com.okjudge.judge.i18n.AppLang
import com.okjudge.judge.i18n.LocalLang
import com.okjudge.judge.i18n.LocalStrings
import com.okjudge.judge.ui.components.CourtView
import com.okjudge.judge.ui.components.GhostButton
import com.okjudge.judge.ui.components.JudgeIcons
import com.okjudge.judge.ui.components.LocalGamify
import com.okjudge.judge.ui.components.TintedIcon
import com.okjudge.judge.ui.components.clearFocusOnTap
import com.okjudge.judge.ui.components.dragDismissesKeyboard
import com.okjudge.judge.ui.components.neonEdge
import com.okjudge.judge.ui.components.rememberIcon
import com.okjudge.judge.ui.judging.rememberReducedMotion
import com.okjudge.judge.ui.premium.AddContextButton
import com.okjudge.judge.ui.premium.EvidenceRows
import com.okjudge.judge.ui.premium.rememberEvidencePicker
import com.okjudge.judge.ui.theme.JudgeShapes
import com.okjudge.judge.ui.theme.JudgeType
import com.okjudge.judge.ui.theme.LocalSides
import com.okjudge.judge.ui.theme.Palette
import com.okjudge.judge.ui.theme.SideColors
import java.text.NumberFormat
import kotlin.math.roundToInt
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

/** Below this window height (a phone on its side) the court is dropped. */
internal val SHORT_WINDOW = 480.dp

/** From this width the court scales with the screen instead of stopping at phone size. */
private val WIDE_SCREEN = 600.dp

object HomeTags {
    const val INPUT = "home.input"
    const val OTHER = "home.other"
    const val SUBMIT = "home.submit"
    const val COUNTER = "home.counter"
    const val ERROR = "home.error"
    const val STATUS = "home.status"
    const val NAME = "home.name"
    const val OTHER_NAME = "home.otherName"
    const val SEND_LINK = "home.sendLink"
    const val EXAMPLE = "home.example"
    const val ADD_THEIRS = "home.addTheirs"
    const val ADD_SIDE = "home.addSide"
    const val REMOVE_THEIRS = "home.removeTheirs"
    const val REMOVE_SIDE = "home.removeSide"

    /** The writing box of side C or D. */
    fun side(side: Side): String = "home.side.${side.raw}"
    fun sideName(side: Side): String = "home.side.${side.raw}.name"
    const val CLEAR = "home.clear"
    const val BALANCE = "home.balance"
    const val COURT = "home.court"
    const val LIFTED = "home.lifted"
    const val SCRIM = "home.scrim"
    const val CLOSE = "home.close"
}

/**
 * Home, laid out like a chat: the boxes stack in the page, each with its own "Add context" and pictures at
 * its bottom edge, and only the send row (counter, Clear and the send button) is pinned under them. With
 * one side the box is written in where it stands; with more, the boxes only show their text, and a tap
 * lifts that side's box above the keyboard to write in. Drag it away to put it back, or tap the dim page.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun HomeScreen(
    state: HomeUiState,
    onArgumentChange: (String) -> Unit,
    onSubmit: () -> Unit,
    onDismissError: () -> Unit,
    modifier: Modifier = Modifier,
    venue: String = Venues.COURT,
    onOtherSideChange: (String) -> Unit = {},
    onOtherName: (String) -> Unit = {},
    onSendLink: () -> Unit = {},
    onExample: () -> Unit = {},
    onAddTheirSide: () -> Unit = {},
    onRemoveTheirSide: () -> Unit = {},
    onAddSide: () -> Unit = {},
    onRemoveLastSide: () -> Unit = {},
    onExtraSide: (index: Int, text: String) -> Unit = { _, _ -> },
    onExtraName: (index: Int, name: String) -> Unit = { _, _ -> },
    onClear: () -> Unit = {},
    onAddEvidence: (Side, List<ImageSource>) -> Unit = { _, _ -> },
    onRemoveEvidence: (Side, String) -> Unit = { _, _ -> },
    onDisplayName: (String) -> Unit = {},
    onAddContextSignIn: () -> Unit = {},
) {
    val s = LocalStrings.current
    val reduced = rememberReducedMotion()
    val scope = rememberCoroutineScope()
    val focus = LocalFocusManager.current
    val keyboard = LocalSoftwareKeyboardController.current
    val density = LocalDensity.current
    val ime = WindowInsets.ime

    // Re-evaluate the rate-limit block once a second while it lasts.
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    val blockedUntil = state.blockedUntil
    LaunchedEffect(blockedUntil) {
        while (blockedUntil != null && System.currentTimeMillis() < blockedUntil) {
            now = System.currentTimeMillis()
            delay(1000)
        }
        now = System.currentTimeMillis()
    }
    val blocked = blockedUntil != null && now < blockedUntil
    val length = state.outgoing(s).length

    // Every box holds its own screenshots, so each has a picker.
    // Signed out, the tap asks for sign-in instead of opening the picker; the draft stays in Home's state.
    val pickers = Side.entries.map { side -> rememberEvidencePicker(state.evidenceOf(side).room) { onAddEvidence(side, it) } }
    val addContext: (Side) -> (() -> Unit)? = { side ->
        val pick = if (state.evidenceOn) pickers[side.ordinal] else if (state.evidenceOffered) onAddContextSignIn else null
        pick.takeIf { !state.evidenceOf(side).full }
    }

    val openSides = state.openSides
    // The side whose box is lifted above the keyboard; [pinned] holds the page still from the lift until
    // the keyboard is gone, so it does not jump while it leaves.
    var active by remember { mutableStateOf<Side?>(null) }
    var lastActive by remember { mutableStateOf(Side.B) }
    active?.let { lastActive = it }
    var pinned by remember { mutableStateOf(false) }
    var thrown by remember { mutableStateOf(false) }
    val drag = remember { Animatable(Offset.Zero, Offset.VectorConverter) }
    var focused by remember { mutableStateOf(emptySet<Side>()) }
    var flashing by remember { mutableStateOf(emptySet<Side>()) }
    val flashJob = remember { arrayOfNulls<Job>(1) }

    val dismiss: () -> Unit = {
        focus.clearFocus()
        keyboard?.hide()
        active = null
    }
    val activate: (Side) -> Unit = { side ->
        if (active == null && !state.holding) {
            thrown = false
            pinned = true
            active = side
            scope.launch { drag.snapTo(Offset.Zero) }
        }
    }
    val throwAway: (Offset) -> Unit = { direction ->
        focus.clearFocus()
        keyboard?.hide()
        val side = active
        if (reduced) {
            active = null
            scope.launch { drag.snapTo(Offset.Zero) }
        } else {
            scope.launch {
                thrown = true
                drag.animateTo(direction / direction.getDistance() * with(density) { 900.dp.toPx() }, tween(220, easing = FastOutLinearInEasing))
                // A box lifted again in the meantime stays up.
                if (thrown && active == side) active = null
                drag.snapTo(Offset.Zero)
            }
        }
    }
    val release: (Offset, Offset) -> Unit = { translation, velocity ->
        val scale = density.density
        val direction = BoxThrow.direction(translation / scale, velocity / scale)
        if (direction != null) throwAway(direction) else scope.launch { drag.animateTo(Offset.Zero, spring()) }
    }
    val releaseNow by rememberUpdatedState(release)

    LaunchedEffect(openSides) { if (active != null && active !in openSides) active = null }
    LaunchedEffect(active) {
        if (active == null) {
            withTimeoutOrNull(1000) { snapshotFlow { ime.getBottom(density) }.first { it == 0 } }
            pinned = false
        } else {
            // The keyboard going away takes the box with it; with a hardware keyboard it never shows.
            snapshotFlow { ime.getBottom(density) > 0 }.first { it }
            snapshotFlow { ime.getBottom(density) > 0 }.first { !it }
            dismiss()
        }
    }
    BackHandler(enabled = active != null, onBack = dismiss)

    val textOf: (Side) -> String = { side ->
        when (side) {
            Side.A -> state.argument
            Side.B -> state.otherSide
            else -> state.more.getOrNull(side.ordinal - 2)?.text.orEmpty()
        }
    }
    // A send with too little written lights the boxes that need text, as if typed in.
    val flashShort: () -> Unit = {
        val short = SendFlash.shortBoxes(openSides.map(textOf)).map { openSides[it] }
        if (!state.holding && short.isNotEmpty()) {
            flashJob[0]?.cancel()
            flashJob[0] = scope.launch {
                for (step in SendFlash.steps(reduced)) {
                    flashing = if (step.lit) short.toSet() else emptySet()
                    delay(step.ms)
                }
                flashing = emptySet()
            }
        }
    }
    val canSend = state.canSubmit && length <= ArgumentRules.MAX && !blocked
    val send: @Composable () -> Unit = {
        SendButton(
            description = s.getVerdict,
            looksReady = canSend,
            waiting = state.holding,
            onClick = {
                if (canSend) {
                    dismiss()
                    onSubmit()
                } else {
                    flashShort()
                }
            },
        )
    }
    val sendRow: @Composable () -> Unit = {
        SendRow(
            count = length,
            showClear = !state.blank,
            clearEnabled = !state.holding,
            onClear = { dismiss(); onClear() },
            send = send,
        )
    }

    val column = Modifier.widthIn(max = 640.dp).fillMaxWidth().padding(horizontal = 16.dp)
    val card: @Composable (Side, Boolean, Modifier) -> Unit = { side, lifted, extra ->
        val last = side == openSides.last()
        val others = Side.first(2).let { side !in it }
        val extraIndex = side.ordinal - 2
        val sides = LocalSides.current
        val writes = lifted || !state.theirsOpen
        val big = density.fontScale >= 1.5f
        SideCard(
            colors = when (side) {
                Side.A -> sides.mine
                Side.B -> sides.theirs
                else -> sides.of(side.raw)
            },
            letter = side.letter,
            label = when (side) {
                Side.A -> s.appHomeYourSide
                Side.B -> s.appHomeTheirSide
                else -> PartyNames.label(side, s)
            },
            showHeader = state.theirsOpen,
            name = when (side) {
                Side.A -> state.shownName
                Side.B -> state.otherName
                else -> state.more.getOrNull(extraIndex)?.name.orEmpty()
            },
            namePlaceholder = if (side == Side.A) s.appHomeYourName else s.appHomeTheirName,
            onName = when (side) {
                Side.A -> onDisplayName
                Side.B -> onOtherName
                else -> ({ name: String -> onExtraName(extraIndex, name) })
            },
            nameTag = when (side) {
                Side.A -> HomeTags.NAME
                Side.B -> HomeTags.OTHER_NAME
                else -> HomeTags.sideName(side)
            },
            text = textOf(side),
            onText = when (side) {
                Side.A -> onArgumentChange
                Side.B -> onOtherSideChange
                else -> ({ text: String -> onExtraSide(extraIndex, text) })
            },
            placeholder = if (side == Side.A) s.appHomeYourPlaceholder else s.appHomeTheirPlaceholder,
            fieldLabel = when (side) {
                Side.A -> s.appHomeYourSideLabel
                Side.B -> s.appHomeTheirSideLabel
                else -> PartyNames.label(side, s)
            },
            minLines = if (lifted) 2 else 3,
            maxLines = if (lifted) (if (big) 4 else 7) else 8,
            tag = when (side) {
                Side.A -> HomeTags.INPUT
                Side.B -> HomeTags.OTHER
                else -> HomeTags.side(side)
            },
            enabled = !state.holding,
            writes = writes,
            lifted = lifted,
            flash = side in flashing,
            onActivate = { activate(side) },
            onClose = dismiss,
            onRemove = if (!last || side == Side.A || lifted) null else if (others) onRemoveLastSide else onRemoveTheirSide,
            removeTag = if (others) HomeTags.REMOVE_SIDE else HomeTags.REMOVE_THEIRS,
            onAddContext = addContext(side),
            evidence = state.evidenceOf(side).takeIf { state.evidenceOn },
            onRemoveEvidence = { onRemoveEvidence(side, it) },
            onFocus = { has ->
                if (!lifted) focused = if (has) focused + side else focused - side
            },
            bottom = sendRow.takeIf { lifted },
            modifier = if (lifted) extra else if (active == side) Modifier.alpha(0f).clearAndSetSemantics { } else Modifier,
        )
    }
    val form: @Composable ColumnScope.() -> Unit = {
        openSides.forEach { card(it, false, Modifier) }
        val offerLink = state.casesOn && (!state.theirsOpen || state.more.isNotEmpty())
        if (!state.theirsOpen || state.showsAddSide || offerLink) {
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                if (!state.theirsOpen) {
                    GhostButton(
                        s.appHomeAddTheirSide,
                        rememberIcon(Palette.ink) { JudgeIcons.plus(it) },
                        onClick = onAddTheirSide,
                        modifier = Modifier.testTag(HomeTags.ADD_THEIRS),
                        enabled = !state.holding,
                    )
                }
                if (state.showsAddSide) {
                    GhostButton(
                        s.homeAddSide,
                        rememberIcon(Palette.ink) { JudgeIcons.plus(it) },
                        onClick = onAddSide,
                        modifier = Modifier.testTag(HomeTags.ADD_SIDE),
                        enabled = !state.holding,
                    )
                }
                if (offerLink) {
                    GhostButton(
                        s.appHomeSendLink,
                        rememberIcon(Palette.ink) { JudgeIcons.link(it) },
                        onClick = onSendLink,
                        modifier = Modifier.testTag(HomeTags.SEND_LINK),
                        enabled = state.canSendLink && !blocked,
                    )
                }
            }
        }
        state.error?.let { ErrorBanner(it, onDismissError) }
        if (state.offersExample) {
            QuietAction(
                s.appHomeExample,
                onExample,
                !state.holding,
                Modifier.padding(horizontal = 4.dp).testTag(HomeTags.EXAMPLE),
                icon = rememberIcon(Palette.ink2) { JudgeIcons.shuffle(it) },
            )
        }
    }

    val scroll = rememberScrollState()
    // The window's height, not the free space: the keyboard must not swap the layout under the cursor.
    val shortWindow = LocalConfiguration.current.screenHeightDp < SHORT_WINDOW.value
    val lifting = active != null
    BoxWithConstraints(modifier.fillMaxSize().background(Palette.ivory).clearFocusOnTap()) {
        val pageWidth = maxWidth
        Column(
            Modifier.fillMaxSize().then(if (pinned) Modifier else Modifier.imePadding()),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            BoxWithConstraints(Modifier.weight(1f).fillMaxWidth().then(if (lifting) Modifier.clearAndSetSemantics { } else Modifier)) {
                val region = maxHeight
                // Reversed, so the content stays against the send row as it grows.
                Column(Modifier.fillMaxSize().dragDismissesKeyboard().verticalScroll(scroll, reverseScrolling = true)) {
                    Column(
                        Modifier.fillMaxWidth().heightIn(min = region),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.Bottom,
                    ) {
                        if (LocalGamify.current && !shortWindow) {
                            // A fixed 16:9 frame, so more sides scroll the page instead of squeezing the court; it
                            // gives way while writing.
                            // 16/9 inside the page width; wide screens let it grow with the width, phones stay at 480.
                            val width = minOf(pageWidth - 32.dp, if (pageWidth >= WIDE_SCREEN) pageWidth * 0.92f else 480.dp)
                            val frame by animateDpAsState(
                                if (focused.isNotEmpty() || pinned) 0.dp else width * 9f / 16f + 4.dp,
                                if (reduced) snap() else tween(200),
                                label = "court",
                            )
                            Box(Modifier.fillMaxWidth().height(frame).clipToBounds(), contentAlignment = Alignment.TopCenter) {
                                CourtView(CourtScene.Home(busy = state.holding, venue = venue), reduced, Modifier.width(width).aspectRatio(16f / 9f).testTag(HomeTags.COURT))
                            }
                        }
                        Column(column.padding(top = 8.dp, bottom = 12.dp), verticalArrangement = Arrangement.spacedBy(12.dp), content = form)
                    }
                }
            }
            Column(
                column.padding(bottom = 16.dp).then(if (lifting) Modifier.clearAndSetSemantics { } else Modifier),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                sendRow()
                if (state.holding) {
                    Row(
                        Modifier.fillMaxWidth().semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Polite }.testTag(HomeTags.STATUS),
                        horizontalArrangement = Arrangement.Center,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        CircularProgressIndicator(Modifier.padding(end = 8.dp).size(14.dp), color = Palette.ink2, strokeWidth = 1.5.dp)
                        Text(if (state.creating) s.caseCreating else s.tierChecking, style = JudgeType.slotText)
                    }
                } else if (state.signedIn) {
                    Tiers.balance(s, state.entitlement)?.let {
                        Text(
                            it,
                            style = JudgeType.slotText,
                            textAlign = TextAlign.Center,
                            modifier = Modifier.fillMaxWidth().testTag(HomeTags.BALANCE),
                        )
                    }
                }
            }
        }
        AnimatedVisibility(
            visible = active != null && state.theirsOpen,
            modifier = Modifier.fillMaxSize(),
            enter = fadeIn(tween(200)) + if (reduced) EnterTransition.None else slideInVertically(tween(300)) { it / 3 },
            exit = fadeOut(tween(200)) + if (reduced) ExitTransition.None else slideOutVertically(tween(200)) { it / 3 },
        ) {
            val side = active ?: lastActive
            Box(Modifier.fillMaxSize()) {
                Box(
                    Modifier
                        .fillMaxSize()
                        .background(Color.Black.copy(alpha = 0.2f))
                        .semantics {
                            role = Role.Button
                            contentDescription = s.appClose
                        }
                        .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null, onClick = dismiss)
                        .testTag(HomeTags.SCRIM),
                )
                BoxWithConstraints(Modifier.fillMaxSize().imePadding(), contentAlignment = Alignment.BottomCenter) {
                    val room = maxHeight - 8.dp
                    val shown by animateFloatAsState(if (thrown) 0f else 1f, tween(220), label = "thrown")
                    Box(Modifier.widthIn(max = 640.dp).fillMaxWidth().padding(start = 16.dp, end = 16.dp, bottom = 8.dp)) {
                        card(
                            side,
                            true,
                            Modifier
                                .heightIn(max = room)
                                .offset { IntOffset(drag.value.x.roundToInt(), drag.value.y.roundToInt()) }
                                .alpha(shown)
                                .pointerInput(Unit) {
                                    val tracker = VelocityTracker()
                                    var moved = Offset.Zero
                                    detectDragGestures(
                                        onDragStart = {
                                            tracker.resetTracking()
                                            moved = drag.value
                                        },
                                        onDrag = { change, amount ->
                                            change.consume()
                                            moved += amount
                                            tracker.addPosition(change.uptimeMillis, moved)
                                            scope.launch { drag.snapTo(moved) }
                                        },
                                        onDragEnd = {
                                            val v = tracker.calculateVelocity()
                                            releaseNow(moved, Offset(v.x, v.y))
                                        },
                                        onDragCancel = { scope.launch { drag.animateTo(Offset.Zero, spring()) } },
                                    )
                                }
                                .testTag(HomeTags.LIFTED),
                        )
                    }
                }
            }
        }
    }
}

/**
 * One side: over what it says, the letter and a name field (only once there are two sides); the label is for
 * screen readers. A box that is not written in shows its text, and a tap lifts it; [lifted] is the copy above
 * the keyboard, with a handle to drag it by, a close button and the send row at its foot.
 */
@Composable
private fun SideCard(
    colors: SideColors,
    letter: String,
    label: String,
    showHeader: Boolean,
    name: String,
    namePlaceholder: String,
    onName: (String) -> Unit,
    nameTag: String,
    text: String,
    onText: (String) -> Unit,
    placeholder: String,
    fieldLabel: String,
    minLines: Int,
    maxLines: Int,
    tag: String,
    enabled: Boolean,
    writes: Boolean,
    lifted: Boolean,
    flash: Boolean,
    onActivate: () -> Unit,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
    onRemove: (() -> Unit)? = null,
    removeTag: String = HomeTags.REMOVE_THEIRS,
    onAddContext: (() -> Unit)? = null,
    evidence: EvidenceState? = null,
    onRemoveEvidence: (String) -> Unit = {},
    onFocus: (Boolean) -> Unit = {},
    bottom: (@Composable () -> Unit)? = null,
) {
    val s = LocalStrings.current
    var focused by remember { mutableStateOf(false) }
    val editor = remember { FocusRequester() }
    val keyboard = LocalSoftwareKeyboardController.current
    if (lifted) {
        LaunchedEffect(Unit) {
            withFrameNanos { }
            editor.requestFocus()
            keyboard?.show()
        }
    }
    DisposableEffect(Unit) { onDispose { onFocus(false) } }
    Column(
        modifier
            .fillMaxWidth()
            .neonEdge(if (flash) Palette.danger else colors.strong, focused || lifted || flash, JudgeShapes.block)
            .onFocusChanged {
                focused = it.hasFocus
                onFocus(it.hasFocus)
            }
            .padding(start = 16.dp, end = 16.dp, top = if (lifted) 4.dp else 14.dp, bottom = 10.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        if (lifted) {
            Box(Modifier.fillMaxWidth().heightIn(min = 16.dp).clearAndSetSemantics { }, contentAlignment = Alignment.Center) {
                Box(Modifier.size(width = 36.dp, height = 5.dp).background(Palette.line2, CircleShape))
            }
        }
        if (showHeader) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Box(
                Modifier.size(24.dp).clip(CircleShape).background(colors.ink).clearAndSetSemantics { contentDescription = label },
                contentAlignment = Alignment.Center,
            ) {
                Text(letter, style = JudgeType.micro.copy(color = Palette.paper, letterSpacing = 0.sp))
            }
            BasicTextField(
                value = name,
                onValueChange = { onName(it.take(CaseLogic.MAX_DISPLAY_NAME)) },
                enabled = enabled,
                singleLine = true,
                textStyle = JudgeType.slotTitle,
                cursorBrush = SolidColor(Palette.terraInk),
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Words),
                modifier = Modifier
                    .weight(1f)
                    .heightIn(min = 32.dp)
                    .semantics { contentDescription = namePlaceholder }
                    .testTag(nameTag),
                decorationBox = { inner ->
                    Box(contentAlignment = Alignment.CenterStart) {
                        if (name.isEmpty()) Text(namePlaceholder, style = JudgeType.slotTitle.copy(color = Palette.placeholder))
                        inner()
                    }
                },
            )
            if (onRemove != null) {
                Box(
                    Modifier
                        .size(44.dp)
                        .clip(CircleShape)
                        .semantics {
                            role = Role.Button
                            contentDescription = s.appHomeRemoveTheirSide
                        }
                        .clickable(enabled = enabled, onClick = onRemove)
                        .testTag(removeTag),
                    contentAlignment = Alignment.Center,
                ) {
                    Box(Modifier.size(26.dp).background(Palette.ivory2, CircleShape), contentAlignment = Alignment.Center) {
                        TintedIcon(rememberIcon(Palette.ink2) { JudgeIcons.close(it) }, 12)
                    }
                }
            }
            if (lifted) {
                Box(
                    Modifier
                        .size(44.dp)
                        .clip(CircleShape)
                        .semantics {
                            role = Role.Button
                            contentDescription = s.appClose
                        }
                        .clickable(onClick = onClose)
                        .testTag(HomeTags.CLOSE),
                    contentAlignment = Alignment.Center,
                ) {
                    Box(Modifier.size(26.dp).background(Palette.ivory2, CircleShape), contentAlignment = Alignment.Center) {
                        TintedIcon(rememberIcon(Palette.ink2) { JudgeIcons.caret(it) }, 12)
                    }
                }
            }
        }
        // The lifted box gives its text what the rest leaves; more scrolls inside the box.
        val field = if (lifted) Modifier.weight(1f, fill = false) else Modifier
        if (writes) {
            BasicTextField(
                value = text,
                onValueChange = { onText(it.take(ArgumentRules.MAX)) },
                enabled = enabled,
                textStyle = SideText,
                cursorBrush = SolidColor(Palette.terraInk),
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
                minLines = minLines,
                maxLines = maxLines,
                modifier = field.fillMaxWidth().focusRequester(editor).semantics { contentDescription = fieldLabel }.testTag(tag),
                decorationBox = { inner ->
                    Box {
                        if (text.isEmpty()) Text(placeholder, style = SideText.copy(color = Palette.placeholder))
                        inner()
                    }
                },
            )
        } else {
            Text(
                text.ifEmpty { placeholder },
                style = SideText.copy(color = if (text.isEmpty()) Palette.placeholder else Palette.ink),
                minLines = minLines,
                maxLines = maxLines,
                overflow = TextOverflow.Ellipsis,
                modifier = field
                    .fillMaxWidth()
                    .semantics {
                        role = Role.Button
                        contentDescription = fieldLabel
                        stateDescription = text
                    }
                    .clickable(enabled = enabled, onClick = onActivate)
                    .testTag(tag),
            )
        }
        if (onAddContext != null || (evidence != null && evidence.hasRows)) {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                if (onAddContext != null) AddContextButton(enabled, onAddContext)
                if (evidence != null && evidence.hasRows) {
                    // The lifted box leaves room for this much; more scrolls.
                    val rows = if (lifted) Modifier.heightIn(max = 100.dp).verticalScroll(rememberScrollState()) else Modifier
                    EvidenceRows(evidence, disabled = !enabled, onRemove = onRemoveEvidence, modifier = rows)
                }
            }
        }
        bottom?.invoke()
    }
}

private val SideText: TextStyle
    @Composable
    @ReadOnlyComposable
    get() = JudgeType.body.copy(fontSize = 15.sp, lineHeight = (15 * 1.5).sp)

/** A small text button above the writing box (an example, clear). */
@Composable
private fun QuietAction(text: String, onClick: () -> Unit, enabled: Boolean, modifier: Modifier = Modifier, icon: ImageVector? = null) {
    Row(
        modifier
            .defaultMinSize(minHeight = 44.dp)
            .clip(JudgeShapes.chip)
            .alpha(if (enabled) 1f else 0.5f)
            .semantics { role = Role.Button }
            .clickable(enabled = enabled, onClick = onClick)
            .padding(horizontal = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        if (icon != null) TintedIcon(icon, 14)
        Text(text, style = JudgeType.small)
    }
}

/** What would be sent, joined names included, against the limit. */
@Composable
private fun Counter(count: Int, lang: AppLang, modifier: Modifier = Modifier) {
    val s = LocalStrings.current
    val nf = remember(lang) { NumberFormat.getIntegerInstance(lang.locale) }
    val warn = count > ArgumentRules.WARN_AT
    Text(
        s.appInputCounter(nf.format(count), nf.format(ArgumentRules.MAX)),
        style = JudgeType.footnote.copy(color = if (warn) Palette.terraInk else Palette.muted),
        maxLines = 1,
        modifier = modifier.testTag(HomeTags.COUNTER),
    )
}

/** At the leading edge of the send row: icon and word when they fit, the icon alone when they don't. */
@Composable
private fun ClearButton(compact: Boolean, enabled: Boolean, onClick: () -> Unit) {
    val s = LocalStrings.current
    Box(
        Modifier
            .defaultMinSize(minWidth = 44.dp, minHeight = 44.dp)
            .alpha(if (enabled) 1f else 0.4f)
            .semantics {
                role = Role.Button
                contentDescription = s.appHomeClear
            }
            .clickable(enabled = enabled, onClick = onClick)
            .testTag(HomeTags.CLEAR),
        contentAlignment = Alignment.Center,
    ) {
        Row(
            Modifier
                .height(40.dp)
                .clip(JudgeShapes.field)
                .background(Palette.danger.copy(alpha = 0.1f))
                .border(1.dp, Palette.danger.copy(alpha = 0.6f), JudgeShapes.field)
                .padding(horizontal = CLEAR_PAD),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(CLEAR_GAP),
        ) {
            TintedIcon(rememberIcon(Palette.danger) { JudgeIcons.trash(it) }, (CLEAR_ICON.value * LocalDensity.current.fontScale).toInt())
            if (!compact) Text(s.appHomeClear, style = JudgeType.small.copy(color = Palette.danger), maxLines = 1)
        }
    }
}

private val CLEAR_PAD = 12.dp
private val CLEAR_GAP = 6.dp
private val CLEAR_ICON = 14.dp

/** Clear at the leading edge, the counter and the send button at the trailing one; Clear gives way first, down to its icon. */
@Composable
private fun SendRow(count: Int, showClear: Boolean, clearEnabled: Boolean, onClear: () -> Unit, send: @Composable () -> Unit) {
    val s = LocalStrings.current
    val lang = LocalLang.current
    val measurer = rememberTextMeasurer()
    val style = JudgeType.small
    SubcomposeLayout(Modifier.fillMaxWidth().height(44.dp)) { constraints ->
        val gap = 12.dp.roundToPx()
        val sendP = subcompose("send", send).first().measure(Constraints())
        val counterP = subcompose("counter") { Counter(count, lang) }.first().measure(Constraints())
        val room = constraints.maxWidth - sendP.width - counterP.width - 2 * gap
        val clearP = if (showClear) {
            val label = measurer.measure(s.appHomeClear, style, maxLines = 1).size.width
            val full = (CLEAR_PAD * 2 + CLEAR_GAP).roundToPx() + (CLEAR_ICON.toPx() * fontScale).toInt() + label
            subcompose("clear") { ClearButton(compact = full > room, enabled = clearEnabled, onClick = onClear) }.first().measure(Constraints())
        } else {
            null
        }
        layout(constraints.maxWidth, 44.dp.roundToPx()) {
            val y = 44.dp.roundToPx()
            var x = constraints.maxWidth - sendP.width
            sendP.placeRelative(x, (y - sendP.height) / 2)
            x -= gap + counterP.width
            counterP.placeRelative(x, (y - counterP.height) / 2)
            clearP?.placeRelative(0, (y - clearP.height) / 2)
        }
    }
}

/** Still tappable when it looks dim: a send with too little written lights the boxes that need text. */
@Composable
internal fun SendButton(
    description: String,
    looksReady: Boolean,
    waiting: Boolean,
    onClick: () -> Unit,
    tag: String = HomeTags.SUBMIT,
    enabled: Boolean = true,
) {
    Box(
        Modifier
            .offset(x = 6.dp)
            .size(44.dp)
            .clip(CircleShape)
            .semantics {
                role = Role.Button
                contentDescription = description
            }
            .clickable(enabled = enabled && !waiting, onClick = onClick)
            .testTag(tag),
        contentAlignment = Alignment.Center,
    ) {
        Box(
            Modifier.size(38.dp).alpha(if (looksReady || waiting) 1f else 0.35f).background(Palette.ink, CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            if (waiting) {
                CircularProgressIndicator(Modifier.size(16.dp), color = Palette.paper, strokeWidth = 2.dp)
            } else {
                TintedIcon(rememberIcon(Palette.paper) { JudgeIcons.arrow(it) }, 18, Modifier.rotate(-90f))
            }
        }
    }
}

private val ErrorShape = RoundedCornerShape(16.dp)

@Composable
private fun ErrorBanner(error: UiError, onDismiss: () -> Unit) {
    val s = LocalStrings.current
    val lang = LocalLang.current
    val text = Errors.message(error, s, lang)
    Row(
        Modifier
            .fillMaxWidth()
            .clip(ErrorShape)
            .background(Palette.terraTint.copy(alpha = 0.55f))
            .border(1.dp, Palette.terra.copy(alpha = 0.35f), ErrorShape)
            .semantics { liveRegion = LiveRegionMode.Polite }
            .testTag(HomeTags.ERROR)
            .padding(start = 14.dp, top = 8.dp, bottom = 8.dp, end = 4.dp),
        verticalAlignment = Alignment.Top,
    ) {
        TintedIcon(rememberIcon(Palette.danger) { JudgeIcons.alert(it) }, 16, Modifier.padding(top = 6.dp, end = 8.dp))
        Text(
            text,
            style = JudgeType.slotText.copy(color = Palette.ink),
            modifier = Modifier.weight(1f).padding(top = 4.dp),
        )
        Box(
            Modifier
                .clip(JudgeShapes.chip)
                .semantics { contentDescription = s.appCancel }
                .clickable(onClick = onDismiss)
                .padding(8.dp),
        ) { TintedIcon(rememberIcon(Palette.ink2) { JudgeIcons.close(it) }, 16) }
    }
}
