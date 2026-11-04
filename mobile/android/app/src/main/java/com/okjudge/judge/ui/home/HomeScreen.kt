package com.okjudge.judge.ui.home

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
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
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.SolidColor
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.okjudge.judge.core.cases.CaseLogic
import com.okjudge.judge.core.display.ArgumentRules
import com.okjudge.judge.core.display.Errors
import com.okjudge.judge.core.display.UiError
import com.okjudge.judge.core.evidence.ImageSource
import com.okjudge.judge.core.premium.Tiers
import com.okjudge.judge.i18n.AppLang
import com.okjudge.judge.i18n.LocalLang
import com.okjudge.judge.i18n.LocalStrings
import com.okjudge.judge.ui.components.GhostButton
import com.okjudge.judge.ui.components.JudgeIcons
import com.okjudge.judge.ui.components.TintedIcon
import com.okjudge.judge.ui.components.rememberIcon
import com.okjudge.judge.ui.components.uppercaseForUi
import com.okjudge.judge.ui.components.warmShadow
import com.okjudge.judge.ui.premium.EvidencePicker
import com.okjudge.judge.ui.premium.rememberEvidencePicker
import com.okjudge.judge.ui.theme.JudgeShapes
import com.okjudge.judge.ui.theme.JudgeType
import com.okjudge.judge.ui.theme.LocalSides
import com.okjudge.judge.ui.theme.Palette
import com.okjudge.judge.ui.theme.SideColors
import com.okjudge.judge.ui.theme.forScript
import java.text.NumberFormat
import kotlinx.coroutines.delay

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
    const val REMOVE_THEIRS = "home.removeTheirs"
    const val CLEAR = "home.clear"
    const val BALANCE = "home.balance"
}

/**
 * Home: one box to write in, with the other side as an extra card or a
 * link for them to write it, then the send button with what is left to spend.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun HomeScreen(
    state: HomeUiState,
    onArgumentChange: (String) -> Unit,
    onSubmit: () -> Unit,
    onDismissError: () -> Unit,
    modifier: Modifier = Modifier,
    onOtherSideChange: (String) -> Unit = {},
    onOtherName: (String) -> Unit = {},
    onSendLink: () -> Unit = {},
    onExample: () -> Unit = {},
    onAddTheirSide: () -> Unit = {},
    onRemoveTheirSide: () -> Unit = {},
    onClear: () -> Unit = {},
    onAddEvidence: (List<ImageSource>) -> Unit = {},
    onRemoveEvidence: (String) -> Unit = {},
    onDisplayName: (String) -> Unit = {},
) {
    val s = LocalStrings.current
    val lang = LocalLang.current

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

    val theirFocus = remember { FocusRequester() }
    var focusTheirs by remember { mutableStateOf(false) }
    LaunchedEffect(focusTheirs, state.theirsOpen) {
        // The card has to be on screen before it can take the focus.
        if (focusTheirs && state.theirsOpen) {
            theirFocus.requestFocus()
            focusTheirs = false
        }
    }

    Column(modifier.fillMaxSize().background(Palette.ivory)) {
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .imePadding()
                .padding(top = 8.dp, bottom = 40.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(24.dp),
        ) {
            Column(
                Modifier.widthIn(max = 640.dp).fillMaxWidth().padding(horizontal = 16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                SideCard(
                    colors = LocalSides.current.mine,
                    letter = "A",
                    label = s.appHomeYourSide,
                    showHeader = state.theirsOpen,
                    name = state.shownName,
                    namePlaceholder = s.appHomeYourName,
                    onName = onDisplayName,
                    nameTag = HomeTags.NAME,
                    text = state.argument,
                    onText = onArgumentChange,
                    placeholder = s.appHomeYourPlaceholder,
                    fieldLabel = s.appHomeYourSideLabel,
                    minHeight = if (state.theirsOpen) 96.dp else 180.dp,
                    tag = HomeTags.INPUT,
                    enabled = !state.holding,
                )
                if (state.theirsOpen) {
                    SideCard(
                        colors = LocalSides.current.theirs,
                        letter = "B",
                        label = s.appHomeTheirSide,
                        showHeader = true,
                        name = state.otherName,
                        namePlaceholder = s.appHomeTheirName,
                        onName = onOtherName,
                        nameTag = HomeTags.OTHER_NAME,
                        text = state.otherSide,
                        onText = onOtherSideChange,
                        placeholder = s.appHomeTheirPlaceholder,
                        fieldLabel = s.appHomeTheirSideLabel,
                        minHeight = 96.dp,
                        tag = HomeTags.OTHER,
                        enabled = !state.holding,
                        fieldModifier = Modifier.focusRequester(theirFocus),
                        onRemove = onRemoveTheirSide,
                    )
                } else {
                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        GhostButton(
                            s.appHomeAddTheirSide,
                            rememberIcon(Palette.ink) { JudgeIcons.plus(it) },
                            onClick = {
                                focusTheirs = true
                                onAddTheirSide()
                            },
                            modifier = Modifier.testTag(HomeTags.ADD_THEIRS),
                            enabled = !state.holding,
                        )
                        if (state.casesOn) {
                            SendLink(enabled = state.canSendLink && !blocked, onClick = onSendLink)
                        }
                    }
                }
                // The server takes one set of screenshots for the verdict, so they belong to the case.
                if (state.evidenceOn) {
                    val pick = rememberEvidencePicker(state.evidence.room, onAddEvidence)
                    Column(
                        Modifier
                            .fillMaxWidth()
                            .warmShadow(6.dp, JudgeShapes.block)
                            .clip(JudgeShapes.block)
                            .background(Palette.paper)
                            .border(1.dp, Palette.line, JudgeShapes.block)
                            .padding(horizontal = 16.dp, vertical = 14.dp),
                    ) {
                        EvidencePicker(
                            state = state.evidence,
                            disabled = state.holding,
                            onAdd = pick,
                            onRemove = onRemoveEvidence,
                        )
                    }
                }
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    FlowRow(
                        Modifier.weight(1f),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
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
                    Counter(length, lang)
                }
                state.error?.let { ErrorBanner(it, onDismissError) }
                SubmitButton(
                    text = s.getVerdict,
                    enabled = state.canSubmit && length <= ArgumentRules.MAX && !blocked,
                    onClick = onSubmit,
                )
                if (state.signedIn) {
                    Tiers.balance(s, state.entitlement)?.let {
                        Text(
                            it,
                            style = JudgeType.slotText,
                            textAlign = TextAlign.Center,
                            modifier = Modifier.fillMaxWidth().testTag(HomeTags.BALANCE),
                        )
                    }
                }
                if (state.checking || state.creating) {
                    Row(
                        Modifier.fillMaxWidth().semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Polite }.testTag(HomeTags.STATUS),
                        horizontalArrangement = Arrangement.Center,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        CircularProgressIndicator(Modifier.padding(end = 8.dp).size(14.dp), color = Palette.ink2, strokeWidth = 1.5.dp)
                        Text(if (state.creating) s.caseCreating else s.tierChecking, style = JudgeType.slotText)
                    }
                }
            }
        }
    }
}

/** One side: over what it says, the letter, a name field and the label (only once there are two sides). */
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
    minHeight: Dp,
    tag: String,
    enabled: Boolean,
    fieldModifier: Modifier = Modifier,
    onRemove: (() -> Unit)? = null,
) {
    val s = LocalStrings.current
    var focused by remember { mutableStateOf(false) }
    Column(
        Modifier
            .fillMaxWidth()
            .warmShadow(6.dp, JudgeShapes.block)
            .clip(JudgeShapes.block)
            .background(Palette.paper)
            .border(1.dp, if (focused) colors.ink.copy(alpha = 0.6f) else Palette.line, JudgeShapes.block)
            .onFocusChanged { focused = it.hasFocus }
            .padding(horizontal = 16.dp, vertical = 14.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        if (showHeader) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Box(
                Modifier.size(24.dp).clip(CircleShape).background(colors.ink).clearAndSetSemantics { },
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
            Text(
                label.uppercaseForUi(),
                style = JudgeType.micro.copy(fontWeight = FontWeight.SemiBold, letterSpacing = 0.08.em, color = colors.ink).forScript(),
                maxLines = 1,
            )
            if (onRemove != null) {
                Box(
                    Modifier
                        .size(32.dp)
                        .clip(CircleShape)
                        .semantics {
                            role = Role.Button
                            contentDescription = s.appHomeRemoveTheirSide
                        }
                        .clickable(enabled = enabled, onClick = onRemove)
                        .testTag(HomeTags.REMOVE_THEIRS),
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
            modifier = fieldModifier.fillMaxWidth().heightIn(min = minHeight).semantics { contentDescription = fieldLabel }.testTag(tag),
            decorationBox = { inner ->
                Box {
                    if (text.isEmpty()) Text(placeholder, style = SideText.copy(color = Palette.placeholder))
                    inner()
                }
            },
        )
    }
}

private val SideText: TextStyle
    @Composable
    @ReadOnlyComposable
    get() = JudgeType.body.copy(fontSize = 15.sp, lineHeight = (15 * 1.5).sp)

@Composable
private fun SendLink(enabled: Boolean, onClick: () -> Unit) {
    val s = LocalStrings.current
    Row(
        Modifier
            .defaultMinSize(minHeight = 44.dp)
            .clip(JudgeShapes.chip)
            .alpha(if (enabled) 1f else 0.5f)
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
            .testTag(HomeTags.SEND_LINK)
            .padding(end = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        TintedIcon(rememberIcon(Palette.sageInk) { JudgeIcons.link(it) }, 14)
        Text(s.appHomeSendLink, style = JudgeType.small.copy(color = Palette.sageInk))
    }
}

/** A small text button under the form (an example, clear). */
@Composable
private fun QuietAction(text: String, onClick: () -> Unit, enabled: Boolean, modifier: Modifier = Modifier, icon: ImageVector? = null) {
    Row(
        modifier
            .defaultMinSize(minHeight = 40.dp)
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
private fun SubmitButton(text: String, enabled: Boolean, onClick: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(top = 4.dp)
            .height(54.dp)
            .clip(JudgeShapes.field)
            .background(if (enabled) Palette.ink else Palette.ink.copy(alpha = 0.35f))
            .semantics(mergeDescendants = true) { role = Role.Button }
            .clickable(enabled = enabled, onClick = onClick)
            .testTag(HomeTags.SUBMIT)
            .padding(horizontal = 20.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(text, style = JudgeType.button.copy(color = Palette.paper), maxLines = 1, overflow = TextOverflow.Ellipsis)
        TintedIcon(rememberIcon(Palette.paper) { JudgeIcons.arrow(it) }, 18)
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
