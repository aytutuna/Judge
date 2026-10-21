package com.okjudge.judge.ui.premium

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import com.okjudge.judge.core.model.Entitlement
import com.okjudge.judge.core.premium.NoteLink
import com.okjudge.judge.core.premium.Tier
import com.okjudge.judge.core.premium.TierAvailability
import com.okjudge.judge.core.premium.Tiers
import com.okjudge.judge.i18n.LocalLang
import com.okjudge.judge.i18n.LocalStrings
import com.okjudge.judge.ui.components.JudgeIcons
import com.okjudge.judge.ui.components.TintedIcon
import com.okjudge.judge.ui.theme.JudgeShapes
import com.okjudge.judge.ui.theme.JudgeType
import com.okjudge.judge.ui.theme.Palette

object TierTags {
    const val FREE = "tier.free"
    const val PREMIUM = "tier.premium"
    const val NOTE = "tier.note"
    const val NOTE_LINK = "tier.noteLink"
}

/**
 * Free / Premium beside "Get the verdict" (components/TierSwitch.tsx).
 * While Premium is locked (signed out, or nothing left to spend) choosing it
 * never changes the value: it remembers the intent and reveals the sign-in
 * or pricing link in a polite live region instead. [value] is the effective
 * tier. Renders nothing while [availability] is HIDDEN.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun TierSwitch(
    availability: TierAvailability,
    value: Tier,
    entitlement: Entitlement?,
    disabled: Boolean,
    onChange: (Tier) -> Unit,
    onPremiumIntent: () -> Unit,
    onSignIn: () -> Unit,
    onPricing: () -> Unit,
    modifier: Modifier = Modifier,
    initiallyNudged: Boolean = false,
) {
    if (availability == TierAvailability.HIDDEN) return
    val s = LocalStrings.current
    val lang = LocalLang.current
    var nudged by rememberSaveable { mutableStateOf(initiallyNudged) }
    val locked = availability != TierAvailability.AVAILABLE
    val note = Tiers.note(s, lang, availability, value, entitlement, nudged)

    fun pick(tier: Tier) {
        if (tier == Tier.PREMIUM && locked) {
            nudged = true
            onPremiumIntent()
            return
        }
        onChange(tier)
    }

    Column(modifier, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(
            Modifier
                .clip(JudgeShapes.chip)
                .background(Palette.paper)
                .border(1.dp, Palette.line2, JudgeShapes.chip)
                .padding(3.dp)
                .selectableGroup()
                .alpha(if (disabled) 0.55f else 1f),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Option(s.tierFree, selected = value == Tier.FREE, enabled = !disabled, tag = TierTags.FREE, onClick = { pick(Tier.FREE) })
            Option(
                text = s.tierPremium,
                selected = value == Tier.PREMIUM,
                enabled = !disabled,
                tag = TierTags.PREMIUM,
                spark = true,
                lockedLabel = when {
                    !locked -> null
                    availability == TierAvailability.SIGNED_OUT -> s.tierLockedSignIn
                    else -> s.tierLockedNoAllowance
                },
                onClick = { pick(Tier.PREMIUM) },
            )
        }
        Box(Modifier.fillMaxWidth().semantics { liveRegion = LiveRegionMode.Polite }) {
            if (note != null) {
                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                    itemVerticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.testTag(TierTags.NOTE),
                ) {
                    if (note.text.isNotEmpty()) Text(note.text, style = JudgeType.slotText.copy(color = Palette.ink2))
                    if (note.link != null && note.linkLabel != null) {
                        val target = note.link
                        Text(
                            note.linkLabel,
                            style = JudgeType.slotText.copy(color = Palette.terraInk, fontWeight = FontWeight.SemiBold, textDecoration = TextDecoration.Underline),
                            modifier = Modifier
                                .clip(JudgeShapes.chip)
                                .clickable(role = Role.Button) { if (target == NoteLink.SIGN_IN) onSignIn() else onPricing() }
                                .testTag(TierTags.NOTE_LINK)
                                .padding(vertical = 4.dp),
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun Option(
    text: String,
    selected: Boolean,
    enabled: Boolean,
    tag: String,
    onClick: () -> Unit,
    spark: Boolean = false,
    lockedLabel: String? = null,
) {
    Row(
        Modifier
            .defaultMinSize(minHeight = 48.dp)
            .clip(JudgeShapes.chip)
            .background(if (selected) Palette.ink else Palette.paper)
            .selectable(selected = selected, enabled = enabled, role = Role.RadioButton, onClick = onClick)
            .then(if (lockedLabel != null) Modifier.semantics { contentDescription = "$text, $lockedLabel" } else Modifier)
            .testTag(tag)
            .padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        val color = if (selected) Palette.ivory else Palette.ink
        if (spark) TintedIcon(remember(color) { JudgeIcons.spark(if (selected) Palette.ivory else Palette.terra) }, 12)
        Text(text, style = JudgeType.small.copy(color = color))
        if (lockedLabel != null) TintedIcon(remember { JudgeIcons.lock(Palette.muted) }, 11)
    }
}
