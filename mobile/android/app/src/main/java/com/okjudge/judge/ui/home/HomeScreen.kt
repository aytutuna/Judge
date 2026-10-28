package com.okjudge.judge.ui.home

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.currentStateAsState
import com.okjudge.judge.core.cases.CaseLogic
import com.okjudge.judge.core.data.SavedVerdict
import com.okjudge.judge.core.display.ArgumentRules
import com.okjudge.judge.core.display.Errors
import com.okjudge.judge.core.display.Preset
import com.okjudge.judge.core.display.RestoreNames
import com.okjudge.judge.core.display.UiError
import com.okjudge.judge.core.evidence.ImageSource
import com.okjudge.judge.core.premium.Tier
import com.okjudge.judge.i18n.AppLang
import com.okjudge.judge.i18n.LocalLang
import com.okjudge.judge.i18n.LocalStrings
import com.okjudge.judge.ui.components.GhostButton
import com.okjudge.judge.ui.components.JudgeIcons
import com.okjudge.judge.ui.components.Kicker
import com.okjudge.judge.ui.components.TintedIcon
import com.okjudge.judge.ui.components.TopBar
import com.okjudge.judge.ui.components.uppercaseForUi
import com.okjudge.judge.ui.components.warmShadow
import com.okjudge.judge.ui.premium.EvidencePicker
import com.okjudge.judge.ui.premium.TierSwitch
import com.okjudge.judge.ui.premium.rememberEvidencePicker
import com.okjudge.judge.ui.theme.JudgeShapes
import com.okjudge.judge.ui.theme.JudgeType
import com.okjudge.judge.ui.theme.Palette
import kotlinx.coroutines.delay
import java.text.NumberFormat
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter

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
    const val RECENT = "home.recent"
    fun preset(id: String) = "home.preset.$id"
    fun recent(id: String) = "home.recent.$id"
}

/** Cards in the "Recent" row (Recent.tsx MAX). */
private const val RECENT_MAX = 8

/** Your side and theirs, each on its own card, in these colours. */
private data class SideColors(val avatar: Color, val ink: Color)

private val Mine = SideColors(Palette.terra, Palette.terraInk)
private val Theirs = SideColors(Palette.sageInk, Palette.sageInk)

/**
 * Home: a card for your side and one for theirs (or a link for them to
 * write it), the lens, the tier and the send button, then the newest saved
 * verdicts and the privacy note.
 */
@Composable
fun HomeScreen(
    state: HomeUiState,
    onArgumentChange: (String) -> Unit,
    onPreset: (Preset) -> Unit,
    onSubmit: () -> Unit,
    onDismissError: () -> Unit,
    onNew: (() -> Unit)?,
    onOpenPrivacy: () -> Unit,
    modifier: Modifier = Modifier,
    onOtherSideChange: (String) -> Unit = {},
    onOtherName: (String) -> Unit = {},
    onSendLink: () -> Unit = {},
    onExample: () -> Unit = {},
    onTier: (Tier) -> Unit = {},
    onPremiumIntent: () -> Unit = {},
    onSignIn: () -> Unit = {},
    onPricing: () -> Unit = {},
    onAddEvidence: (List<ImageSource>) -> Unit = {},
    onRemoveEvidence: (String) -> Unit = {},
    onDisplayName: (String) -> Unit = {},
    onOpenVerdict: (String) -> Unit = {},
    onAllVerdicts: () -> Unit = {},
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

    Column(modifier.fillMaxSize().background(Palette.ivory)) {
        TopBar(onBack = null, onNew = onNew?.takeUnless { state.blank || state.holding })
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .imePadding()
                .padding(top = 4.dp, bottom = 40.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(24.dp),
        ) {
            Column(
                Modifier.widthIn(max = 640.dp).fillMaxWidth().padding(horizontal = 20.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    GhostButton(
                        s.appHomeExample,
                        remember { JudgeIcons.spark(Palette.terra) },
                        onClick = onExample,
                        modifier = Modifier.testTag(HomeTags.EXAMPLE),
                    )
                    if (state.blank) {
                        Text(if (state.casesOn) s.appHomeLead else s.appHomeLeadSolo, style = JudgeType.body.copy(fontSize = 14.sp, color = Palette.ink2))
                    }
                }
                state.error?.let { ErrorBanner(it, onDismissError) }
                SideCard(
                    colors = Mine,
                    letter = "A",
                    label = s.appHomeYourSide,
                    name = state.shownName,
                    namePlaceholder = s.appHomeYourName,
                    onName = onDisplayName,
                    nameTag = HomeTags.NAME,
                    text = state.argument,
                    onText = onArgumentChange,
                    placeholder = s.appHomeYourPlaceholder,
                    fieldLabel = s.appHomeYourSideLabel,
                    minLines = if (state.blank) 4 else 3,
                    tag = HomeTags.INPUT,
                    enabled = !state.holding,
                ) {
                    if (state.evidenceOn) {
                        val pick = rememberEvidencePicker(state.evidence.room, onAddEvidence)
                        EvidencePicker(
                            state = state.evidence,
                            disabled = state.holding,
                            onAdd = pick,
                            onRemove = onRemoveEvidence,
                        )
                    }
                }
                SideCard(
                    colors = Theirs,
                    letter = "B",
                    label = s.appHomeTheirSide,
                    name = state.otherName,
                    namePlaceholder = s.appHomeTheirName,
                    onName = onOtherName,
                    nameTag = HomeTags.OTHER_NAME,
                    text = state.otherSide,
                    onText = onOtherSideChange,
                    placeholder = s.appHomeTheirPlaceholder,
                    fieldLabel = s.appHomeTheirSideLabel,
                    minLines = if (state.otherSide.isEmpty()) 2 else 3,
                    tag = HomeTags.OTHER,
                    enabled = !state.holding,
                ) {
                    // Once their side is written here there is nothing left for them to write.
                    if (state.casesOn && state.otherSide.isBlank()) {
                        SendLink(enabled = state.canSendLink && !blocked, onClick = onSendLink)
                    }
                }
                Presets(state.preset, enabled = !state.holding, onPreset = onPreset)
                TierSwitch(
                    availability = state.availability,
                    value = state.tier,
                    entitlement = state.entitlement,
                    disabled = state.holding,
                    onChange = onTier,
                    onPremiumIntent = onPremiumIntent,
                    onSignIn = onSignIn,
                    onPricing = onPricing,
                )
                if (!state.blank) Counter(length, lang, Modifier.align(Alignment.End))
                SubmitButton(
                    text = s.getVerdict,
                    enabled = state.canSubmit && length <= ArgumentRules.MAX && !blocked,
                    onClick = onSubmit,
                )
                if (state.checking || state.creating) {
                    Row(
                        Modifier.fillMaxWidth().semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Polite }.testTag(HomeTags.STATUS),
                        horizontalArrangement = Arrangement.Center,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        CircularProgressIndicator(Modifier.padding(end = 8.dp).size(14.dp), color = Palette.ink2, strokeWidth = 1.5.dp)
                        Text(if (state.creating) s.caseCreating else s.tierChecking, style = JudgeType.slotText.copy(color = Palette.ink2))
                    }
                }
            }
            if (state.recent.isNotEmpty()) {
                Recent(state.recent.take(RECENT_MAX), onOpenVerdict, onAllVerdicts, Modifier.widthIn(max = 640.dp).fillMaxWidth())
            }
            Column(
                Modifier.widthIn(max = 520.dp).padding(horizontal = 24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(s.privacyNote, style = JudgeType.footnote.copy(color = Palette.placeholder), textAlign = TextAlign.Center)
                Text(
                    s.privacyLink,
                    style = JudgeType.footnote.copy(color = Palette.terraInk, textDecoration = TextDecoration.Underline),
                    textAlign = TextAlign.Center,
                    modifier = Modifier
                        .clip(JudgeShapes.chip)
                        .clickable(onClick = onOpenPrivacy)
                        .padding(8.dp),
                )
            }
        }
    }
}

/** One side: the letter, a name field and the side's label over what that side says. */
@Composable
private fun SideCard(
    colors: SideColors,
    letter: String,
    label: String,
    name: String,
    namePlaceholder: String,
    onName: (String) -> Unit,
    nameTag: String,
    text: String,
    onText: (String) -> Unit,
    placeholder: String,
    fieldLabel: String,
    minLines: Int,
    tag: String,
    enabled: Boolean,
    extra: @Composable () -> Unit,
) {
    Column(
        Modifier
            .fillMaxWidth()
            .warmShadow(6.dp, JudgeShapes.block)
            .clip(JudgeShapes.block)
            .background(Palette.paper)
            .padding(horizontal = 16.dp, vertical = 14.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Box(
                Modifier.size(24.dp).clip(CircleShape).background(colors.avatar).clearAndSetSemantics { },
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
                style = JudgeType.micro.copy(fontWeight = FontWeight.SemiBold, letterSpacing = 0.08.em, color = colors.ink),
                maxLines = 1,
            )
        }
        BasicTextField(
            value = text,
            onValueChange = { onText(it.take(ArgumentRules.MAX)) },
            enabled = enabled,
            minLines = minLines,
            textStyle = SideText,
            cursorBrush = SolidColor(Palette.terraInk),
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
            modifier = Modifier.fillMaxWidth().semantics { contentDescription = fieldLabel }.testTag(tag),
            decorationBox = { inner ->
                Box {
                    if (text.isEmpty()) Text(placeholder, style = SideText.copy(color = Palette.placeholder))
                    inner()
                }
            },
        )
        extra()
    }
}

private val SideText = JudgeType.body.copy(fontSize = 15.sp, lineHeight = (15 * 1.5).sp)

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
        TintedIcon(remember { JudgeIcons.link(Palette.sageInk) }, 14)
        Text(s.appHomeSendLink, style = JudgeType.small.copy(color = Palette.sageInk))
    }
}

/** The lens presets as one row of pills, scrolling sideways when they don't fit. */
@Composable
private fun Presets(selected: Preset, enabled: Boolean, onPreset: (Preset) -> Unit) {
    val s = LocalStrings.current
    Row(
        Modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState())
            .selectableGroup()
            .semantics { contentDescription = s.judgeBy },
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Preset.entries.forEach { p ->
            val on = p == selected
            Text(
                s.text(p.labelKey) ?: p.id,
                style = JudgeType.small.copy(color = if (on) Palette.paper else Palette.ink2),
                maxLines = 1,
                modifier = Modifier
                    .defaultMinSize(minHeight = 38.dp)
                    .clip(JudgeShapes.chip)
                    .background(if (on) Palette.ink else Color.Transparent)
                    .then(if (on) Modifier else Modifier.border(1.dp, Palette.line2, JudgeShapes.chip))
                    .selectable(selected = on, enabled = enabled, role = Role.RadioButton) { onPreset(p) }
                    .testTag(HomeTags.preset(p.id))
                    .padding(horizontal = 16.dp, vertical = 10.dp),
            )
        }
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
        style = JudgeType.footnote.copy(fontSize = 12.sp, color = if (warn) Palette.terraInk else Palette.muted),
        maxLines = 1,
        modifier = modifier.testTag(HomeTags.COUNTER),
    )
}

@Composable
private fun SubmitButton(text: String, enabled: Boolean, onClick: () -> Unit) {
    val fg = if (enabled) Palette.paper else Palette.ink2
    Row(
        Modifier
            .fillMaxWidth()
            .padding(top = 4.dp)
            .height(54.dp)
            .clip(JudgeShapes.field)
            .background(if (enabled) Palette.ink else Palette.stone)
            .semantics(mergeDescendants = true) { role = Role.Button }
            .clickable(enabled = enabled, onClick = onClick)
            .testTag(HomeTags.SUBMIT)
            .padding(horizontal = 20.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(text, style = JudgeType.button.copy(color = fg), maxLines = 1, overflow = TextOverflow.Ellipsis)
        TintedIcon(remember(fg) { JudgeIcons.arrow(fg) }, 18)
    }
}

/** "Recent": the newest saved verdicts in a row of small cards (Recent.tsx). */
@Composable
private fun Recent(items: List<SavedVerdict>, onOpen: (String) -> Unit, onAll: () -> Unit, modifier: Modifier = Modifier) {
    val s = LocalStrings.current
    val lang = LocalLang.current
    val today = rememberToday()
    Column(modifier.testTag(HomeTags.RECENT)) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp), verticalAlignment = Alignment.CenterVertically) {
            Kicker(s.homeRecent, Modifier.weight(1f).semantics { heading() })
            Text(
                s.homeAll,
                style = JudgeType.small.copy(color = Palette.terraInk),
                modifier = Modifier
                    .clip(JudgeShapes.chip)
                    .clickable(role = Role.Button, onClick = onAll)
                    .padding(horizontal = 6.dp, vertical = 10.dp),
            )
        }
        Row(
            Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState())
                .height(IntrinsicSize.Min)
                .padding(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 14.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            items.forEach { item ->
                val shown = item.translations[lang]?.result ?: item.original.result
                val title = remember(shown, item.nameMap, item.lang) { RestoreNames.headline(shown, item.nameMap, item.lang) }
                val day = Instant.ofEpochMilli(item.createdAt).atZone(ZoneId.systemDefault()).toLocalDate()
                RecentCard(
                    kicker = s.homeDecided,
                    title = title,
                    date = if (day == today) s.shellToday else dayMonth(day, lang),
                    onClick = { onOpen(item.id) },
                    modifier = Modifier.testTag(HomeTags.recent(item.id)),
                )
            }
        }
    }
}

@Composable
private fun RecentCard(kicker: String, title: String, date: String, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Column(
        modifier
            .width(180.dp)
            .fillMaxHeight()
            .warmShadow(3.dp, JudgeShapes.field)
            .clip(JudgeShapes.field)
            .background(Palette.paper)
            .border(1.dp, Palette.line, JudgeShapes.field)
            .clickable(role = Role.Button, onClick = onClick)
            .padding(start = 14.dp, end = 14.dp, top = 14.dp, bottom = 12.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(kicker.uppercaseForUi(), style = JudgeType.micro.copy(fontSize = 10.sp, letterSpacing = 1.sp, color = Palette.terraInk))
        Text(
            title,
            style = JudgeType.small.copy(color = Palette.ink, lineHeight = (13 * 1.35).sp),
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
        Spacer(Modifier.weight(1f))
        Text(date, style = JudgeType.footnote.copy(fontSize = 12.sp, color = Palette.placeholder))
    }
}

/** Today, read again on each resume so Home left open overnight moves on. */
@Composable
private fun rememberToday(): LocalDate {
    val state by LocalLifecycleOwner.current.lifecycle.currentStateAsState()
    return remember(state) { LocalDate.now() }
}

/** "October 26" / "26 Ekim" (formatDate in lib/i18n.ts). */
private fun dayMonth(date: LocalDate, lang: AppLang): String =
    DateTimeFormatter.ofPattern(if (lang == AppLang.TR) "d MMMM" else "MMMM d", lang.locale).format(date)

private val ErrorShape = RoundedCornerShape(14.dp)

@Composable
private fun ErrorBanner(error: UiError, onDismiss: () -> Unit) {
    val s = LocalStrings.current
    val lang = LocalLang.current
    val text = Errors.message(error, s, lang)
    Row(
        Modifier
            .fillMaxWidth()
            .clip(ErrorShape)
            .background(Palette.terraTint)
            .semantics { liveRegion = LiveRegionMode.Polite }
            .testTag(HomeTags.ERROR)
            .padding(start = 14.dp, top = 8.dp, bottom = 8.dp, end = 4.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Text(
            text,
            style = JudgeType.body.copy(fontSize = 14.sp, lineHeight = 20.sp, fontWeight = FontWeight.Medium, color = Palette.danger),
            modifier = Modifier.weight(1f).padding(top = 4.dp),
        )
        Box(
            Modifier
                .clip(JudgeShapes.chip)
                .semantics { contentDescription = s.appCancel }
                .clickable(onClick = onDismiss)
                .padding(8.dp),
        ) { TintedIcon(remember { JudgeIcons.close(Palette.ink2) }, 16) }
    }
}
