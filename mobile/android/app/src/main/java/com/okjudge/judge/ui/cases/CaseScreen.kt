package com.okjudge.judge.ui.cases

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
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
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.okjudge.judge.core.cases.AppealArea
import com.okjudge.judge.core.cases.CaseLogic
import com.okjudge.judge.core.display.ContentLang
import com.okjudge.judge.core.display.Errors
import com.okjudge.judge.core.display.PartyNames
import com.okjudge.judge.core.display.UiError
import com.okjudge.judge.core.evidence.ImageSource
import com.okjudge.judge.core.model.CaseAppealView
import com.okjudge.judge.core.model.CaseEvidenceView
import com.okjudge.judge.core.model.CaseSideView
import com.okjudge.judge.core.model.CaseStatus
import com.okjudge.judge.core.model.CaseVerdictView
import com.okjudge.judge.core.model.CaseView
import com.okjudge.judge.core.model.NameMapping
import com.okjudge.judge.i18n.LocalLang
import com.okjudge.judge.i18n.LocalStrings
import com.okjudge.judge.i18n.Strings
import com.okjudge.judge.ui.components.GhostButton
import com.okjudge.judge.ui.components.JudgeIcons
import com.okjudge.judge.ui.components.Kicker
import com.okjudge.judge.ui.components.PrimaryButton
import com.okjudge.judge.ui.components.TextAction
import com.okjudge.judge.ui.components.TintedIcon
import com.okjudge.judge.ui.components.TopBar
import com.okjudge.judge.ui.judging.JudgingScreen
import com.okjudge.judge.ui.premium.EvidencePicker
import com.okjudge.judge.ui.premium.rememberEvidencePicker
import com.okjudge.judge.ui.theme.JudgeShapes
import com.okjudge.judge.ui.theme.JudgeType
import com.okjudge.judge.ui.theme.Palette
import com.okjudge.judge.ui.verdict.CardActions
import com.okjudge.judge.ui.verdict.TranslationStatus
import com.okjudge.judge.ui.verdict.TranslationView
import com.okjudge.judge.ui.verdict.VerdictContent
import kotlinx.coroutines.delay

object CaseTags {
    const val STATUS = "case.status"
    const val MESSAGE = "case.message"
    const val INVITE_URL = "case.inviteUrl"
    const val COPY = "case.copy"
    const val SHARE = "case.share"
    const val RESET = "case.reset"
    const val JUDGE_NOW = "case.judgeNow"
    const val RETRY = "case.retry"
    const val START_OVER = "case.startOver"
    const val REMOVE = "case.remove"
    const val CONFIRM = "case.confirm"
    const val ERROR = "case.error"
    const val BANNER = "case.banner"
    const val APPEAL_TEXT = "case.appealText"
    const val APPEAL_SUBMIT = "case.appealSubmit"
    const val APPEAL_NOTE = "case.appealNote"
    const val APPEAL_SIGN_IN = "case.appealSignIn"
    const val APPEAL_PRICING = "case.appealPricing"
    const val NAMES_SWITCH = "case.namesSwitch"
    const val NAME_FIELD = "case.nameField"
    const val NAME_SAVE = "case.nameSave"
    const val NAMES_NOTE = "case.namesNote"
    const val VERDICT = "case.verdict"
    const val HISTORY = "case.history"
}

/** Everything the case screen can ask for; the route wires these to [CaseViewModel] and the app shell. */
data class CaseActions(
    val onBack: (() -> Unit)? = null,
    val onToggleLang: () -> Unit = {},
    val onReload: () -> Unit = {},
    val onSignIn: () -> Unit = {},
    val onPricing: () -> Unit = {},
    val onStartOver: () -> Unit = {},
    val onJudgeNow: () -> Unit = {},
    val onRetry: () -> Unit = {},
    val onResetInvite: () -> Unit = {},
    val onRemove: () -> Unit = {},
    val onCopyInvite: (String) -> Unit = {},
    val onShareInvite: (String) -> Unit = {},
    val onOverlayFinished: () -> Unit = {},
    val onAppealText: (String) -> Unit = {},
    val onAddAppealEvidence: (List<ImageSource>) -> Unit = {},
    val onRemoveAppealEvidence: (String) -> Unit = {},
    val onSubmitAppeal: () -> Unit = {},
    val onTypedName: (String) -> Unit = {},
    val onSaveName: () -> Unit = {},
    val onNamesVisible: (Boolean) -> Unit = {},
    val onShareVerdict: ((id: String, headline: String) -> Unit)? = null,
    val onCopyVerdict: ((id: String) -> Unit)? = null,
)

private enum class Confirm { JUDGE_NOW, RESET, REMOVE }

/**
 * The owner's case screen (components/case/CaseScreen.tsx), stateless: the
 * status of the case decides the body (waiting with the invite link,
 * judging, the verdict with appeals and history, failed, expired), with
 * the removed banner, the owner's names, the accounts as the judges read
 * them and removal below.
 */
@Composable
fun CaseScreen(
    state: CaseUiState,
    evidenceOn: Boolean,
    actions: CaseActions,
    reducedMotion: Boolean,
    modifier: Modifier = Modifier,
) {
    val s = LocalStrings.current
    val view = state.view
    var confirm by rememberSaveable { mutableStateOf<Confirm?>(null) }
    val kicker = if (view?.oneSided == true) s.caseKickerOneSided else s.caseKicker

    Column(modifier.fillMaxSize()) {
        TopBar(onBack = actions.onBack, onToggleLang = actions.onToggleLang, backLabel = s.appHistoryTitle)
        if (view == null) {
            Column(Modifier.fillMaxSize().padding(horizontal = 20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Header(kicker, null)
                val message = when (state.status) {
                    CaseLoadStatus.LOADING -> s.caseLoading
                    CaseLoadStatus.MISSING -> s.caseNotFound
                    CaseLoadStatus.SIGNIN -> s.caseSignIn
                    else -> s.caseLoadFailed
                }
                Text(
                    message,
                    style = JudgeType.body.copy(color = if (state.status == CaseLoadStatus.ERROR) Palette.danger else Palette.ink2),
                    modifier = Modifier.testTag(CaseTags.MESSAGE).semantics { liveRegion = LiveRegionMode.Polite },
                )
                when (state.status) {
                    CaseLoadStatus.SIGNIN -> PrimaryButton(s.navSignIn, true, actions.onSignIn, Modifier.fillMaxWidth())
                    CaseLoadStatus.ERROR -> GhostButton(s.appRetry, null, actions.onReload)
                    else -> Unit
                }
            }
            return@Column
        }

        val overlay = state.overlay
        if (overlay != null) {
            val current = view.current
            Column(Modifier.fillMaxSize().padding(horizontal = 20.dp)) {
                Header(kicker, view.status)
                Text(
                    if (view.respondentAnswered) s.caseAnswered else s.caseJudgingAlone,
                    style = JudgeType.body.copy(color = Palette.sageInk),
                    modifier = Modifier.padding(top = 12.dp).semantics { liveRegion = LiveRegionMode.Polite },
                )
                JudgingScreen(
                    done = overlay.done,
                    result = if (overlay.done) current?.result else null,
                    startedAt = remember { System.currentTimeMillis() },
                    reducedMotion = reducedMotion,
                    onFinished = actions.onOverlayFinished,
                    onCancel = { actions.onBack?.invoke() },
                    premium = view.premium,
                    showCancel = false,
                    modifier = Modifier.weight(1f),
                )
            }
            return@Column
        }

        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).imePadding().padding(horizontal = 16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Column(
                Modifier.widthIn(max = 640.dp).fillMaxWidth().padding(top = 4.dp, bottom = 40.dp),
                verticalArrangement = Arrangement.spacedBy(18.dp),
            ) {
                Header(kicker, view.status)
                if (view.removed != null) {
                    Banner(if (state.removedNow) s.caseRemoved else s.caseRemovedBanner)
                }
                Body(state, view, evidenceOn, actions) { confirm = it }
                if (view.verdicts.isNotEmpty() && view.removed == null) NamesTools(state, view, actions)
                val bothRead = view.sides.size > 1
                AccountsRead(
                    title = if (bothRead) s.caseAccounts else s.caseYourSide,
                    sides = if (bothRead) view.sides else view.sides.filter { it.party == view.yourParty },
                    appeals = if (bothRead || view.oneSided) view.appeals else emptyList(),
                    yourParty = view.yourParty,
                )
                val canRemove = view.status != CaseStatus.JUDGING && !view.appealJudging && view.removed == null
                if (canRemove) {
                    TextAction(s.caseRemove, { confirm = Confirm.REMOVE }, Modifier.testTag(CaseTags.REMOVE), color = Palette.danger)
                }
            }
        }
    }

    val shown = confirm
    if (shown != null && view != null) {
        val expired = view.status == CaseStatus.EXPIRED
        val (title, text, yes) = when (shown) {
            // Expired: the held unit went back, so a premium case spends a new one. A free case spends nothing.
            Confirm.JUDGE_NOW -> Triple(
                s.caseJudgeNow,
                when {
                    !expired -> s.caseJudgeNowConfirm
                    view.premium -> s.caseJudgeExpiredConfirm
                    else -> s.caseJudgeExpiredConfirmFree
                },
                if (expired && view.premium) s.caseJudgeExpiredYes else s.caseJudgeNowYes,
            )
            Confirm.RESET -> Triple(s.caseInviteReset, s.caseInviteResetConfirm, s.caseInviteResetYes)
            Confirm.REMOVE -> Triple(s.caseRemove, s.caseRemoveConfirm, s.caseRemoveYes)
        }
        AlertDialog(
            onDismissRequest = { confirm = null },
            title = { Text(title, style = JudgeType.sectionTitle) },
            text = { Text(text, style = JudgeType.body) },
            confirmButton = {
                TextButton(
                    onClick = {
                        confirm = null
                        when (shown) {
                            Confirm.JUDGE_NOW -> actions.onJudgeNow()
                            Confirm.RESET -> actions.onResetInvite()
                            Confirm.REMOVE -> actions.onRemove()
                        }
                    },
                    modifier = Modifier.testTag(CaseTags.CONFIRM),
                ) { Text(yes, color = if (shown == Confirm.REMOVE) Palette.danger else Palette.ink) }
            },
            dismissButton = { TextButton(onClick = { confirm = null }) { Text(s.caseCancel, color = Palette.ink) } },
            containerColor = Palette.paper,
        )
    }
}

@Composable
private fun Header(kicker: String, status: CaseStatus?) {
    val s = LocalStrings.current
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Kicker(kicker)
        Text(
            s.caseTitle,
            style = JudgeType.sectionTitle.copy(fontSize = JudgeType.sectionTitle.fontSize * 1.3f),
            modifier = Modifier.semantics { heading() },
        )
        if (status != null) StatusChip(status, Modifier.testTag(CaseTags.STATUS))
    }
}

@Composable
fun StatusChip(status: CaseStatus, modifier: Modifier = Modifier) {
    val s = LocalStrings.current
    val dot = when (status) {
        CaseStatus.AWAITING -> Palette.terra
        CaseStatus.JUDGING -> Palette.stone
        CaseStatus.JUDGED -> Palette.sageStrong
        CaseStatus.FAILED -> Palette.danger
        CaseStatus.EXPIRED -> Palette.muted
    }
    Row(
        modifier
            .clip(JudgeShapes.chip)
            .background(Palette.paper)
            .border(1.dp, Palette.line2, JudgeShapes.chip)
            .semantics(mergeDescendants = true) {}
            .padding(horizontal = 10.dp, vertical = 5.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Box(Modifier.size(7.dp).clip(CircleShape).background(dot))
        Text(s.text(status.key) ?: status.raw, style = JudgeType.small.copy(fontSize = 12.sp))
    }
}

@Composable
private fun Banner(text: String) {
    Text(
        text,
        style = JudgeType.body.copy(fontSize = 15.sp, color = Palette.ink),
        modifier = Modifier
            .fillMaxWidth()
            .clip(JudgeShapes.field)
            .background(Palette.terraTint)
            .border(1.dp, Palette.terra.copy(alpha = 0.4f), JudgeShapes.field)
            .semantics { liveRegion = LiveRegionMode.Polite }
            .testTag(CaseTags.BANNER)
            .padding(horizontal = 16.dp, vertical = 12.dp),
    )
}

@Composable
private fun Note(text: String, modifier: Modifier = Modifier, color: Color = Palette.ink2) {
    Text(text, style = JudgeType.body.copy(fontSize = 15.sp, lineHeight = 22.sp, color = color), modifier = modifier)
}

@Composable
private fun ErrorLine(error: UiError?) {
    if (error == null) return
    val s = LocalStrings.current
    val lang = LocalLang.current
    Text(
        Errors.message(error, s, lang),
        style = JudgeType.body.copy(fontSize = 15.sp, color = Palette.danger),
        modifier = Modifier.semantics { liveRegion = LiveRegionMode.Assertive }.testTag(CaseTags.ERROR),
    )
}

@Composable
private fun Card(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier
            .fillMaxWidth()
            .clip(JudgeShapes.block)
            .background(Palette.paper)
            .border(1.dp, Palette.line, JudgeShapes.block)
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
        content = content,
    )
}

@Composable
private fun Body(state: CaseUiState, view: CaseView, evidenceOn: Boolean, actions: CaseActions, ask: (Confirm) -> Unit) {
    val s = LocalStrings.current
    val lang = LocalLang.current
    when (view.status) {
        CaseStatus.AWAITING -> {
            Note(s.caseNotYet)
            Card {
                view.inviteUrl?.let { url -> InviteLink(url, view.expiresAt, state, actions) { ask(Confirm.RESET) } }
                if (view.premium) {
                    Note(Errors.formatDate(lang, view.expiresAt)?.let { s.caseHeld(it) } ?: s.caseHeldSoon, color = Palette.muted)
                }
            }
            ErrorLine(state.actionError)
            if (view.canJudgeNow) {
                GhostButton(s.caseJudgeNow, null, { if (!state.busy) ask(Confirm.JUDGE_NOW) }, Modifier.testTag(CaseTags.JUDGE_NOW))
            }
        }
        CaseStatus.JUDGING -> {
            // Normally covered by the judging animation; shown after it was dismissed.
            Note(if (view.respondentAnswered) s.caseAnswered else s.caseJudgingAlone, color = Palette.sageInk)
        }
        CaseStatus.JUDGED -> {
            val current = view.current
            if (current != null) {
                if (view.oneSided) Note(s.caseOneSided)
                CaseVerdict(current, state.names, linked = view.removed == null, actions, Modifier.testTag(CaseTags.VERDICT))
                AppealSection(state, view, evidenceOn, actions)
                VerdictHistory(view, state.names)
            }
        }
        CaseStatus.FAILED -> {
            Banner(
                when {
                    view.lastError == "quota" -> s.errorQuota
                    view.premium -> s.caseFailedBody
                    else -> s.caseFailedBodyFree
                },
            )
            ErrorLine(state.actionError)
            PrimaryButton(s.caseRetry, !state.busy, actions.onRetry, Modifier.fillMaxWidth().testTag(CaseTags.RETRY))
        }
        CaseStatus.EXPIRED -> {
            Banner(if (view.premium) s.caseExpiredBody else s.caseExpiredBodyFree)
            ErrorLine(state.actionError)
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                if (view.canJudgeNow) {
                    PrimaryButton(s.caseJudgeNow, !state.busy, { ask(Confirm.JUDGE_NOW) }, Modifier.testTag(CaseTags.JUDGE_NOW))
                }
                GhostButton(s.caseStartOver, null, actions.onStartOver, Modifier.testTag(CaseTags.START_OVER))
            }
        }
    }
}

@Composable
private fun InviteLink(url: String, expiresAt: String, state: CaseUiState, actions: CaseActions, onReset: () -> Unit) {
    val s = LocalStrings.current
    val lang = LocalLang.current
    var copied by remember { mutableStateOf(false) }
    LaunchedEffect(copied) {
        if (copied) {
            delay(2000)
            copied = false
        }
    }
    Text(s.caseInviteLabel, style = JudgeType.slotTitle)
    SelectionContainer {
        Text(
            url,
            style = JudgeType.body.copy(fontFamily = FontFamily.Monospace, fontSize = 13.sp, color = Palette.ink),
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(12.dp))
                .background(Palette.ivory)
                .border(1.dp, Palette.line2, RoundedCornerShape(12.dp))
                .testTag(CaseTags.INVITE_URL)
                .padding(12.dp),
        )
    }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        GhostButton(
            if (copied) s.caseInviteCopied else s.caseInviteCopy,
            remember(copied) { if (copied) JudgeIcons.check(Palette.sageInk, 2f) else JudgeIcons.link(Palette.ink) },
            {
                actions.onCopyInvite(url)
                copied = true
            },
            Modifier.testTag(CaseTags.COPY).semantics { liveRegion = LiveRegionMode.Polite },
        )
        GhostButton(s.caseInviteShare, remember { JudgeIcons.share(Palette.ink) }, { actions.onShareInvite(url) }, Modifier.testTag(CaseTags.SHARE))
    }
    Note(Errors.formatDate(lang, expiresAt)?.let { s.caseInviteExpires(it) } ?: s.caseInviteExpiresSoon, color = Palette.muted)
    TextAction(s.caseInviteReset, { if (!state.busy) onReset() }, Modifier.testTag(CaseTags.RESET), color = Palette.ink2)
    if (state.resetDone) {
        Note(s.caseInviteResetDone, Modifier.semantics { liveRegion = LiveRegionMode.Polite }, color = Palette.sageInk)
    }
}

/** A case verdict with the owner's names restored; share and copy only while the case's links are open. */
@Composable
private fun CaseVerdict(verdict: CaseVerdictView, names: List<NameMapping>, linked: Boolean, actions: CaseActions, modifier: Modifier = Modifier) {
    val s = LocalStrings.current
    val result = verdict.result
    val selfLang = ContentLang.verdictLang(result)
    val view = remember(result, names) { TranslationView(result, TranslationStatus.ORIGINAL, selfLang).personalized(names, selfLang) }
    var copied by remember { mutableStateOf(false) }
    LaunchedEffect(copied) {
        if (copied) {
            delay(2000)
            copied = false
        }
    }
    VerdictContent(
        view = view,
        parties = PartyNames.partyNames(names, selfLang, s),
        restoredNames = PartyNames.restoredNames(names, selfLang),
        actions = CardActions(
            onShare = if (linked) actions.onShareVerdict?.let { share -> { share(verdict.id, result.headline) } } else null,
            onCopy = if (linked) actions.onCopyVerdict?.let { copy -> { copy(verdict.id); copied = true } } else null,
            copied = copied,
        ),
        modifier = modifier,
    )
}

/** Earlier verdicts of the case, newest first, each collapsed (VerdictHistory). */
@Composable
private fun VerdictHistory(view: CaseView, names: List<NameMapping>) {
    val earlier = view.verdicts.dropLast(1).reversed()
    if (earlier.isEmpty()) return
    val s = LocalStrings.current
    val lang = LocalLang.current
    Column(Modifier.testTag(CaseTags.HISTORY), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(s.appealHistory, style = JudgeType.sectionTitle, modifier = Modifier.semantics { heading() })
        earlier.forEach { v ->
            var open by rememberSaveable(v.id) { mutableStateOf(false) }
            Row(
                Modifier
                    .fillMaxWidth()
                    .clip(JudgeShapes.field)
                    .background(Palette.paper)
                    .border(1.dp, Palette.line, JudgeShapes.field)
                    .clickable(role = Role.Button) { open = !open }
                    .padding(horizontal = 16.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text((if (open) "▾ " else "▸ ") + s.appealPrevious, style = JudgeType.slotTitle, modifier = Modifier.weight(1f))
                Text(Errors.formatDate(lang, v.createdAt) ?: "", style = JudgeType.footnote)
            }
            if (open) CaseVerdict(v, names, linked = false, actions = CaseActions())
        }
    }
}

@Composable
private fun AppealSection(state: CaseUiState, view: CaseView, evidenceOn: Boolean, actions: CaseActions) {
    val s = LocalStrings.current
    when (val area = CaseLogic.appealArea(view)) {
        AppealArea.None -> Unit
        AppealArea.Judging -> Row(
            Modifier.semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Polite }.testTag(CaseTags.APPEAL_NOTE),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            CircularProgressIndicator(Modifier.size(14.dp), color = Palette.sageInk, strokeWidth = 1.5.dp)
            Note(s.appealJudging, color = Palette.sageInk)
        }
        AppealArea.Busy, AppealArea.Used ->
            Note(if (area == AppealArea.Busy) s.appealBusy else s.appealUsed, Modifier.testTag(CaseTags.APPEAL_NOTE))
        is AppealArea.Upsell, is AppealArea.Blocked -> Card {
            AppealTitle(spark = true)
            val text = when (area) {
                is AppealArea.Upsell -> s.appealUpsell
                is AppealArea.Blocked -> when (area.reason) {
                    // The web reads fair use without a date here (tWithDate with null).
                    "fair_use" -> s.errorFairUseSoon
                    "no_credits" -> s.errorNoCredits
                    else -> s.errorPremiumRequired
                }
                else -> ""
            }
            Note(text, Modifier.testTag(CaseTags.APPEAL_NOTE))
            if (area is AppealArea.Upsell && area.signIn) {
                PrimaryButton(s.appealSignIn, true, actions.onSignIn, Modifier.fillMaxWidth().testTag(CaseTags.APPEAL_SIGN_IN))
            } else {
                GhostButton(s.tierGetPremium, null, actions.onPricing, Modifier.testTag(CaseTags.APPEAL_PRICING))
            }
        }
        is AppealArea.Form -> Card {
            AppealTitle(spark = false)
            Note(s.appealLead)
            area.failed?.let { Banner(if (it == "refused") s.appealRefused else s.appealFailed) }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(s.appealLabel, style = JudgeType.slotTitle, modifier = Modifier.weight(1f))
                Text("${state.appealText.length} / ${CaseLogic.MAX_APPEAL_CHARS}", style = JudgeType.footnote)
            }
            Box(
                Modifier
                    .fillMaxWidth()
                    .heightIn(min = 110.dp)
                    .clip(JudgeShapes.field)
                    .background(Palette.ivory)
                    .border(1.dp, Palette.line2, JudgeShapes.field)
                    .padding(14.dp),
            ) {
                BasicTextField(
                    value = state.appealText,
                    onValueChange = actions.onAppealText,
                    readOnly = state.appealSending,
                    textStyle = JudgeType.body,
                    cursorBrush = SolidColor(Palette.terraInk),
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
                    modifier = Modifier.fillMaxWidth().heightIn(min = 82.dp).testTag(CaseTags.APPEAL_TEXT),
                    decorationBox = { inner ->
                        if (state.appealText.isEmpty()) Text(s.appealPlaceholder, style = JudgeType.body.copy(color = Palette.placeholder))
                        inner()
                    },
                )
            }
            // The server refuses evidence on a free case's appeal.
            if (evidenceOn && view.premium) {
                val pick = rememberEvidencePicker(state.appealEvidence.room, actions.onAddAppealEvidence)
                EvidencePicker(state.appealEvidence, disabled = state.appealSending, onAdd = pick, onRemove = actions.onRemoveAppealEvidence)
            }
            ErrorLine(state.appealError)
            PrimaryButton(
                if (state.appealSending) s.appealSending else s.appealSubmit,
                state.appealCanSubmit,
                actions.onSubmitAppeal,
                Modifier.fillMaxWidth().testTag(CaseTags.APPEAL_SUBMIT),
            )
        }
    }
}

@Composable
private fun AppealTitle(spark: Boolean) {
    val s = LocalStrings.current
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        if (spark) TintedIcon(remember { JudgeIcons.spark(Palette.terra) }, 13)
        Text(s.appealTitle, style = JudgeType.sectionTitle, modifier = Modifier.semantics { heading() })
    }
}

/** The owner's name on the share pages and the names switch (CaseNames). */
@Composable
private fun NamesTools(state: CaseUiState, view: CaseView, actions: CaseActions) {
    val s = LocalStrings.current
    val lang = LocalLang.current
    Card {
        if (view.role == "owner") {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(s.namesShow, style = JudgeType.body, modifier = Modifier.weight(1f))
                Switch(
                    checked = view.display.namesVisible,
                    onCheckedChange = actions.onNamesVisible,
                    enabled = !state.namesBusy,
                    colors = SwitchDefaults.colors(checkedTrackColor = Palette.ink, checkedThumbColor = Palette.ivory),
                    modifier = Modifier.testTag(CaseTags.NAMES_SWITCH),
                )
            }
        }
        Text(s.caseDisplayName, style = JudgeType.slotTitle)
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            val mine = if (view.yourParty == "a") view.display.a else view.display.b
            Box(
                Modifier
                    .weight(1f)
                    .clip(JudgeShapes.field)
                    .background(Palette.ivory)
                    .border(1.dp, Palette.line2, JudgeShapes.field)
                    .padding(horizontal = 14.dp, vertical = 12.dp),
            ) {
                BasicTextField(
                    value = state.typedName ?: mine ?: "",
                    onValueChange = actions.onTypedName,
                    enabled = !state.namesBusy,
                    singleLine = true,
                    textStyle = JudgeType.body,
                    cursorBrush = SolidColor(Palette.terraInk),
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Words),
                    modifier = Modifier.fillMaxWidth().testTag(CaseTags.NAME_FIELD),
                )
            }
            GhostButton(s.caseDisplaySave, null, { if (!state.namesBusy) actions.onSaveName() }, Modifier.testTag(CaseTags.NAME_SAVE))
        }
        val error = state.namesError
        val (text, color) = when {
            error == NamesError.Invalid -> s.namesInvalid to Palette.danger
            error == NamesError.Failed -> s.namesFailed to Palette.danger
            error is NamesError.Api -> Errors.message(error.error, s, lang) to Palette.danger
            state.namesSaved -> s.namesSaved to Palette.sageInk
            else -> null to Palette.ink
        }
        if (text != null) {
            Text(
                text,
                style = JudgeType.slotText.copy(color = color),
                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite }.testTag(CaseTags.NAMES_NOTE),
            )
        }
    }
}

/**
 * The accounts exactly as the judges read them (AccountsRead): anonymized
 * text and image transcripts, labels in the text's own language, the
 * viewer's own side marked as theirs. Names are deliberately not restored.
 */
@Composable
private fun AccountsRead(title: String, sides: List<CaseSideView>, appeals: List<CaseAppealView>, yourParty: String) {
    if (sides.isEmpty()) return
    val s = LocalStrings.current
    val label = { p: String -> if (p == "a") s.partyA else s.partyB }
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(title, style = JudgeType.sectionTitle, modifier = Modifier.semantics { heading() })
        sides.sortedBy { it.party }.forEach { side ->
            Account(
                head = if (side.party == yourParty) s.caseAccountYou(label(side.party)) else if (side.party == "a") s.caseAccountA else s.caseAccountB,
                isA = side.party == "a",
                text = if (side.removed) null else side.text,
                evidence = if (side.removed) emptyList() else side.evidence,
                s = s,
            )
        }
        appeals.filter { it.status != "failed" && it.text.isNotBlank() }.forEach { a ->
            Account(
                head = if (a.party == yourParty) s.caseContextYou(label(a.party)) else if (a.party == "a") s.caseContextA else s.caseContextB,
                isA = a.party == "a",
                text = a.text,
                evidence = a.evidence,
                s = s,
            )
        }
    }
}

@Composable
private fun Account(head: String, isA: Boolean, text: String?, evidence: List<CaseEvidenceView>, s: Strings) {
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(if (isA) Palette.terraTint.copy(alpha = 0.45f) else Palette.sageTint.copy(alpha = 0.55f))
            .border(1.dp, Palette.line, RoundedCornerShape(16.dp))
            .padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(head, style = JudgeType.micro.copy(color = if (isA) Palette.terraInk else Palette.sageInk))
        if (text == null) {
            Note(s.caseSideRemoved, color = Palette.muted)
        } else {
            Text(CaseLogic.localizeLabelsAuto(text), style = JudgeType.body.copy(fontSize = 15.sp, lineHeight = 22.sp))
            evidence.forEachIndexed { i, ev ->
                var open by rememberSaveable(ev.id) { mutableStateOf(false) }
                Text(
                    (if (open) "▾ " else "▸ ") + s.caseEvidenceItem((i + 1).toString()),
                    style = JudgeType.slotText.copy(color = Palette.ink2, fontWeight = FontWeight.SemiBold),
                    modifier = Modifier.clip(RoundedCornerShape(6.dp)).clickable(role = Role.Button) { open = !open }.padding(vertical = 4.dp),
                )
                if (open) {
                    Text(
                        CaseLogic.localizeLabelsAuto(ev.transcript),
                        style = JudgeType.slotText.copy(color = Palette.ink, fontFamily = FontFamily.Monospace, fontSize = 12.sp),
                        modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(Palette.paper).padding(10.dp),
                    )
                }
            }
        }
    }
}
