package com.okjudge.judge.ui.verdict

import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
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
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.okjudge.judge.core.display.ConditionalClause
import com.okjudge.judge.core.display.FactSources
import com.okjudge.judge.core.display.PartyLabels
import com.okjudge.judge.core.display.RestoreNames
import com.okjudge.judge.core.display.VerdictDisplay
import com.okjudge.judge.core.display.Vote
import com.okjudge.judge.core.model.AppealInfo
import com.okjudge.judge.core.model.AppealOutcome
import com.okjudge.judge.core.model.ArgumentMap
import com.okjudge.judge.core.model.Claim
import com.okjudge.judge.core.model.ClaimKind
import com.okjudge.judge.core.model.CruxTrial
import com.okjudge.judge.core.model.DisputeType
import com.okjudge.judge.core.model.FactCheck
import com.okjudge.judge.core.model.FinalVerdict
import com.okjudge.judge.core.model.LeanState
import com.okjudge.judge.core.model.NameMapping
import com.okjudge.judge.core.model.TrialOutcome
import com.okjudge.judge.core.model.VerdictResult
import com.okjudge.judge.i18n.AppLang
import com.okjudge.judge.i18n.LocalLang
import com.okjudge.judge.i18n.LocalStrings
import com.okjudge.judge.i18n.Strings
import com.okjudge.judge.ui.components.BrandMark
import com.okjudge.judge.ui.components.JudgeIcons
import com.okjudge.judge.ui.components.Kicker
import com.okjudge.judge.ui.components.PaperCard
import com.okjudge.judge.ui.components.TintedIcon
import com.okjudge.judge.ui.components.uppercaseForUi
import com.okjudge.judge.ui.openLink
import com.okjudge.judge.ui.theme.BrandFonts
import com.okjudge.judge.ui.theme.JudgeShapes
import com.okjudge.judge.ui.theme.JudgeType
import com.okjudge.judge.ui.theme.Palette
import com.okjudge.judge.ui.theme.cappedScale

/** What the translation pill says (lib/use-translation.ts statuses plus offline). */
enum class TranslationStatus { ORIGINAL, LOADING, TRANSLATED, ERROR, OFFLINE }

data class TranslationView(val result: VerdictResult, val status: TranslationStatus, val source: AppLang) {
    /** The shown result with real names restored (display only; `selfLang` is the original's language). */
    fun personalized(nameMap: List<NameMapping>?, selfLang: AppLang): TranslationView =
        copy(result = RestoreNames.personalizeResult(result, nameMap, selfLang))
}

/** Card actions; null hides them (e.g. previews). */
data class CardActions(
    val onShare: (() -> Unit)?,
    val onCopy: (() -> Unit)?,
    val copied: Boolean,
)

/**
 * The full verdict display (components/VerdictView.tsx): the card (stamp,
 * headline, confidence and votes, notes and branches, then the crux,
 * bedrock and best point), then the argument map, fact check and facts
 * below it. Text comes from `view.result` (translated when available);
 * party labels follow the UI language.
 */
@Composable
fun VerdictContent(
    view: TranslationView,
    parties: PartyLabels,
    restoredNames: List<String>,
    actions: CardActions,
    modifier: Modifier = Modifier,
) {
    val s = LocalStrings.current
    val result = view.result
    val busy = view.status == TranslationStatus.LOADING
    Column(modifier, verticalArrangement = Arrangement.spacedBy(28.dp)) {
        result.appeal?.let { appeal ->
            val byA = appeal.by == "a"
            AppealOutcomeBanner(
                appeal = appeal,
                confidence = result.confidence,
                byName = if (byA) parties.nameA else parties.nameB,
                bySelf = if (byA) parties.aIsSelf else parties.bIsSelf,
            )
        }
        PaperCard {
            BoxWithConstraints {
                Column(
                    Modifier.padding(start = 20.dp, end = 20.dp, top = 26.dp, bottom = 20.dp),
                    verticalArrangement = Arrangement.spacedBy(16.dp),
                ) {
                    CardTopRow(view, result)
                    Column(
                        Modifier.alpha(if (busy) 0.55f else 1f).animateContentSize(),
                        verticalArrangement = Arrangement.spacedBy(16.dp),
                    ) {
                        VerdictReveal(result, parties, restoredNames)
                        if (!result.refused) {
                            Section(s.cruxShort) { Text(result.crux, style = SectionText) }
                            val map = result.argumentMap
                            if (map.bedrockA.isNotEmpty() || map.bedrockB.isNotEmpty()) {
                                Section(s.bedrock) { BedrockTiles(map.bedrockA, map.bedrockB, parties) }
                            }
                            if (result.losingSideBestPoint.isNotEmpty()) {
                                Section(bestPointTitle(result, parties, s)) { Text(result.losingSideBestPoint, style = SectionText) }
                            }
                            WouldChangeBlock(result.wouldChange.orEmpty())
                        }
                        Footnote(result, parties)
                        ActionsRow(actions)
                    }
                }
                Stamp(
                    VerdictDisplay.stampLabel(result, parties, s),
                    Modifier.align(Alignment.TopEnd).padding(top = 22.dp, end = 18.dp).widthIn(max = maxWidth * 0.46f),
                )
            }
        }
        if (!result.refused) {
            Column(
                Modifier.alpha(if (busy) 0.55f else 1f),
                verticalArrangement = Arrangement.spacedBy(28.dp),
            ) {
                if (result.isTwoSided) TwoSidedFacts(result, parties)
                ArgumentMapSection(result.argumentMap, parties)
                result.factCheck?.let { FactCheckSection(it, result.dispute) }
                if (result.factsReliedOn.isNotEmpty()) FactsSection(result.factsReliedOn)
            }
        }
    }
}

// --- Top row --------------------------------------------------------------------

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun CardTopRow(view: TranslationView, result: VerdictResult) {
    val s = LocalStrings.current
    // The right half is the stamp's.
    FlowRow(
        Modifier.fillMaxWidth(0.5f).heightIn(min = 44.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
        itemVerticalAlignment = Alignment.CenterVertically,
    ) {
        val note = when (view.status) {
            TranslationStatus.LOADING -> s.translateLoading
            TranslationStatus.TRANSLATED -> if (view.source == AppLang.TR) s.translateFromTr else s.translateFromEn
            TranslationStatus.ERROR -> s.translateFailed
            TranslationStatus.OFFLINE -> s.appTranslateOffline
            TranslationStatus.ORIGINAL -> null
        }
        if (note != null) {
            TranslationNote(note, loading = view.status == TranslationStatus.LOADING)
        } else {
            Row(
                Modifier.clearAndSetSemantics { },
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(7.dp),
            ) {
                BrandMark(20.dp)
                Text(s.appName, style = JudgeType.brandTag)
            }
        }
        if (result.premium) {
            Text(
                s.premiumBadge.uppercaseForUi(),
                style = JudgeType.micro.copy(color = Palette.ivory),
                modifier = Modifier.clip(JudgeShapes.chip).background(Palette.ink).padding(horizontal = 10.dp, vertical = 5.dp),
            )
            if (result.isTwoSided) {
                Text(
                    s.twoSidedBadge.uppercaseForUi(),
                    style = JudgeType.micro.copy(color = Palette.ink2),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier
                        .clip(JudgeShapes.chip)
                        .border(1.dp, Palette.line2, JudgeShapes.chip)
                        .padding(horizontal = 10.dp, vertical = 5.dp),
                )
            }
        }
    }
}

@Composable
private fun TranslationNote(text: String, loading: Boolean) {
    Row(
        Modifier
            .clip(JudgeShapes.chip)
            .background(Palette.ivory)
            .border(1.dp, Palette.line2, JudgeShapes.chip)
            .padding(horizontal = 11.dp, vertical = 5.dp)
            .semantics { liveRegion = LiveRegionMode.Polite },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(7.dp),
    ) {
        if (loading) CircularProgressIndicator(Modifier.size(11.dp), color = Palette.ink, strokeWidth = 1.5.dp)
        Text(text, style = JudgeType.small.copy(fontSize = 12.sp))
    }
}

@Composable
fun VoteDots(votes: List<Vote>, modifier: Modifier = Modifier) {
    Row(modifier.clearAndSetSemantics { }, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
        votes.forEach { VoteDot(it, 10) }
    }
}

@Composable
fun VoteDot(vote: Vote?, sizeDp: Int) {
    Canvas(Modifier.size(sizeDp.dp)) {
        when (vote) {
            Vote.A -> drawCircle(Palette.terra)
            Vote.B -> drawCircle(Palette.sageStrong)
            Vote.OTHER -> drawCircle(Palette.ink, radius = size.minDimension / 2 - 0.75.dp.toPx(), style = Stroke(1.5.dp.toPx()))
            null -> drawCircle(Palette.ink.copy(alpha = 0.18f))
        }
    }
}

// --- Stamp, lead, notes -----------------------------------------------------------

/** Decorative: the heading below carries the ruling for screen readers. */
@Composable
private fun Stamp(text: String, modifier: Modifier) {
    Box(
        modifier
            .rotate(8f)
            .clip(RoundedCornerShape(8.dp))
            .border(2.dp, Palette.terra, RoundedCornerShape(8.dp))
            .clearAndSetSemantics { }
            .padding(horizontal = 10.dp, vertical = 5.dp),
    ) {
        Text(
            text.uppercaseForUi(),
            style = StampText,
            textAlign = TextAlign.Center,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

private val StampText = TextStyle(
    fontFamily = BrandFonts.interTight(800),
    fontWeight = FontWeight.ExtraBold,
    fontSize = 13.sp,
    lineHeight = (13 * 1.15).sp,
    letterSpacing = 0.12.em,
    color = Palette.terra,
)

private val SectionText = TextStyle(
    fontFamily = BrandFonts.inter(400, 15f),
    fontSize = 15.sp,
    lineHeight = (15 * 1.55).sp,
    color = Palette.ink,
)

/** The dispute kind, the headline as the card's heading, confidence and votes; then notes and branches. */
@Composable
private fun VerdictReveal(result: VerdictResult, parties: PartyLabels, restoredNames: List<String>) {
    val s = LocalStrings.current
    val label = VerdictDisplay.verdictLabel(result, parties, s)
    val headline = result.headline.ifEmpty { label }
    val size = (LocalConfiguration.current.screenWidthDp * 0.08f).coerceIn(30f, 34f)
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        s.text("badge.${result.dispute.raw}")?.let { badge ->
            Text(badge.uppercaseForUi(), style = JudgeType.micro.copy(fontWeight = FontWeight.SemiBold, letterSpacing = 0.1.em))
        }
        Text(
            headline,
            style = JudgeType.ruling.copy(fontSize = size.sp, lineHeight = (size * 1.05).sp).cappedScale(),
            modifier = Modifier.semantics {
                heading()
                contentDescription = "$label. $headline"
            },
        )
        Meta(result)
    }
    Box(Modifier.fillMaxWidth().padding(vertical = 2.dp).height(1.dp).background(Palette.ink.copy(alpha = 0.8f)))
    if (result.leanState != LeanState.None || result.cruxTrial != null || result.refused || result.demo) {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) { Slots(result, parties) }
    }
    Branches(result, parties, restoredNames)
}

/** "Confidence 4 of 5 · (dots) 3 of 3 agree". */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Meta(result: VerdictResult) {
    val s = LocalStrings.current
    val style = JudgeType.small.copy(color = Palette.ink2)
    FlowRow(
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
        itemVerticalAlignment = Alignment.CenterVertically,
    ) {
        Text(s.confidenceAria(VerdictDisplay.confidenceLevel(result.confidence).toString()), style = style)
        if (result.runs.isNotEmpty()) {
            Text("\u00b7", style = style, modifier = Modifier.clearAndSetSemantics { })
            Row(verticalAlignment = Alignment.CenterVertically) {
                VoteDots(result.runs.map(VerdictDisplay::voteOf))
                val agreed = VerdictDisplay.agreement(result)
                Text(
                    if (agreed != null) s.verdictAgree(agreed.n.toString(), agreed.total.toString()) else s.verdictNoMajority,
                    style = style,
                    modifier = Modifier.padding(start = 8.dp),
                )
            }
        }
    }
}

@Composable
private fun Dot(color: Color, sizeDp: Int) {
    Box(Modifier.size(sizeDp.dp).clip(CircleShape).background(color))
}

@Composable
private fun Slot(content: @Composable () -> Unit) {
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(4.dp)) { content() }
}

@Composable
private fun SlotText(text: String, color: Color = Palette.muted) {
    Text(text, style = JudgeType.slotText.copy(color = color), modifier = Modifier.fillMaxWidth())
}

@Composable
private fun Slots(result: VerdictResult, parties: PartyLabels) {
    val s = LocalStrings.current
    when (val lean = result.leanState) {
        is LeanState.Leans -> Slot {
            val l = lean.lean
            val isA = l.party == "a"
            val self = if (isA) parties.aIsSelf else parties.bIsSelf
            val name = if (isA) parties.nameA else parties.nameB
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                Dot(if (isA) Palette.terra else Palette.sageStrong, 9)
                Text(if (self) s.leanTitleSelf else s.leanTitle(name), style = JudgeType.slotTitle)
            }
            SlotText(l.reason)
            if (result.runs.size >= 2) {
                val text = if (l.unanimous) {
                    s.leanUnanimous
                } else {
                    val t = VerdictDisplay.leanTally(l, result.runs.size)
                    s.leanMajority(t.forVotes.toString(), t.against.toString())
                }
                SlotText(text)
            }
        }
        LeanState.Tie -> Slot { SlotText(s.leanTie) }
        LeanState.None -> Unit
    }
    result.cruxTrial?.let { CruxTrialNote(it) }
    if (result.refused) Slot { SlotText(s.refusedNote) }
    if (result.demo) Slot { SlotText(s.demoNote) }
}

@Composable
private fun CruxTrialNote(trial: CruxTrial) {
    val s = LocalStrings.current
    if (trial.trialOutcome == TrialOutcome.SURVIVED) {
        var open by rememberSaveable { mutableStateOf(false) }
        Slot {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                TintedIcon(remember { JudgeIcons.shield(Palette.ink2) }, 14)
                Text(s.trialSurvived, style = JudgeType.slotText.copy(color = Palette.ink2))
            }
            if (trial.attack.isNotBlank()) {
                Text(
                    s.trialWhatWasTested,
                    style = JudgeType.slotText.copy(color = Palette.ink2, fontWeight = FontWeight.SemiBold),
                    modifier = Modifier.clip(RoundedCornerShape(8.dp)).clickable { open = !open }.padding(4.dp),
                )
                if (open) {
                    SlotText("${s.trialAttackPrefix} ${trial.attack}")
                    if (trial.reasoning.isNotEmpty()) SlotText("${s.trialRefereePrefix} ${trial.reasoning}")
                }
            }
        }
        return
    }
    val overturned = trial.trialOutcome == TrialOutcome.OVERTURNED
    val color = if (overturned) Palette.danger else Palette.ink2
    Slot {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            TintedIcon(remember(color) { JudgeIcons.alert(color) }, 14)
            Text(
                if (overturned) s.trialOverturned else s.trialUncertain,
                style = JudgeType.slotText.copy(color = color),
            )
        }
        SlotText("${s.trialAttackPrefix} ${trial.attack}")
        if (trial.reasoning.isNotEmpty()) SlotText("${s.trialRefereePrefix} ${trial.reasoning}")
    }
}

// --- Branches -------------------------------------------------------------------

@Composable
private fun Branches(result: VerdictResult, parties: PartyLabels, restoredNames: List<String>) {
    val s = LocalStrings.current
    val lang = LocalLang.current
    val split = result.splitPoints
    val conditional = result.conditional
    if (result.finalVerdict == FinalVerdict.SPLIT && !split.isNullOrEmpty()) {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            split.forEach { p ->
                val isA = p.party == "a"
                val self = if (isA) parties.aIsSelf else parties.bIsSelf
                val name = if (isA) parties.nameA else parties.nameB
                Branch(if (isA) Palette.terraTint else Palette.sageTint, if (isA) Palette.terra else Palette.sageStrong) {
                    BranchText(if (self) s.splitWinSelf else s.splitWin(name), p.point, null)
                }
            }
        }
    }
    if (result.finalVerdict == FinalVerdict.CONDITIONAL && !conditional.isNullOrEmpty()) {
        val keep = listOf(if (parties.aIsSelf) "" else parties.nameA, if (parties.bIsSelf) "" else parties.nameB) + restoredNames
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            conditional.forEach { c ->
                Branch(Palette.paper, null) {
                    BranchText("${s.ifPrefix} ${ConditionalClause.clause(c.ifValue, lang, keep)}", c.then, "→")
                }
            }
        }
    }
}

@Composable
private fun Branch(bg: Color, rule: Color?, content: @Composable () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .height(IntrinsicSize.Min)
            .clip(JudgeShapes.branch)
            .background(bg)
            .then(if (rule == null) Modifier.border(1.dp, Palette.line2, JudgeShapes.branch) else Modifier),
    ) {
        if (rule != null) Box(Modifier.width(3.dp).fillMaxHeight().background(rule))
        Box(Modifier.padding(horizontal = 14.dp, vertical = 12.dp)) { content() }
    }
}

@Composable
private fun BranchText(lead: String, rest: String, arrow: String?) {
    val text = androidx.compose.ui.text.buildAnnotatedString {
        pushStyle(JudgeType.branchLead.toSpanStyle().copy(color = if (arrow != null) Palette.ink2 else Palette.ink))
        append(lead)
        pop()
        append(if (arrow != null) " $arrow " else " ")
        append(rest)
    }
    Text(text, style = JudgeType.branch)
}

// --- Sections, footnote, actions -------------------------------------------------

/** A titled part of the card under the rule (verdict.module.css .section). */
@Composable
private fun Section(label: String, content: @Composable () -> Unit) {
    Column {
        Text(label, style = JudgeType.serifLabel, modifier = Modifier.padding(bottom = 6.dp).semantics { heading() })
        content()
    }
}

@Composable
private fun BedrockTiles(a: String, b: String, parties: PartyLabels) {
    Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        BedrockTile(parties.nameA, a, Palette.terraInk, Modifier.weight(1f))
        BedrockTile(parties.nameB, b, Palette.sageInk, Modifier.weight(1f))
    }
}

@Composable
private fun BedrockTile(name: String, text: String, color: Color, modifier: Modifier) {
    Column(
        modifier
            .fillMaxHeight()
            .clip(RoundedCornerShape(14.dp))
            .background(Palette.ivory)
            .padding(horizontal = 14.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text(
            name.uppercaseForUi(),
            style = JudgeType.micro.copy(color = color, letterSpacing = 0.1.em),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Text(text, style = JudgeType.body.copy(fontSize = 14.sp, lineHeight = (14 * 1.45).sp))
    }
}

/** "Deniz's best point" when one side won, the plain title otherwise. */
private fun bestPointTitle(result: VerdictResult, parties: PartyLabels, s: Strings): String {
    val loserA = when (result.finalVerdict) {
        FinalVerdict.SIDE_A -> false
        FinalVerdict.SIDE_B -> true
        else -> return s.bestPointTitle
    }
    if (if (loserA) parties.aIsSelf else parties.bIsSelf) return s.bestPointSelf
    return s.bestPointOf(if (loserA) parties.nameA else parties.nameB)
}

private fun Modifier.dashedBorder(color: Color): Modifier = drawBehind {
    val stroke = 1.5.dp.toPx()
    drawRoundRect(
        color = color,
        topLeft = Offset(stroke / 2, stroke / 2),
        size = androidx.compose.ui.geometry.Size(size.width - stroke, size.height - stroke),
        cornerRadius = CornerRadius(20.dp.toPx()),
        style = Stroke(width = stroke, pathEffect = PathEffect.dashPathEffect(floatArrayOf(6.dp.toPx(), 4.dp.toPx()))),
    )
}

@Composable
private fun Footnote(result: VerdictResult, parties: PartyLabels) {
    if (result.runs.isEmpty()) return
    val s = LocalStrings.current
    val lines = buildList {
        if (result.escalated == true) add(s.escalated)
        val votes = result.runs.joinToString(" · ") { voteName(it, parties, s) }
        add("${s.judgesVoted(result.runs.size)} $votes")
        if (result.premium) {
            val models = result.panel?.models.orEmpty()
            add(if (models.isNotEmpty()) "${s.panelPremium} ${VerdictDisplay.panelSummary(models, s)}" else s.panelPremium)
        }
        VerdictDisplay.evidenceNote(result, s)?.let { add(it) }
    }
    Text(lines.joinToString("\n"), style = JudgeType.footnote, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
}

private fun voteName(run: String, parties: PartyLabels, s: Strings): String = when (run) {
    "side_a" -> parties.nameA
    "side_b" -> parties.nameB
    "split" -> s.voteSplit
    "conditional" -> s.voteConditional
    "dissolved" -> s.voteDissolved
    else -> run
}

/** Share (filled) and copy link (outlined), 48 dp each. */
@Composable
private fun ActionsRow(actions: CardActions) {
    val s = LocalStrings.current
    if (actions.onShare == null && actions.onCopy == null) return
    Row(Modifier.fillMaxWidth().padding(top = 2.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        actions.onShare?.let { share ->
            Row(
                Modifier
                    .weight(1f)
                    .height(48.dp)
                    .clip(JudgeShapes.chip)
                    .background(Palette.ink)
                    .clickable(role = Role.Button, onClick = share)
                    .padding(horizontal = 18.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                TintedIcon(remember { JudgeIcons.share(Palette.ivory) }, 15)
                Text(s.share, style = JudgeType.button.copy(fontSize = 15.sp), maxLines = 1)
            }
        }
        actions.onCopy?.let { copy ->
            val icon = remember(actions.copied) { if (actions.copied) JudgeIcons.check(Palette.sageInk, 2f) else JudgeIcons.link(Palette.ink) }
            Row(
                Modifier
                    .then(if (actions.onShare == null) Modifier.weight(1f) else Modifier)
                    .height(48.dp)
                    .clip(JudgeShapes.chip)
                    .background(Palette.paper)
                    .border(1.dp, Palette.line2, JudgeShapes.chip)
                    .clickable(role = Role.Button, onClick = copy)
                    .semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Polite }
                    .padding(horizontal = 18.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                TintedIcon(icon, 15)
                Text(if (actions.copied) s.copied else s.copyLink, style = JudgeType.button.copy(fontSize = 15.sp, color = Palette.ink), maxLines = 1)
            }
        }
    }
}

// --- Below the card ---------------------------------------------------------------

@Composable
private fun SectionTitle(text: String) {
    Text(
        text.uppercaseForUi(),
        style = JudgeType.micro.copy(fontSize = 12.sp),
        modifier = Modifier.padding(bottom = 12.dp).semantics { heading() },
    )
}

@Composable
private fun ArgumentMapSection(map: ArgumentMap, parties: PartyLabels) {
    val s = LocalStrings.current
    Column {
        SectionTitle(s.mapTitle)
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            ClaimColumn("A", parties.nameA, map.sideA, map.bedrockA, isA = true, Modifier.weight(1f))
            ClaimColumn("B", parties.nameB, map.sideB, map.bedrockB, isA = false, Modifier.weight(1f))
        }
    }
}

@Composable
private fun ClaimColumn(letter: String, name: String, claims: List<Claim>, bedrock: String, isA: Boolean, modifier: Modifier) {
    val s = LocalStrings.current
    Column(modifier, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(
            Modifier
                .fillMaxWidth()
                .clip(JudgeShapes.chip)
                .background(if (isA) Palette.terraTint else Palette.sageTint)
                .padding(start = 6.dp, end = 10.dp, top = 6.dp, bottom = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Box(
                Modifier.size(22.dp).clip(CircleShape).background(if (isA) Palette.terraInk else Palette.sageInk).clearAndSetSemantics { },
                contentAlignment = Alignment.Center,
            ) {
                Text(letter, style = JudgeType.micro.copy(color = Color.White, letterSpacing = 0.sp))
            }
            Text(name, style = JudgeType.slotTitle, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        claims.forEach { c ->
            Row(
                Modifier
                    .fillMaxWidth()
                    .height(IntrinsicSize.Min)
                    .clip(RoundedCornerShape(14.dp))
                    .background(Palette.paper)
                    .border(1.dp, Palette.line, RoundedCornerShape(14.dp)),
            ) {
                Box(Modifier.width(3.dp).fillMaxHeight().background(if (isA) Palette.terra else Palette.sageStrong))
                Column(Modifier.padding(horizontal = 12.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(c.claim, style = JudgeType.body.copy(fontSize = 14.sp, lineHeight = 20.sp))
                    KindTag(c.claimKind, s)
                }
            }
        }
        Box(Modifier.align(Alignment.CenterHorizontally).width(2.dp).height(14.dp).drawDashLine())
        Column(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(14.dp))
                .background(Palette.strata)
                .border(1.dp, Palette.stone, RoundedCornerShape(14.dp))
                .padding(horizontal = 12.dp, vertical = 10.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Kicker(s.bedrock, Modifier.padding(bottom = 6.dp), color = Palette.ink2)
            Text(
                bedrock,
                style = JudgeType.body.copy(fontSize = 14.sp, lineHeight = 20.sp, fontWeight = FontWeight.Medium),
                textAlign = TextAlign.Center,
            )
        }
    }
}

private fun Modifier.drawDashLine(): Modifier = drawBehind {
    drawLine(
        Palette.ink.copy(alpha = 0.28f),
        Offset(size.width / 2, 0f),
        Offset(size.width / 2, size.height),
        strokeWidth = 1.5.dp.toPx(),
        pathEffect = PathEffect.dashPathEffect(floatArrayOf(3.dp.toPx(), 3.dp.toPx())),
    )
}

@Composable
private fun KindTag(kind: ClaimKind, s: Strings) {
    val label = s.text("kind.${kind.raw}") ?: return
    val glyph = when (kind) {
        ClaimKind.FACT -> JudgeIcons.kindFact
        ClaimKind.VALUE -> JudgeIcons.kindValue
        ClaimKind.DEFINITION -> JudgeIcons.kindDefinition
        ClaimKind.LOGIC -> JudgeIcons.kindLogic
        ClaimKind.UNKNOWN -> null
    }
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        glyph?.let { TintedIcon(it, 11) }
        Text(label.uppercaseForUi(), style = JudgeType.micro.copy(color = Palette.ink2, letterSpacing = 0.1.sp * 11))
    }
}

@Composable
private fun FactsSection(facts: List<String>) {
    val s = LocalStrings.current
    Column {
        SectionTitle(s.factsTitle)
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            facts.forEach { f ->
                Row(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(14.dp))
                        .background(Palette.paper)
                        .border(1.dp, Palette.line, RoundedCornerShape(14.dp))
                        .padding(horizontal = 14.dp, vertical = 11.dp),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Box(
                        Modifier.padding(top = 2.dp).size(18.dp).clip(CircleShape).background(Palette.sageInk),
                        contentAlignment = Alignment.Center,
                    ) { TintedIcon(JudgeIcons.factCheck, 10) }
                    Text(f, style = JudgeType.body.copy(fontSize = 15.sp, lineHeight = 22.5.sp, color = Palette.ink2))
                }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun FactCheckSection(check: FactCheck, dispute: DisputeType) {
    val s = LocalStrings.current
    val context = LocalContext.current
    // As on the web: only a "checked" result with claims gets the list; an
    // empty one reads as "none".
    val claims = if (check.status == "checked") check.claims else emptyList()
    Column {
        SectionTitle(s.factcheckTitle)
        if (claims.isEmpty()) {
            val none = if (dispute == DisputeType.FACTUAL || dispute == DisputeType.MIXED) s.factcheckNoneFactual else s.factcheckNone
            Text(if (check.status == "unavailable") s.factcheckUnavailable else none, style = JudgeType.slotText)
        } else {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(s.factcheckLead, style = JudgeType.slotText, modifier = Modifier.padding(bottom = 4.dp))
                claims.forEach { c ->
                    Column(
                        Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(14.dp))
                            .background(Palette.paper)
                            .border(1.dp, Palette.line, RoundedCornerShape(14.dp))
                            .padding(horizontal = 14.dp, vertical = 12.dp),
                        verticalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        s.text("factcheck.status.${c.status}")?.let { FactStatusChip(c.status, it) }
                        Text(c.claim, style = JudgeType.slotTitle)
                        if (c.summary.isNotEmpty()) Text(c.summary, style = JudgeType.slotText.copy(color = Palette.ink2))
                        val sources = FactSources.shown(c.sources)
                        if (sources.isNotEmpty()) {
                            FlowRow(
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                                verticalArrangement = Arrangement.spacedBy(4.dp),
                                itemVerticalAlignment = Alignment.CenterVertically,
                            ) {
                                Text(s.factcheckSources, style = JudgeType.slotText.copy(color = Palette.muted))
                                sources.forEach { src ->
                                    Text(
                                        src.domain,
                                        style = JudgeType.slotText.copy(color = Palette.terraInk),
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                        modifier = Modifier
                                            .widthIn(max = 240.dp)
                                            .clip(RoundedCornerShape(6.dp))
                                            .clickable(role = Role.Button) { openLink(context, src.href) }
                                            .semantics { contentDescription = s.appFactcheckSourceAria(src.title) }
                                            .padding(vertical = 4.dp),
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

/** Status chip with its glyph, so the status never relies on colour alone. */
@Composable
private fun FactStatusChip(status: String, label: String) {
    val (fg, bg) = when (status) {
        "supported" -> Palette.sageInk to Palette.sageTint
        "refuted" -> Palette.danger to Palette.terraTint
        "mixed" -> Palette.ink2 to Palette.strata
        else -> Palette.ink2 to Palette.ivory2
    }
    Row(
        Modifier.clip(JudgeShapes.chip).background(bg).padding(horizontal = 9.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        JudgeIcons.factStatus(status, fg)?.let { glyph -> TintedIcon(remember(status) { glyph }, 11) }
        Text(label.uppercaseForUi(), style = JudgeType.micro.copy(color = fg))
    }
}

// --- Two-sided verdicts and appeals ------------------------------------------------

/** Display caps (the server normalizes the same; a second guard for stored rows). */
private const val MAX_AGREED = 5
private const val MAX_DISPUTED = 4
private const val MAX_WOULD_CHANGE = 3

/** "What would change this verdict", inside the card (WouldChangeBlock). */
@Composable
private fun WouldChangeBlock(items: List<String>) {
    val list = items.filter { it.isNotBlank() }.take(MAX_WOULD_CHANGE)
    if (list.isEmpty()) return
    val s = LocalStrings.current
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(18.dp))
            .background(Palette.ivory)
            .border(1.dp, Palette.line, RoundedCornerShape(18.dp))
            .padding(horizontal = 16.dp, vertical = 14.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Kicker(s.twoSidedWouldChange, Modifier.semantics { heading() })
        list.forEach { item ->
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("•", style = JudgeType.body.copy(color = Palette.ink2))
                Text(item, style = JudgeType.body.copy(fontSize = 15.sp, lineHeight = 22.sp, color = Palette.ink2))
            }
        }
    }
}

/** Agreed and disputed facts of a two-sided verdict, below the card (TwoSidedFacts). */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun TwoSidedFacts(result: VerdictResult, parties: PartyLabels) {
    val s = LocalStrings.current
    val agreed = result.agreedFacts.orEmpty().filter { it.isNotBlank() }.take(MAX_AGREED)
    val disputed = result.disputedFacts.orEmpty().take(MAX_DISPUTED)
    // At most one decisive marker, as the server promises.
    val decisiveAt = disputed.indexOfFirst { it.decisive }
    if (agreed.isEmpty() && disputed.isEmpty()) return
    Column(verticalArrangement = Arrangement.spacedBy(28.dp)) {
        if (agreed.isNotEmpty()) {
            Column {
                SectionTitle(s.twoSidedAgreed)
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    agreed.forEach { fact ->
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(14.dp))
                                .background(Palette.paper)
                                .border(1.dp, Palette.line, RoundedCornerShape(14.dp))
                                .padding(horizontal = 14.dp, vertical = 11.dp),
                            horizontalArrangement = Arrangement.spacedBy(10.dp),
                        ) {
                            Row(Modifier.padding(top = 6.dp).clearAndSetSemantics { }, horizontalArrangement = Arrangement.spacedBy((-3).dp)) {
                                Dot(Palette.terra, 10)
                                Dot(Palette.sageStrong, 10)
                            }
                            Text(fact, style = JudgeType.body.copy(fontSize = 15.sp, lineHeight = 22.5.sp, color = Palette.ink2))
                        }
                    }
                }
            }
        }
        if (disputed.isNotEmpty()) {
            Column {
                SectionTitle(s.twoSidedDisputed)
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    disputed.forEachIndexed { i, d ->
                        val decisive = i == decisiveAt
                        Column(
                            Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(16.dp))
                                .background(Palette.paper)
                                .then(
                                    if (decisive) Modifier.dashedBorder(Palette.ink.copy(alpha = 0.4f))
                                    else Modifier.border(1.dp, Palette.line, RoundedCornerShape(16.dp)),
                                )
                                .padding(horizontal = 14.dp, vertical = 12.dp),
                            verticalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                if (decisive) {
                                    Row(
                                        Modifier.clip(JudgeShapes.chip).background(Palette.ink).padding(horizontal = 9.dp, vertical = 4.dp),
                                        verticalAlignment = Alignment.CenterVertically,
                                        horizontalArrangement = Arrangement.spacedBy(4.dp),
                                    ) {
                                        TintedIcon(remember { JudgeIcons.bolt(Palette.ivory) }, 11)
                                        Text(s.twoSidedDecisive.uppercaseForUi(), style = JudgeType.micro.copy(color = Palette.ivory))
                                    }
                                }
                                FindingChip(findingText(d.finding, parties, s), d.finding)
                            }
                            Text(d.fact, style = JudgeType.slotTitle)
                            ClaimLine(parties.nameA, d.partyA, Palette.terra)
                            ClaimLine(parties.nameB, d.partyB, Palette.sageStrong)
                        }
                    }
                }
            }
        }
    }
}

private fun findingText(finding: String, p: PartyLabels, s: Strings): String = when (finding) {
    "a" -> if (p.aIsSelf) s.twoSidedFindingSelf else s.twoSidedFindingA(p.nameA)
    "b" -> if (p.bIsSelf) s.twoSidedFindingSelf else s.twoSidedFindingB(p.nameB)
    else -> s.twoSidedFindingUnsettled
}

@Composable
private fun FindingChip(text: String, finding: String) {
    val (fg, bg) = when (finding) {
        "a" -> Palette.terraInk to Palette.terraTint
        "b" -> Palette.sageInk to Palette.sageTint
        else -> Palette.ink2 to Palette.ivory2
    }
    Text(
        text,
        style = JudgeType.small.copy(color = fg, fontSize = 12.sp),
        modifier = Modifier.clip(JudgeShapes.chip).background(bg).padding(horizontal = 10.dp, vertical = 4.dp),
    )
}

@Composable
private fun ClaimLine(name: String, claim: String, rule: Color) {
    Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min)) {
        Box(Modifier.width(3.dp).fillMaxHeight().background(rule))
        Column(Modifier.padding(start = 10.dp)) {
            Text(name, style = JudgeType.micro.copy(color = Palette.ink2), maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(claim, style = JudgeType.body.copy(fontSize = 14.sp, lineHeight = 20.sp, color = Palette.ink2))
        }
    }
}

/**
 * Banner on a verdict produced by an appeal (AppealOutcomeBanner): what
 * happened to the verdict, who added context, the confidence change and the
 * summary (or a generic line). "Stands" stays neutral: a green tick would
 * read as "you won".
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun AppealOutcomeBanner(appeal: AppealInfo, confidence: Int, byName: String, bySelf: Boolean, modifier: Modifier = Modifier) {
    val s = LocalStrings.current
    val outcome = appeal.appealOutcome
    val label = when (outcome) {
        AppealOutcome.UPHELD, AppealOutcome.UNKNOWN -> s.appealOutcomeUpheld
        AppealOutcome.OVERTURNED -> s.appealOutcomeOverturned
        AppealOutcome.CHANGED -> s.appealOutcomeChanged
    }
    val generic = when (outcome) {
        AppealOutcome.UPHELD, AppealOutcome.UNKNOWN -> s.appealGenericUpheld
        AppealOutcome.OVERTURNED -> s.appealGenericOverturned
        AppealOutcome.CHANGED -> s.appealGenericChanged
    }
    val (fg, bg) = when (outcome) {
        AppealOutcome.OVERTURNED -> Palette.terraInk to Palette.terraTint
        AppealOutcome.CHANGED -> Palette.sageInk to Palette.sageTint
        else -> Palette.ink2 to Palette.ivory2
    }
    val from = appeal.previousConfidence
    Column(
        modifier
            .fillMaxWidth()
            .clip(JudgeShapes.block)
            .background(Palette.paper)
            .border(1.dp, Palette.line2, JudgeShapes.block)
            .semantics(mergeDescendants = true) { contentDescription = label }
            .padding(horizontal = 16.dp, vertical = 14.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
            itemVerticalAlignment = Alignment.CenterVertically,
        ) {
            Row(
                Modifier.clip(JudgeShapes.chip).background(bg).padding(horizontal = 10.dp, vertical = 5.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(5.dp),
            ) {
                JudgeIcons.appealOutcome(outcome.raw, fg)?.let { glyph -> TintedIcon(remember(outcome) { glyph }, 12) }
                Text(label, style = JudgeType.small.copy(color = fg))
            }
            Text(if (bySelf) s.appealBySelf else s.appealBy(byName), style = JudgeType.slotText.copy(color = Palette.ink2))
            Text(
                if (from == confidence) s.appealConfidenceSame(confidence.toString())
                else "${s.appealConfidence(from.toString())} → $confidence/5",
                style = JudgeType.slotText,
            )
        }
        Text(appeal.summary.trim().ifEmpty { generic }, style = JudgeType.body.copy(fontSize = 15.sp, lineHeight = 22.sp, color = Palette.ink))
    }
}
