package com.okjudge.judge.ui.home

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
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
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.currentStateAsState
import com.okjudge.judge.core.cases.CaseLogic
import com.okjudge.judge.core.data.SavedVerdict
import com.okjudge.judge.core.display.ArgumentRules
import com.okjudge.judge.core.display.Errors
import com.okjudge.judge.core.display.Example
import com.okjudge.judge.core.display.Preset
import com.okjudge.judge.core.display.RestoreNames
import com.okjudge.judge.core.display.UiError
import com.okjudge.judge.core.evidence.ImageSource
import com.okjudge.judge.core.premium.Tier
import com.okjudge.judge.i18n.AppLang
import com.okjudge.judge.i18n.LocalLang
import com.okjudge.judge.i18n.LocalStrings
import com.okjudge.judge.ui.components.CardElevation
import com.okjudge.judge.ui.components.Chip
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
import com.okjudge.judge.ui.theme.cappedScale
import kotlinx.coroutines.delay
import java.text.NumberFormat
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter

object HomeTags {
    const val INPUT = "home.input"
    const val SUBMIT = "home.submit"
    const val COUNTER = "home.counter"
    const val ERROR = "home.error"
    const val STATUS = "home.status"
    const val NAME = "home.name"
    const val LENS = "home.lens"
    const val SIDES = "home.sides"
    const val RECENT = "home.recent"
    fun recent(id: String) = "home.recent.$id"
}

/** Cards in the "Recent" row (Recent.tsx MAX). */
private const val RECENT_MAX = 8

/**
 * Home as the web's empty thread: one case-file card (heading, steps, the
 * argument, examples, the lens and tier, the send button), then the newest
 * saved verdicts and the privacy note, on the darker ivory page.
 */
@Composable
fun HomeScreen(
    state: HomeUiState,
    onArgumentChange: (String) -> Unit,
    onExample: (String) -> Unit,
    onPreset: (Preset) -> Unit,
    onSubmit: () -> Unit,
    onDismissError: () -> Unit,
    onNew: (() -> Unit)?,
    onOpenPrivacy: () -> Unit,
    modifier: Modifier = Modifier,
    onTier: (Tier) -> Unit = {},
    onPremiumIntent: () -> Unit = {},
    onSignIn: () -> Unit = {},
    onPricing: () -> Unit = {},
    onAddEvidence: (List<ImageSource>) -> Unit = {},
    onRemoveEvidence: (String) -> Unit = {},
    onCaseMode: (CaseMode) -> Unit = {},
    onDisplayName: (String) -> Unit = {},
    onOpenVerdict: (String) -> Unit = {},
    onAllVerdicts: () -> Unit = {},
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

    Column(modifier.fillMaxSize().background(Palette.ivory2)) {
        TopBar(onBack = null, onNew = onNew?.takeUnless { state.blank })
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
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                state.error?.let { ErrorBanner(it, onDismissError) }
                CaseCard(
                    state = state,
                    blocked = blocked,
                    onArgumentChange = onArgumentChange,
                    onExample = onExample,
                    onPreset = onPreset,
                    onSubmit = onSubmit,
                    onTier = onTier,
                    onPremiumIntent = onPremiumIntent,
                    onSignIn = onSignIn,
                    onPricing = onPricing,
                    onAddEvidence = onAddEvidence,
                    onRemoveEvidence = onRemoveEvidence,
                    onCaseMode = onCaseMode,
                    onDisplayName = onDisplayName,
                )
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

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun CaseCard(
    state: HomeUiState,
    blocked: Boolean,
    onArgumentChange: (String) -> Unit,
    onExample: (String) -> Unit,
    onPreset: (Preset) -> Unit,
    onSubmit: () -> Unit,
    onTier: (Tier) -> Unit,
    onPremiumIntent: () -> Unit,
    onSignIn: () -> Unit,
    onPricing: () -> Unit,
    onAddEvidence: (List<ImageSource>) -> Unit,
    onRemoveEvidence: (String) -> Unit,
    onCaseMode: (CaseMode) -> Unit,
    onDisplayName: (String) -> Unit,
) {
    val s = LocalStrings.current
    val lang = LocalLang.current
    var lensOpen by rememberSaveable { mutableStateOf(false) }
    Column(
        Modifier
            .fillMaxWidth()
            .warmShadow(CardElevation, JudgeShapes.card)
            .clip(JudgeShapes.card)
            .background(Palette.paper)
            .border(1.dp, Palette.line, JudgeShapes.card)
            .padding(horizontal = 20.dp, vertical = 22.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        CaseHead()
        Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
            ArgumentField(
                value = state.argument,
                onChange = onArgumentChange,
                placeholder = if (state.twoSided) s.threadPlaceholderTwoSided else s.threadPlaceholder,
            )
            if (!state.twoSided) Examples(state.argument, onExample)
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    LensChip(state.preset, lensOpen, enabled = !state.holding, compact = state.twoSided, modifier = Modifier.weight(1f, fill = false)) { lensOpen = !lensOpen }
                    if (state.twoSided) {
                        Text(
                            s.caseKicker,
                            style = JudgeType.small.copy(color = Palette.sageInk, fontSize = 12.sp),
                            maxLines = 1,
                            modifier = Modifier.clip(JudgeShapes.chip).background(Palette.sageTint).padding(horizontal = 10.dp, vertical = 4.dp),
                        )
                    }
                }
                Counter(state.argument.length, lang)
            }
            if (lensOpen) {
                Column {
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Preset.entries.forEach { p ->
                            Chip(
                                text = s.text(p.labelKey) ?: p.id,
                                selected = p == state.preset,
                                onClick = { onPreset(p) },
                                leading = p.emoji,
                            )
                        }
                    }
                    s.text(state.preset.blurbKey)?.let {
                        Text(it, style = JudgeType.slotText, modifier = Modifier.padding(top = 8.dp))
                    }
                }
            }
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
            if (state.evidenceOn) {
                val pick = rememberEvidencePicker(state.evidence.room, onAddEvidence)
                EvidencePicker(
                    state = state.evidence,
                    disabled = state.holding,
                    onAdd = pick,
                    onRemove = onRemoveEvidence,
                )
            }
            if (state.twoSided) {
                Column {
                    Text(s.caseDisplayName, style = JudgeType.slotTitle, modifier = Modifier.padding(bottom = 8.dp))
                    NameField(state.shownName, onDisplayName, enabled = !state.holding)
                }
            }
            SubmitButton(
                text = if (state.twoSided) s.caseCreate else s.getVerdict,
                enabled = state.canSubmit && !blocked,
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
            if (state.casesOn) {
                Text(
                    if (state.twoSided) s.homeOneSide else s.homeInvite,
                    style = JudgeType.small.copy(color = Palette.terraInk),
                    textAlign = TextAlign.Center,
                    modifier = Modifier
                        .align(Alignment.CenterHorizontally)
                        .defaultMinSize(minHeight = 44.dp)
                        .clip(JudgeShapes.chip)
                        .clickable(enabled = !state.holding, role = Role.Button) {
                            onCaseMode(if (state.twoSided) CaseMode.NOW else CaseMode.BOTH)
                        }
                        .testTag(HomeTags.SIDES)
                        .padding(horizontal = 8.dp, vertical = 12.dp),
                )
            }
        }
    }
}

/** "New case" and today's date, the heading and the three steps (CaseHead). */
@Composable
private fun CaseHead() {
    val s = LocalStrings.current
    val lang = LocalLang.current
    val today = dayMonth(rememberToday(), lang)
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Kicker(s.homeKicker, Modifier.weight(1f))
            Text(today, style = JudgeType.serifLabel.copy(fontSize = 15.sp, color = Palette.placeholder))
        }
        Text(s.homeTitle, style = JudgeType.caseTitle.cappedScale(), modifier = Modifier.semantics { heading() })
        Row(Modifier.padding(top = 2.dp), verticalAlignment = Alignment.CenterVertically) {
            val steps = listOf(s.homeStepArgument, s.threadLens, s.homeStepRuling)
            steps.forEachIndexed { i, label ->
                Step(i + 1, label, current = i == 0)
                if (i < steps.lastIndex) {
                    Box(Modifier.weight(1f).padding(horizontal = 6.dp).height(1.dp).background(Palette.line2))
                }
            }
        }
    }
}

@Composable
private fun Step(n: Int, label: String, current: Boolean) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Box(
            Modifier
                .size(20.dp)
                .clip(CircleShape)
                .background(if (current) Palette.ink else Palette.paper)
                .border(1.dp, if (current) Palette.ink else Palette.line2, CircleShape)
                .clearAndSetSemantics { },
            contentAlignment = Alignment.Center,
        ) {
            Text(n.toString(), style = JudgeType.small.copy(fontSize = 11.sp, lineHeight = 11.sp, color = if (current) Palette.paper else Palette.muted))
        }
        Text(
            label,
            style = JudgeType.small.copy(fontSize = 12.sp, color = if (current) Palette.ink else Palette.muted),
            maxLines = 1,
            softWrap = false,
        )
    }
}

@Composable
private fun ArgumentField(value: String, onChange: (String) -> Unit, placeholder: String) {
    Box(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 150.dp)
            .clip(JudgeShapes.field)
            .background(Palette.ivory)
            .border(1.dp, Palette.line2, JudgeShapes.field)
            .padding(horizontal = 16.dp, vertical = 14.dp),
    ) {
        BasicTextField(
            value = value,
            onValueChange = { onChange(it.take(ArgumentRules.MAX)) },
            textStyle = JudgeType.body,
            cursorBrush = SolidColor(Palette.terraInk),
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
            modifier = Modifier.fillMaxWidth().heightIn(min = 122.dp).testTag(HomeTags.INPUT),
            decorationBox = { inner ->
                if (value.isEmpty()) Text(placeholder, style = JudgeType.body.copy(color = Palette.placeholder))
                inner()
            },
        )
    }
}

/** One row of small example chips under the field, scrolling sideways. */
@Composable
private fun Examples(value: String, onExample: (String) -> Unit) {
    val s = LocalStrings.current
    Row(
        Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Example.entries.forEach { ex ->
            val label = s.text(ex.labelKey) ?: return@forEach
            val text = s.text(ex.textKey) ?: return@forEach
            val on = value == text
            Text(
                label,
                style = JudgeType.small.copy(fontSize = 12.5.sp, fontWeight = FontWeight.Medium, color = if (on) Palette.ink else Palette.ink2),
                maxLines = 1,
                modifier = Modifier
                    .defaultMinSize(minHeight = 32.dp)
                    .clip(JudgeShapes.chip)
                    .background(Palette.paper)
                    .border(1.dp, if (on) Palette.ink else Palette.line2, JudgeShapes.chip)
                    .clickable(role = Role.Button) { onExample(text) }
                    .padding(horizontal = 12.dp, vertical = 7.dp),
            )
        }
    }
}

/** "The lens · Fairness": opens the presets under the toolbar. */
@Composable
private fun LensChip(preset: Preset, open: Boolean, enabled: Boolean, compact: Boolean, modifier: Modifier = Modifier, onClick: () -> Unit) {
    val s = LocalStrings.current
    val name = s.text(preset.labelKey) ?: preset.id
    Row(
        modifier
            .defaultMinSize(minHeight = 40.dp)
            .clip(JudgeShapes.chip)
            .background(if (open) Palette.ivory2 else Palette.paper)
            .border(1.dp, Palette.line2, JudgeShapes.chip)
            .semantics { role = Role.Button }
            .clickable(enabled = enabled, onClick = onClick)
            .testTag(HomeTags.LENS)
            .padding(horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(preset.emoji, style = JudgeType.small, modifier = Modifier.clearAndSetSemantics { })
        // Beside the "Both sides" badge the row is too narrow for the word as well.
        if (!compact) Text(s.threadLens, style = JudgeType.small.copy(color = if (open) Palette.ink else Palette.ink2), maxLines = 1)
        Text(
            if (compact) name else "· $name",
            style = JudgeType.small.copy(fontWeight = FontWeight.Medium, color = if (open) Palette.ink2 else Palette.muted),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f, fill = false),
        )
        TintedIcon(remember { JudgeIcons.caret(Palette.ink2) }, 12, Modifier.rotate(if (open) 180f else 0f))
    }
}

@Composable
private fun Counter(count: Int, lang: AppLang) {
    val s = LocalStrings.current
    val nf = remember(lang) { NumberFormat.getIntegerInstance(lang.locale) }
    val warn = count > ArgumentRules.WARN_AT
    Text(
        s.appInputCounter(nf.format(count), nf.format(ArgumentRules.MAX)),
        style = JudgeType.footnote.copy(fontSize = 12.sp, color = if (warn) Palette.terraInk else Palette.muted),
        maxLines = 1,
        modifier = Modifier.testTag(HomeTags.COUNTER),
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
        horizontalArrangement = Arrangement.spacedBy(10.dp, Alignment.CenterHorizontally),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(text, style = JudgeType.button.copy(color = Palette.paper), maxLines = 1, overflow = TextOverflow.Ellipsis)
        TintedIcon(remember { JudgeIcons.arrow(Palette.paper) }, 18)
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

@Composable
private fun NameField(value: String, onChange: (String) -> Unit, enabled: Boolean) {
    Box(
        Modifier
            .fillMaxWidth()
            .clip(JudgeShapes.field)
            .background(Palette.ivory)
            .border(1.dp, Palette.line2, JudgeShapes.field)
            .padding(horizontal = 16.dp, vertical = 14.dp),
    ) {
        BasicTextField(
            value = value,
            onValueChange = { onChange(it.take(CaseLogic.MAX_DISPLAY_NAME)) },
            enabled = enabled,
            singleLine = true,
            textStyle = JudgeType.body,
            cursorBrush = SolidColor(Palette.terraInk),
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Words),
            modifier = Modifier.fillMaxWidth().testTag(HomeTags.NAME),
        )
    }
}
