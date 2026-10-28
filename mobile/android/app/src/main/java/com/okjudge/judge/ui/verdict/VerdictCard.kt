package com.okjudge.judge.ui.verdict

import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
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
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
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
import com.okjudge.judge.core.model.Claim
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
import com.okjudge.judge.ui.components.JudgeIcons
import com.okjudge.judge.ui.components.SceneView
import com.okjudge.judge.ui.components.TintedIcon
import com.okjudge.judge.ui.components.uppercaseForUi
import com.okjudge.judge.ui.components.warmShadow
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

/** Card actions; null hides them (e.g. previews). [onAddContext]: the writer can add context and appeal. */
data class CardActions(
    val onShare: (() -> Unit)?,
    val onCopy: (() -> Unit)?,
    val copied: Boolean,
    val onAddContext: (() -> Unit)? = null,
)

object VerdictTags {
    const val ADD_CONTEXT = "verdict.addContext"
    const val RULING = "verdict.ruling"
    const val LEAN = "verdict.lean"
    const val CRUX_ROW = "verdict.row.crux"
    const val SIDES_ROW = "verdict.row.sides"
    const val BEST_ROW = "verdict.row.best"
}

/**
 * The ruling at a glance: a short settled scene, the two sides and which
 * way the panel leaned, who is right and how sure, the headline and, for a
 * split or conditional ruling, who won what; then rows into the details
 * ([onDetails]) and the actions. [scene] is off for earlier rulings of a case.
 */
@Composable
fun RulingSummary(
    view: TranslationView,
    parties: PartyLabels,
    actions: CardActions,
    onDetails: () -> Unit,
    reducedMotion: Boolean,
    modifier: Modifier = Modifier,
    scene: Boolean = true,
    restoredNames: List<String> = emptyList(),
) {
    val s = LocalStrings.current
    val result = view.result
    Column(modifier, verticalArrangement = Arrangement.spacedBy(12.dp)) {
        result.appeal?.let { OutcomeBanner(it, parties) }
        Column(
            Modifier
                .fillMaxWidth()
                .warmShadow(10.dp, JudgeShapes.card)
                .clip(JudgeShapes.card)
                .background(Palette.paper)
                .testTag(VerdictTags.RULING)
                .padding(start = 18.dp, end = 18.dp, top = 18.dp, bottom = 20.dp)
                .animateContentSize(),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            TranslationLine(view)
            if (scene) SceneView(VerdictDisplay.sceneVerdict(result), reducedMotion, Modifier.fillMaxWidth().height(118.dp))
            Column(Modifier.alpha(if (view.status == TranslationStatus.LOADING) 0.55f else 1f), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Contenders(parties)
                VerdictDisplay.leanShare(result)?.let { LeanBar(it, parties) }
                LabelRow(result, parties, dots = true)
                Text(
                    result.headline.ifEmpty { VerdictDisplay.verdictLabel(result, parties, s) },
                    style = JudgeType.ruling.copy(fontSize = 30.sp, lineHeight = (30 * 1.06).sp).cappedScale(),
                    modifier = Modifier.semantics { heading() },
                )
                Branches(result, parties, restoredNames)
                if (result.refused) SlotText(s.refusedNote)
            }
        }
        if (!result.refused) {
            val rows = buildList {
                if (result.crux.isNotEmpty()) add(s.cruxShort to VerdictTags.CRUX_ROW)
                val map = result.argumentMap
                if (map.bedrockA.isNotEmpty() || map.bedrockB.isNotEmpty() || map.sideA.isNotEmpty() || map.sideB.isNotEmpty()) {
                    add(s.appVerdictSides to VerdictTags.SIDES_ROW)
                }
                if (result.losingSideBestPoint.isNotEmpty()) add(bestPointTitle(result, parties, s) to VerdictTags.BEST_ROW)
            }
            if (rows.isNotEmpty()) {
                Column(Modifier.fillMaxWidth().clip(JudgeShapes.block).background(Palette.paper)) {
                    rows.forEachIndexed { i, (label, tag) ->
                        DetailRow(label, onDetails, Modifier.testTag(tag))
                        if (i < rows.lastIndex) Box(Modifier.fillMaxWidth().height(1.dp).background(Palette.line))
                    }
                }
            }
        }
        ActionsRow(actions)
    }
}

/**
 * Everything the judges wrote, a section per part that has something in
 * it: the ruling, the crux, what each side stands on and how it got there,
 * the losing side's best point, the facts, the web check, what would
 * change it and the votes.
 */
@Composable
fun VerdictDetails(
    view: TranslationView,
    parties: PartyLabels,
    restoredNames: List<String>,
    actions: CardActions,
    modifier: Modifier = Modifier,
) {
    val s = LocalStrings.current
    val result = view.result
    Column(
        modifier.alpha(if (view.status == TranslationStatus.LOADING) 0.55f else 1f),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        result.appeal?.let { OutcomeBanner(it, parties) }
        DetailCard {
            TranslationLine(view)
            LabelRow(result, parties, dots = false)
            Text(
                result.headline.ifEmpty { VerdictDisplay.verdictLabel(result, parties, s) },
                style = JudgeType.ruling.copy(fontSize = 24.sp, lineHeight = (24 * 1.1).sp).cappedScale(),
                modifier = Modifier.semantics { heading() },
            )
            if (result.leanState != LeanState.None || result.cruxTrial != null || result.refused || result.demo) Slots(result, parties)
            Branches(result, parties, restoredNames)
        }
        if (!result.refused) {
            if (result.crux.isNotEmpty()) {
                DetailSection(s.cruxShort) {
                    Text(result.crux, style = JudgeType.caseTitle.copy(fontSize = 21.sp, lineHeight = (21 * 1.3).sp))
                }
            }
            SidesSection(result, parties)
            if (result.losingSideBestPoint.isNotEmpty()) {
                DetailSection(bestPointTitle(result, parties, s)) { Text(result.losingSideBestPoint, style = SectionText) }
            }
            if (result.factsReliedOn.isNotEmpty()) FactsSection(result.factsReliedOn)
            if (result.isTwoSided) TwoSidedFacts(result, parties)
            result.factCheck?.let { FactCheckSection(it, result.dispute) }
            WouldChange(result.wouldChange.orEmpty())
        }
        Footnote(result, parties)
        ActionsRow(actions)
    }
}

// --- The ruling card -------------------------------------------------------------

@Composable
private fun OutcomeBanner(appeal: AppealInfo, parties: PartyLabels) {
    val byA = appeal.by == "a"
    AppealOutcomeBanner(
        appeal = appeal,
        byName = if (byA) parties.nameA else parties.nameB,
        bySelf = if (byA) parties.aIsSelf else parties.bIsSelf,
    )
}

@Composable
private fun TranslationLine(view: TranslationView) {
    val s = LocalStrings.current
    val note = when (view.status) {
        TranslationStatus.LOADING -> s.translateLoading
        TranslationStatus.TRANSLATED -> if (view.source == AppLang.TR) s.translateFromTr else s.translateFromEn
        TranslationStatus.ERROR -> s.translateFailed
        TranslationStatus.OFFLINE -> s.appTranslateOffline
        TranslationStatus.ORIGINAL -> null
    } ?: return
    TranslationNote(note, loading = view.status == TranslationStatus.LOADING)
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
private fun PremiumBadge() {
    val s = LocalStrings.current
    Text(
        s.premiumBadge,
        style = JudgeType.small.copy(fontSize = 11.sp, color = Palette.paper),
        modifier = Modifier.clip(JudgeShapes.chip).background(Palette.ink).padding(horizontal = 8.dp, vertical = 3.dp),
    )
}

/** "(A) Alex  vs  Sam (B)". */
@Composable
private fun Contenders(parties: PartyLabels) {
    val s = LocalStrings.current
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Avatar("A", Palette.terra)
            Text(parties.nameA, style = JudgeType.bodyStrong.copy(fontSize = 15.sp, fontWeight = FontWeight.Bold), maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Text(s.appVerdictVs, style = JudgeType.footnote.copy(fontSize = 12.sp), modifier = Modifier.padding(horizontal = 8.dp))
        Row(
            Modifier.weight(1f),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End),
        ) {
            Text(
                parties.nameB,
                style = JudgeType.bodyStrong.copy(fontSize = 15.sp, color = Palette.ink2),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f, fill = false),
            )
            Avatar("B", Palette.sageInk)
        }
    }
}

@Composable
private fun Avatar(letter: String, color: Color) {
    Box(Modifier.size(28.dp).clip(CircleShape).background(color).clearAndSetSemantics { }, contentAlignment = Alignment.Center) {
        Text(letter, style = JudgeType.micro.copy(fontSize = 12.sp, color = Palette.paper, letterSpacing = 0.sp))
    }
}

/** Party A's share of the counted votes from the left, the rest in B's tint. */
@Composable
private fun LeanBar(share: Float, parties: PartyLabels) {
    val s = LocalStrings.current
    val said = when {
        share > 0.5f -> s.appVerdictLeanTo(parties.nameA)
        share < 0.5f -> s.appVerdictLeanTo(parties.nameB)
        else -> s.appVerdictLeanNone
    }
    Box(
        Modifier
            .fillMaxWidth()
            .height(12.dp)
            .clip(JudgeShapes.chip)
            .background(Palette.sageTint)
            .semantics { contentDescription = said }
            .testTag(VerdictTags.LEAN),
    ) {
        if (share > 0f) Box(Modifier.fillMaxWidth(share).fillMaxHeight().clip(JudgeShapes.chip).background(Palette.terra))
    }
}

/** "Alex is right", then the vote dots ([dots]) and "Confidence 3 of 3". */
@Composable
private fun LabelRow(result: VerdictResult, parties: PartyLabels, dots: Boolean) {
    val s = LocalStrings.current
    val color = when (result.finalVerdict) {
        FinalVerdict.SIDE_A -> Palette.terraInk
        FinalVerdict.SIDE_B -> Palette.sageInk
        else -> Palette.ink2
    }
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(
            VerdictDisplay.verdictLabel(result, parties, s).uppercaseForUi(),
            style = LabelText.copy(color = color),
            modifier = Modifier.weight(1f),
        )
        val votes = VerdictDisplay.votes(result)
        if (dots && votes.isNotEmpty()) {
            Row(Modifier.clearAndSetSemantics { }, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                votes.forEach { VoteDot(it, 9) }
            }
        }
        VerdictDisplay.confidenceLabel(result, s)?.let {
            Text(it, style = JudgeType.slotTitle.copy(fontSize = 13.sp), maxLines = 1)
        }
    }
}

private val LabelText = TextStyle(
    fontFamily = BrandFonts.interTight(800),
    fontWeight = FontWeight.ExtraBold,
    fontSize = 13.sp,
    lineHeight = (13 * 1.2).sp,
    letterSpacing = 0.1.em,
)

@Composable
private fun DetailRow(label: String, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Row(
        modifier
            .fillMaxWidth()
            .heightIn(min = 52.dp)
            .clickable(role = Role.Button, onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, style = JudgeType.bodyStrong.copy(fontSize = 15.sp), modifier = Modifier.weight(1f))
        TintedIcon(remember { JudgeIcons.chevron(Palette.muted) }, 16)
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

/**
 * Share (filled) and, beside it, "Add context & appeal" for the writer or
 * the copy link for everyone else.
 */
@Composable
private fun ActionsRow(actions: CardActions) {
    val s = LocalStrings.current
    val second = actions.onAddContext ?: actions.onCopy
    if (actions.onShare == null && second == null) return
    Row(Modifier.fillMaxWidth().padding(top = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        actions.onShare?.let { share ->
            Row(
                Modifier
                    .weight(1f)
                    .height(52.dp)
                    .clip(JudgeShapes.field)
                    .background(Palette.ink)
                    .clickable(role = Role.Button, onClick = share)
                    .padding(horizontal = 14.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                TintedIcon(remember { JudgeIcons.share(Palette.ivory) }, 15)
                Text(s.share, style = JudgeType.button.copy(fontSize = 15.sp, color = Palette.paper), maxLines = 1)
            }
        }
        val addContext = actions.onAddContext
        if (addContext != null) {
            OutlinedAction(s.appAppealTitle, addContext, Modifier.weight(1f).testTag(VerdictTags.ADD_CONTEXT))
        } else {
            actions.onCopy?.let { copy ->
                OutlinedAction(
                    if (actions.copied) s.copied else s.copyLink,
                    copy,
                    Modifier.weight(1f).semantics { liveRegion = LiveRegionMode.Polite },
                    icon = { TintedIcon(remember(actions.copied) { if (actions.copied) JudgeIcons.check(Palette.sageInk, 2f) else JudgeIcons.link(Palette.ink) }, 15) },
                )
            }
        }
    }
}

@Composable
private fun OutlinedAction(text: String, onClick: () -> Unit, modifier: Modifier, icon: (@Composable () -> Unit)? = null) {
    Row(
        modifier
            .height(52.dp)
            .clip(JudgeShapes.field)
            .background(Palette.paper)
            .border(1.dp, Palette.line2, JudgeShapes.field)
            .semantics(mergeDescendants = true) {}
            .clickable(role = Role.Button, onClick = onClick)
            .padding(horizontal = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        icon?.invoke()
        Text(text, style = JudgeType.button.copy(fontSize = 15.sp, color = Palette.ink), maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

// --- Detail sections ---------------------------------------------------------------

@Composable
private fun DetailCard(content: @Composable ColumnScope.() -> Unit) {
    Column(
        Modifier
            .fillMaxWidth()
            .clip(JudgeShapes.block)
            .background(Palette.paper)
            .padding(horizontal = 18.dp, vertical = 16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
        content = content,
    )
}

/** A titled card of the details (the italic serif label over its content). */
@Composable
private fun DetailSection(title: String, trailing: (@Composable () -> Unit)? = null, content: @Composable ColumnScope.() -> Unit) {
    DetailCard {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(title, style = JudgeType.serifLabel.copy(fontSize = 17.sp), modifier = Modifier.weight(1f).semantics { heading() })
            trailing?.invoke()
        }
        content()
    }
}

private val SectionText = TextStyle(
    fontFamily = BrandFonts.inter(400, 15f),
    fontSize = 15.sp,
    lineHeight = (15 * 1.5).sp,
    color = Palette.ink,
)

@Composable
private fun SlotText(text: String, color: Color = Palette.muted) {
    Text(text, style = JudgeType.slotText.copy(color = color), modifier = Modifier.fillMaxWidth())
}

@Composable
private fun Slot(content: @Composable () -> Unit) {
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(4.dp)) { content() }
}

@Composable
private fun Dot(color: Color, sizeDp: Int) {
    Box(Modifier.size(sizeDp.dp).clip(CircleShape).background(color))
}

@Composable
private fun Slots(result: VerdictResult, parties: PartyLabels) {
    val s = LocalStrings.current
    Column(Modifier.padding(top = 4.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
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

/** What each side stands on (their bedrock), then the claims that got them there. */
@Composable
private fun SidesSection(result: VerdictResult, parties: PartyLabels) {
    val s = LocalStrings.current
    val map = result.argumentMap
    val claims = map.sideA.map { "a" to it } + map.sideB.map { "b" to it }
    if (map.bedrockA.isEmpty() && map.bedrockB.isEmpty() && claims.isEmpty()) return
    DetailSection(s.appVerdictSides) {
        if (map.bedrockA.isNotEmpty() || map.bedrockB.isNotEmpty()) {
            Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                BedrockTile(parties.nameA, map.bedrockA, isA = true, Modifier.weight(1f))
                BedrockTile(parties.nameB, map.bedrockB, isA = false, Modifier.weight(1f))
            }
        }
        if (claims.isNotEmpty()) {
            Column(Modifier.padding(top = 4.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(s.appVerdictClaims, style = JudgeType.footnote.copy(fontSize = 12.sp, fontWeight = FontWeight.SemiBold))
                claims.forEach { (party, claim) -> ClaimLine(party == "a", claim, s) }
            }
        }
    }
}

@Composable
private fun BedrockTile(name: String, text: String, isA: Boolean, modifier: Modifier) {
    Column(
        modifier
            .fillMaxHeight()
            .clip(JudgeShapes.branch)
            .background(if (isA) Palette.terraTint else Palette.sageTint)
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text(
            name.uppercaseForUi(),
            style = JudgeType.micro.copy(color = if (isA) Palette.terraInk else Palette.sageInk, letterSpacing = 0.08.em),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Text(text, style = JudgeType.body.copy(fontSize = 14.sp, lineHeight = (14 * 1.4).sp))
    }
}

/** "A · fact" and the claim. */
@Composable
private fun ClaimLine(isA: Boolean, claim: Claim, s: Strings) {
    val kind = s.text("kind.${claim.claimKind.raw}")
    val tag = if (kind != null) "${if (isA) "A" else "B"} · $kind" else if (isA) "A" else "B"
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Top) {
        Text(
            tag,
            style = JudgeType.small.copy(fontSize = 11.sp, fontWeight = FontWeight.Bold, color = if (isA) Palette.terraInk else Palette.sageInk),
            maxLines = 1,
            modifier = Modifier
                .padding(top = 2.dp)
                .clip(JudgeShapes.chip)
                .background(if (isA) Palette.terraTint else Palette.sageTint)
                .padding(horizontal = 7.dp, vertical = 2.dp),
        )
        Text(claim.claim, style = JudgeType.body.copy(fontSize = 14.sp, lineHeight = (14 * 1.4).sp))
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
        cornerRadius = CornerRadius(16.dp.toPx()),
        style = Stroke(width = stroke, pathEffect = PathEffect.dashPathEffect(floatArrayOf(6.dp.toPx(), 4.dp.toPx()))),
    )
}

/** The votes line under the details, with the panel and evidence notes. */
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
    Text(
        lines.joinToString("\n"),
        style = JudgeType.footnote.copy(fontSize = 13.sp),
        textAlign = TextAlign.Center,
        modifier = Modifier.fillMaxWidth().padding(horizontal = 4.dp),
    )
}

private fun voteName(run: String, parties: PartyLabels, s: Strings): String = when (run) {
    "side_a" -> parties.nameA
    "side_b" -> parties.nameB
    "split" -> s.voteSplit
    "conditional" -> s.voteConditional
    "dissolved" -> s.voteDissolved
    else -> run
}

@Composable
private fun FactsSection(facts: List<String>) {
    val s = LocalStrings.current
    DetailSection(s.factsTitle) {
        facts.forEach { f ->
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Box(
                    Modifier.padding(top = 2.dp).size(18.dp).clip(CircleShape).background(Palette.sageInk),
                    contentAlignment = Alignment.Center,
                ) { TintedIcon(JudgeIcons.factCheck, 10) }
                Text(f, style = JudgeType.body.copy(fontSize = 14.sp, lineHeight = (14 * 1.45).sp))
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
    DetailSection(s.factcheckTitle, trailing = { PremiumBadge() }) {
        if (claims.isEmpty()) {
            val none = if (dispute == DisputeType.FACTUAL || dispute == DisputeType.MIXED) s.factcheckNoneFactual else s.factcheckNone
            Text(if (check.status == "unavailable") s.factcheckUnavailable else none, style = JudgeType.slotText)
        } else {
            Text(s.factcheckLead, style = JudgeType.slotText)
            claims.forEach { c ->
                Column(Modifier.fillMaxWidth().padding(top = 6.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(c.claim, style = JudgeType.body.copy(fontSize = 14.sp, lineHeight = (14 * 1.45).sp))
                    s.text("factcheck.status.${c.status}")?.let { FactStatusChip(c.status, it) }
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

/** Status with its glyph, so the status never relies on colour alone. */
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

@Composable
private fun WouldChange(items: List<String>) {
    val list = items.filter { it.isNotBlank() }.take(MAX_WOULD_CHANGE)
    if (list.isEmpty()) return
    val s = LocalStrings.current
    DetailSection(s.twoSidedWouldChange) {
        if (list.size == 1) {
            Text(list.single(), style = SectionText)
        } else {
            list.forEach { item ->
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("•", style = SectionText.copy(color = Palette.ink2))
                    Text(item, style = SectionText)
                }
            }
        }
    }
}

/** Agreed and disputed facts of a two-sided verdict (TwoSidedFacts). */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun TwoSidedFacts(result: VerdictResult, parties: PartyLabels) {
    val s = LocalStrings.current
    val agreed = result.agreedFacts.orEmpty().filter { it.isNotBlank() }.take(MAX_AGREED)
    val disputed = result.disputedFacts.orEmpty().take(MAX_DISPUTED)
    // At most one decisive marker, as the server promises.
    val decisiveAt = disputed.indexOfFirst { it.decisive }
    if (agreed.isNotEmpty()) {
        DetailSection(s.twoSidedAgreed) {
            agreed.forEach { fact ->
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Row(Modifier.padding(top = 6.dp).clearAndSetSemantics { }, horizontalArrangement = Arrangement.spacedBy((-3).dp)) {
                        Dot(Palette.terra, 10)
                        Dot(Palette.sageStrong, 10)
                    }
                    Text(fact, style = JudgeType.body.copy(fontSize = 14.sp, lineHeight = (14 * 1.45).sp))
                }
            }
        }
    }
    if (disputed.isNotEmpty()) {
        DetailSection(s.twoSidedDisputed) {
            disputed.forEachIndexed { i, d ->
                val decisive = i == decisiveAt
                Column(
                    Modifier
                        .fillMaxWidth()
                        .clip(JudgeShapes.branch)
                        .background(Palette.ivory)
                        .then(if (decisive) Modifier.dashedBorder(Palette.ink.copy(alpha = 0.4f)) else Modifier)
                        .padding(horizontal = 12.dp, vertical = 10.dp),
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
                    PartyClaim(parties.nameA, d.partyA, Palette.terra)
                    PartyClaim(parties.nameB, d.partyB, Palette.sageStrong)
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
private fun PartyClaim(name: String, claim: String, rule: Color) {
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
 * happened to the verdict, who added context and the summary (or a generic
 * line). The card below carries the new confidence. "Stands" stays neutral:
 * a green tick would read as "you won".
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun AppealOutcomeBanner(appeal: AppealInfo, byName: String, bySelf: Boolean, modifier: Modifier = Modifier) {
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
        }
        Text(appeal.summary.trim().ifEmpty { generic }, style = JudgeType.body.copy(fontSize = 15.sp, lineHeight = 22.sp, color = Palette.ink))
    }
}
