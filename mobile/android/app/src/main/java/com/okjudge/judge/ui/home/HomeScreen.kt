package com.okjudge.judge.ui.home

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.okjudge.judge.core.cases.CaseLogic
import com.okjudge.judge.core.display.ArgumentRules
import com.okjudge.judge.core.display.CourtScene
import com.okjudge.judge.core.display.Venues
import com.okjudge.judge.core.display.Errors
import com.okjudge.judge.core.display.PartyNames
import com.okjudge.judge.core.display.UiError
import com.okjudge.judge.core.evidence.ImageSource
import com.okjudge.judge.core.model.Side
import com.okjudge.judge.core.premium.Tiers
import com.okjudge.judge.i18n.AppLang
import com.okjudge.judge.i18n.LocalLang
import com.okjudge.judge.i18n.LocalStrings
import com.okjudge.judge.ui.components.dragDismissesKeyboard
import com.okjudge.judge.ui.components.CourtView
import com.okjudge.judge.ui.components.LocalGamify
import com.okjudge.judge.ui.components.GhostButton
import com.okjudge.judge.ui.components.JudgeIcons
import com.okjudge.judge.ui.components.TintedIcon
import com.okjudge.judge.ui.components.rememberIcon
import com.okjudge.judge.ui.components.clearFocusOnTap
import com.okjudge.judge.ui.components.neonEdge
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
import kotlinx.coroutines.delay

/** The least height the court is drawn at, however crowded the form is. */
private val COURT_MIN_HEIGHT = 110.dp

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
}

/**
 * Home, laid out like a chat: the writing box sits at the bottom with the send
 * button inside it, and the other side, the context and the actions stack above it.
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
    onAddEvidence: (List<ImageSource>) -> Unit = {},
    onRemoveEvidence: (String) -> Unit = {},
    onDisplayName: (String) -> Unit = {},
    onAddContextSignIn: () -> Unit = {},
) {
    val s = LocalStrings.current

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

    // The server takes one set of screenshots for the verdict, so they belong to the case.
    // Signed out, the tap asks for sign-in instead of opening the picker; the draft stays in Home's state.
    val picker = rememberEvidencePicker(state.evidence.room, onAddEvidence)
    val pickContext = if (state.evidenceOn) picker else if (state.evidenceOffered) onAddContextSignIn else null
    val addContext = pickContext.takeIf { !state.evidence.full }

    val column = Modifier.widthIn(max = 640.dp).fillMaxWidth().padding(horizontal = 16.dp)
    val send: @Composable () -> Unit = {
        SendButton(
            description = s.getVerdict,
            enabled = state.canSubmit && length <= ArgumentRules.MAX && !blocked,
            waiting = state.holding,
            onClick = onSubmit,
        )
    }
    // The cards on Home, A first. The last one is the composer at the bottom with the send button; the
    // ones before it sit above in the page.
    val openSides = state.openSides
    val lastSide = openSides.last()
    val card: @Composable (Side, Dp) -> Unit = { side, fieldMax ->
        val last = side == lastSide
        val others = Side.first(2).let { side !in it }
        val extraIndex = side.ordinal - 2
        val sides = LocalSides.current
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
            text = when (side) {
                Side.A -> state.argument
                Side.B -> state.otherSide
                else -> state.more.getOrNull(extraIndex)?.text.orEmpty()
            },
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
            minLines = if (last) 2 else 3,
            maxLines = if (last) 7 else 8,
            tag = when (side) {
                Side.A -> HomeTags.INPUT
                Side.B -> HomeTags.OTHER
                else -> HomeTags.side(side)
            },
            enabled = !state.holding,
            onRemove = if (!last || side == Side.A) null else if (others) onRemoveLastSide else onRemoveTheirSide,
            removeTag = if (others) HomeTags.REMOVE_SIDE else HomeTags.REMOVE_THEIRS,
            onAddContext = addContext.takeIf { side == Side.A || last },
            count = length.takeIf { last },
            trailing = send.takeIf { last },
            fieldMax = if (last) fieldMax else Dp.Unspecified,
        )
    }
    val middle: @Composable ColumnScope.() -> Unit = {
        if (state.theirsOpen) openSides.dropLast(1).forEach { card(it, Dp.Unspecified) }
        if (state.evidenceOn && state.evidence.hasRows) {
            EvidenceRows(state.evidence, disabled = state.holding, onRemove = onRemoveEvidence)
        }
        state.error?.let { ErrorBanner(it, onDismissError) }
        if (state.offersExample || !state.blank) {
            FlowRow(
                Modifier.fillMaxWidth().padding(horizontal = 4.dp),
                horizontalArrangement = Arrangement.spacedBy(14.dp),
                verticalArrangement = Arrangement.Center,
            ) {
                if (state.offersExample) {
                    QuietAction(
                        s.appHomeExample,
                        onExample,
                        !state.holding,
                        Modifier.testTag(HomeTags.EXAMPLE),
                        icon = rememberIcon(Palette.ink2) { JudgeIcons.shuffle(it) },
                    )
                }
                if (!state.blank) {
                    QuietAction(s.appHomeClear, onClear, !state.holding, Modifier.testTag(HomeTags.CLEAR))
                }
            }
        }
        val offerLink = state.casesOn && (!state.theirsOpen || state.more.isNotEmpty())
        if (!state.theirsOpen || state.canAddSide || offerLink) {
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
                if (state.canAddSide) {
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
    }

    val scroll = rememberScrollState()
    BoxWithConstraints(modifier.fillMaxSize().background(Palette.ivory).imePadding().clearFocusOnTap()) {
        // No court: the form and the composer scroll together from the top.
        val flat = !LocalGamify.current
        // A short screen with the keyboard up still has to leave room for the send row.
        val fieldMax = if (flat) 120.dp else maxHeight * 0.25f
        val form: @Composable () -> Unit = {
            Column(column.padding(top = 16.dp, bottom = 20.dp), verticalArrangement = Arrangement.spacedBy(12.dp), content = middle)
        }
        val composer: @Composable ColumnScope.() -> Unit = {
            if (state.theirsOpen) {
                card(lastSide, fieldMax)
            } else {
                SideCard(
                    colors = LocalSides.current.mine,
                    letter = "A",
                    label = s.appHomeYourSide,
                    showHeader = false,
                    name = state.shownName,
                    namePlaceholder = s.appHomeYourName,
                    onName = onDisplayName,
                    nameTag = HomeTags.NAME,
                    text = state.argument,
                    onText = onArgumentChange,
                    placeholder = s.appHomeYourPlaceholder,
                    fieldLabel = s.appHomeYourSideLabel,
                    minLines = 2,
                    maxLines = 7,
                    tag = HomeTags.INPUT,
                    enabled = !state.holding,
                    onAddContext = addContext,
                    count = length,
                    trailing = send,
                    fieldMax = fieldMax,
                )
            }
            if (state.holding) {
                Row(
                    Modifier.fillMaxWidth().padding(top = 28.dp).semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Polite }.testTag(HomeTags.STATUS),
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
                        modifier = Modifier.fillMaxWidth().padding(top = 28.dp).testTag(HomeTags.BALANCE),
                    )
                }
            }
        }
        if (flat) {
            Column(
                Modifier.fillMaxSize().dragDismissesKeyboard().verticalScroll(scroll),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                form()
                Column(column.padding(bottom = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp), content = composer)
            }
        } else {
            Column(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally) {
                BoxWithConstraints(Modifier.weight(1f).fillMaxWidth()) {
                    val region = maxHeight
                    // Reversed, so the content stays against the composer as it grows.
                    Column(Modifier.fillMaxSize().dragDismissesKeyboard().verticalScroll(scroll, reverseScrolling = true)) {
                        CourtAbove(
                            region,
                            court = {
                                BoxWithConstraints(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                                    // 16/9 inside the free space; wide screens let it grow with the width, phones stay at 480.
                                    val cap = if (maxWidth >= WIDE_SCREEN) maxWidth * 0.92f else 480.dp
                                    val width = minOf(maxWidth - 32.dp, (maxHeight - 16.dp) * 16f / 9f, cap)
                                    CourtView(CourtScene.Home(busy = state.holding, venue = venue), rememberReducedMotion(), Modifier.width(width).aspectRatio(16f / 9f).testTag(HomeTags.COURT))
                                }
                            },
                            form = form,
                        )
                    }
                }
                Column(column.padding(bottom = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp), content = composer)
            }
        }
    }
}

/**
 * The court over the form. The court takes the room the form leaves in [region], but never less than
 * [COURT_MIN_HEIGHT]: a crowded page grows past [region] and scrolls instead of losing the court.
 */
@Composable
private fun CourtAbove(region: Dp, court: @Composable () -> Unit, form: @Composable () -> Unit) {
    Layout({ Box { court() }; Box { form() } }) { (courtBox, formBox), constraints ->
        val width = constraints.maxWidth
        val formPlaced = formBox.measure(Constraints(maxWidth = width))
        val courtHeight = maxOf(region.roundToPx() - formPlaced.height, COURT_MIN_HEIGHT.roundToPx())
        val courtPlaced = courtBox.measure(Constraints.fixed(width, courtHeight))
        layout(width, courtHeight + formPlaced.height) {
            courtPlaced.place(0, 0)
            formPlaced.place((width - formPlaced.width) / 2, courtHeight)
        }
    }
}

/** One side: over what it says, the letter and a name field (only once there are two sides); the label is for screen readers. */
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
    onRemove: (() -> Unit)? = null,
    removeTag: String = HomeTags.REMOVE_THEIRS,
    onAddContext: (() -> Unit)? = null,
    count: Int? = null,
    trailing: (@Composable () -> Unit)? = null,
    fieldMax: Dp = Dp.Unspecified,
) {
    val s = LocalStrings.current
    var focused by remember { mutableStateOf(false) }
    Column(
        Modifier
            .fillMaxWidth()
            .neonEdge(colors.strong, focused, JudgeShapes.block)
            .onFocusChanged { focused = it.hasFocus }
            .padding(horizontal = 16.dp, vertical = 14.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
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
        }
        BasicTextField(
            value = text,
            onValueChange = { onText(it.take(ArgumentRules.MAX)) },
            enabled = enabled,
            textStyle = SideText,
            cursorBrush = SolidColor(Palette.terraInk),
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
            minLines = minLines,
            maxLines = maxLines,
            modifier = Modifier.fillMaxWidth().heightIn(max = fieldMax).semantics { contentDescription = fieldLabel }.testTag(tag),
            decorationBox = { inner ->
                Box {
                    if (text.isEmpty()) Text(placeholder, style = SideText.copy(color = Palette.placeholder))
                    inner()
                }
            },
        )
        if (onAddContext != null || count != null || trailing != null) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                // The label gives way, the counter and the send button keep their size.
                Box(Modifier.weight(1f), contentAlignment = Alignment.CenterStart) {
                    if (onAddContext != null) AddContextButton(enabled, onAddContext)
                }
                if (count != null) Counter(count, LocalLang.current)
                if (trailing != null) {
                    Spacer(Modifier.width(10.dp))
                    trailing()
                }
            }
        }
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

@Composable
private fun SendButton(description: String, enabled: Boolean, waiting: Boolean, onClick: () -> Unit) {
    Box(
        Modifier
            .offset(x = 6.dp)
            .size(44.dp)
            .clip(CircleShape)
            .semantics {
                role = Role.Button
                contentDescription = description
            }
            .clickable(enabled = enabled, onClick = onClick)
            .testTag(HomeTags.SUBMIT),
        contentAlignment = Alignment.Center,
    ) {
        Box(
            Modifier.size(38.dp).alpha(if (enabled || waiting) 1f else 0.35f).background(Palette.ink, CircleShape),
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
