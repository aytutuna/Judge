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
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.CircleShape
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.okjudge.judge.core.display.ArgumentRules
import com.okjudge.judge.core.display.Errors
import com.okjudge.judge.core.display.Example
import com.okjudge.judge.core.display.Preset
import com.okjudge.judge.core.display.UiError
import com.okjudge.judge.core.cases.CaseLogic
import com.okjudge.judge.core.evidence.ImageSource
import com.okjudge.judge.core.premium.Tier
import com.okjudge.judge.core.premium.TierAvailability
import com.okjudge.judge.ui.premium.EvidencePicker
import com.okjudge.judge.ui.premium.TierSwitch
import com.okjudge.judge.ui.premium.rememberEvidencePicker
import com.okjudge.judge.i18n.AppLang
import com.okjudge.judge.i18n.LocalLang
import com.okjudge.judge.i18n.LocalStrings
import com.okjudge.judge.ui.components.Chip
import com.okjudge.judge.ui.components.JudgeIcons
import com.okjudge.judge.ui.components.Kicker
import com.okjudge.judge.ui.components.PrimaryButton
import com.okjudge.judge.ui.components.TintedIcon
import com.okjudge.judge.ui.components.TopBar
import com.okjudge.judge.ui.theme.JudgeShapes
import com.okjudge.judge.ui.theme.JudgeType
import com.okjudge.judge.ui.theme.Palette
import com.okjudge.judge.ui.theme.cappedScale
import kotlinx.coroutines.delay
import java.text.NumberFormat

object HomeTags {
    const val INPUT = "home.input"
    const val SUBMIT = "home.submit"
    const val COUNTER = "home.counter"
    const val ERROR = "home.error"
    const val STATUS = "home.status"
    const val MODE_NOW = "home.modeNow"
    const val MODE_BOTH = "home.modeBoth"
    const val NAME = "home.name"
}

/** Home: headline, the argument box with its counter, examples, presets and the CTA. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun HomeScreen(
    state: HomeUiState,
    onArgumentChange: (String) -> Unit,
    onExample: (String) -> Unit,
    onPreset: (Preset) -> Unit,
    onSubmit: () -> Unit,
    onDismissError: () -> Unit,
    onToggleLang: () -> Unit,
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

    Column(modifier.fillMaxSize()) {
        TopBar(onBack = null, onToggleLang = onToggleLang)
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .imePadding()
                .padding(horizontal = 20.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Column(Modifier.widthIn(max = 640.dp).fillMaxWidth().padding(top = 12.dp, bottom = 40.dp)) {
                Kicker(s.heroEyebrow, Modifier.padding(bottom = 14.dp))
                Text(s.heroTitleLine1, style = JudgeType.display1.cappedScale())
                Text(s.heroTitleLine2, style = JudgeType.heroSerif.cappedScale())
                Text(s.heroLead, style = JudgeType.lead, modifier = Modifier.padding(top = 14.dp, bottom = 24.dp))

                Text(s.inputLabel, style = JudgeType.slotTitle, modifier = Modifier.padding(bottom = 8.dp))
                ArgumentField(state.argument, onArgumentChange, s.placeholder)
                Counter(state.argument.length, lang)

                Text(s.examplesLabel, style = JudgeType.slotTitle, modifier = Modifier.padding(top = 18.dp, bottom = 8.dp))
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Example.entries.forEach { ex ->
                        val label = s.text(ex.labelKey) ?: return@forEach
                        Chip(label, selected = false, onClick = { s.text(ex.textKey)?.let(onExample) })
                    }
                }

                Text(s.judgeBy, style = JudgeType.slotTitle, modifier = Modifier.padding(top = 22.dp, bottom = 8.dp))
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

                if (state.casesOn) {
                    CaseModeSwitch(state.caseMode, disabled = state.holding, onChange = onCaseMode, modifier = Modifier.padding(top = 22.dp))
                }

                if (state.evidenceOn) {
                    val pick = rememberEvidencePicker(state.evidence.room, onAddEvidence)
                    EvidencePicker(
                        state = state.evidence,
                        disabled = state.holding,
                        onAdd = pick,
                        onRemove = onRemoveEvidence,
                        modifier = Modifier.padding(top = 22.dp),
                    )
                }

                state.error?.let { ErrorBanner(it, onDismissError) }

                TierSwitch(
                    availability = state.availability,
                    value = state.tier,
                    entitlement = state.entitlement,
                    disabled = state.holding,
                    onChange = onTier,
                    onPremiumIntent = onPremiumIntent,
                    onSignIn = onSignIn,
                    onPricing = onPricing,
                    modifier = Modifier.padding(top = 22.dp),
                )

                if (state.twoSided) {
                    Text(s.caseDisplayName, style = JudgeType.slotTitle, modifier = Modifier.padding(top = 18.dp, bottom = 8.dp))
                    NameField(state.shownName, onDisplayName, enabled = !state.holding)
                }

                PrimaryButton(
                    text = if (state.twoSided) s.caseCreate else s.getVerdict,
                    enabled = state.canSubmit && !blocked,
                    onClick = onSubmit,
                    modifier = Modifier.fillMaxWidth().padding(top = if (state.availability == TierAvailability.HIDDEN) 24.dp else 14.dp).testTag(HomeTags.SUBMIT),
                )
                if (state.checking || state.creating) {
                    Row(
                        Modifier.fillMaxWidth().padding(top = 12.dp).semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Polite }.testTag(HomeTags.STATUS),
                        horizontalArrangement = Arrangement.Center,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        CircularProgressIndicator(Modifier.padding(end = 8.dp).size(14.dp), color = Palette.ink2, strokeWidth = 1.5.dp)
                        Text(if (state.creating) s.caseCreating else s.tierChecking, style = JudgeType.slotText.copy(color = Palette.ink2))
                    }
                }
                Text(s.privacyNote, style = JudgeType.footnote, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(top = 12.dp))
                Text(
                    s.privacyLink,
                    style = JudgeType.footnote.copy(color = Palette.terraInk, textDecoration = TextDecoration.Underline),
                    textAlign = TextAlign.Center,
                    modifier = Modifier
                        .align(Alignment.CenterHorizontally)
                        .clip(JudgeShapes.chip)
                        .clickable(onClick = onOpenPrivacy)
                        .padding(8.dp),
                )
            }
        }
    }
}

@Composable
private fun ArgumentField(value: String, onChange: (String) -> Unit, placeholder: String) {
    Box(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 180.dp)
            .clip(JudgeShapes.field)
            .background(Palette.paper)
            .border(1.dp, Palette.line2, JudgeShapes.field)
            .padding(16.dp),
    ) {
        BasicTextField(
            value = value,
            onValueChange = { onChange(it.take(ArgumentRules.MAX)) },
            textStyle = JudgeType.body,
            cursorBrush = SolidColor(Palette.terraInk),
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
            modifier = Modifier.fillMaxWidth().heightIn(min = 148.dp).testTag(HomeTags.INPUT),
            decorationBox = { inner ->
                if (value.isEmpty()) Text(placeholder, style = JudgeType.body.copy(color = Palette.placeholder))
                inner()
            },
        )
    }
}

@Composable
private fun Counter(count: Int, lang: AppLang) {
    val s = LocalStrings.current
    val nf = remember(lang) { NumberFormat.getIntegerInstance(lang.locale) }
    val warn = count > ArgumentRules.WARN_AT
    Text(
        s.appInputCounter(nf.format(count), nf.format(ArgumentRules.MAX)),
        style = JudgeType.footnote.copy(color = if (warn) Palette.terraInk else Palette.muted),
        textAlign = TextAlign.End,
        modifier = Modifier.fillMaxWidth().padding(top = 6.dp).testTag(HomeTags.COUNTER),
    )
}

@Composable
private fun ErrorBanner(error: UiError, onDismiss: () -> Unit) {
    val s = LocalStrings.current
    val lang = LocalLang.current
    val text = Errors.message(error, s, lang)
    Row(
        Modifier
            .fillMaxWidth()
            .padding(top = 20.dp)
            .clip(JudgeShapes.field)
            .background(Palette.terraTint)
            .border(1.dp, Palette.terra.copy(alpha = 0.4f), JudgeShapes.field)
            .semantics { liveRegion = LiveRegionMode.Polite }
            .testTag(HomeTags.ERROR)
            .padding(start = 16.dp, top = 12.dp, bottom = 12.dp, end = 6.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Text(text, style = JudgeType.body.copy(fontSize = 14.5.sp, lineHeight = 21.sp, color = Palette.ink), modifier = Modifier.weight(1f).padding(top = 2.dp))
        Box(
            Modifier
                .clip(JudgeShapes.chip)
                .semantics { contentDescription = s.appCancel }
                .clickable(onClick = onDismiss)
                .padding(8.dp),
        ) { TintedIcon(remember { JudgeIcons.close(Palette.ink2) }, 16) }
    }
}

/** "Just me" / "Both sides" (components/case/CaseModeSwitch.tsx), with the hint for the chosen mode. */
@Composable
private fun CaseModeSwitch(value: CaseMode, disabled: Boolean, onChange: (CaseMode) -> Unit, modifier: Modifier = Modifier) {
    val s = LocalStrings.current
    Column(modifier.fillMaxWidth()) {
        Text(s.modeLabel, style = JudgeType.slotTitle, modifier = Modifier.padding(bottom = 8.dp))
        Row(Modifier.selectableGroup(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf(CaseMode.NOW to s.modeNow, CaseMode.BOTH to s.modeBoth).forEach { (mode, label) ->
                val selected = value == mode
                Row(
                    Modifier
                        .weight(1f)
                        .clip(JudgeShapes.field)
                        .background(if (selected) Palette.terraTint else Palette.paper)
                        .border(if (selected) 1.5.dp else 1.dp, if (selected) Palette.terra else Palette.line2, JudgeShapes.field)
                        .selectable(selected = selected, enabled = !disabled, role = Role.RadioButton) { onChange(mode) }
                        .testTag(if (mode == CaseMode.BOTH) HomeTags.MODE_BOTH else HomeTags.MODE_NOW)
                        .padding(horizontal = 14.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Box(
                        Modifier.size(18.dp).clip(CircleShape).border(1.5.dp, if (selected) Palette.ink else Palette.line2, CircleShape),
                        contentAlignment = Alignment.Center,
                    ) { if (selected) Box(Modifier.size(9.dp).clip(CircleShape).background(Palette.ink)) }
                    Text(label, style = JudgeType.small.copy(color = Palette.ink))
                }
            }
        }
        Text(
            if (value == CaseMode.BOTH) s.modeBothHint else s.modeNowHint,
            style = JudgeType.slotText,
            modifier = Modifier.padding(top = 8.dp),
        )
    }
}

@Composable
private fun NameField(value: String, onChange: (String) -> Unit, enabled: Boolean) {
    Box(
        Modifier
            .fillMaxWidth()
            .clip(JudgeShapes.field)
            .background(Palette.paper)
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

