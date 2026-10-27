package com.okjudge.judge.ui.verdict

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.okjudge.judge.core.cases.AppealArea
import com.okjudge.judge.core.display.PartyNames
import com.okjudge.judge.i18n.LocalLang
import com.okjudge.judge.i18n.LocalStrings
import com.okjudge.judge.ui.cases.AppealFormActions
import com.okjudge.judge.ui.cases.AppealNote
import com.okjudge.judge.ui.cases.AppealSheet
import com.okjudge.judge.ui.cases.opensSheet
import com.okjudge.judge.ui.components.TopBar
import com.okjudge.judge.ui.judging.rememberReducedMotion
import com.okjudge.judge.ui.theme.JudgeType
import com.okjudge.judge.ui.theme.Palette
import kotlinx.coroutines.delay

/** Share link for a verdict id: `{SHARE_BASE_URL}/v/<id>`. */
fun shareUrl(shareBaseUrl: String, id: String): String = "${shareBaseUrl.trimEnd('/')}/v/$id"

/**
 * The verdict screen, fed by a saved history row (fresh verdicts are saved
 * before the app navigates here, so this works offline and after process
 * death): the ruling, and its details pushed over it. With [appeal] the
 * writer can add context and appeal in a sheet; a round's verdict replaces
 * the saved one and the screen goes back up to its banner.
 */
@Composable
fun VerdictRoute(
    id: String,
    viewModel: VerdictViewModel,
    shareBaseUrl: String,
    onBack: (() -> Unit)?,
    onNew: (() -> Unit)?,
    fromHome: Boolean = false,
    appeal: VerdictAppealViewModel? = null,
    evidenceOn: Boolean = false,
    onSignIn: () -> Unit = {},
    onPricing: () -> Unit = {},
) {
    val lang = LocalLang.current
    LaunchedEffect(lang) { viewModel.onLang(lang) }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val appealState = appeal?.let { it.state.collectAsStateWithLifecycle().value }
    val context = LocalContext.current
    val s = LocalStrings.current
    val scroll = rememberScrollState()
    var details by rememberSaveable(id) { mutableStateOf(false) }
    var copied by remember { mutableStateOf(false) }
    LaunchedEffect(copied) {
        if (copied) {
            delay(2000)
            copied = false
        }
    }
    LaunchedEffect(appealState?.finished) {
        if (appealState?.finished == true) {
            details = false
            scroll.animateScrollTo(0)
        }
    }
    BackHandler(enabled = details) { details = false }
    val url = shareUrl(shareBaseUrl, id)

    Column(Modifier.fillMaxSize()) {
        if (details) {
            TopBar(onBack = { details = false }, onNew = onNew, backLabel = s.appVerdictBack, backText = s.appVerdictBack)
        } else {
            TopBar(onBack = onBack, onNew = onNew, backLabel = if (fromHome) s.homeKicker else s.appHistoryTitle)
        }
        val saved = state.saved
        val view = state.view
        if (saved == null || view == null) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                if (state.loading) {
                    CircularProgressIndicator(color = Palette.ink)
                } else {
                    Text(s.notFoundBody, style = JudgeType.body, modifier = Modifier.padding(24.dp))
                }
            }
            return@Column
        }
        val selfLang = saved.lang
        val parties = PartyNames.partyNames(saved.nameMap, selfLang, s)
        val shown = remember(view, saved.nameMap, selfLang) { view.personalized(saved.nameMap, selfLang) }
        val area = appealState?.area ?: AppealArea.None
        val actions = CardActions(
            onShare = { shareVerdict(context, s.appShareTitle, view.result.headline, s.shareText, url) },
            onCopy = {
                copyLink(context, url)
                copied = true
            },
            copied = copied,
            onAddContext = if (appeal != null && appealState?.offered == true) appeal::open else null,
        )
        val width = Modifier.widthIn(max = 640.dp).fillMaxWidth()
        Column(
            Modifier
                .weight(1f)
                .fillMaxWidth()
                .verticalScroll(scroll)
                .padding(horizontal = 16.dp, vertical = 4.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            if (details) {
                val restored = remember(saved.nameMap, selfLang) { PartyNames.restoredNames(saved.nameMap, selfLang) }
                VerdictDetails(shown, parties, restored, actions, width.padding(bottom = 32.dp))
            } else {
                RulingSummary(shown, parties, actions, onDetails = { details = true }, reducedMotion = rememberReducedMotion(), modifier = width)
                // The sheet takes the form; re-judging, or why no more context fits, shows here.
                if (appealState?.panel == true) AppealNote(area, width.padding(top = 16.dp))
                Spacer(Modifier.height(32.dp))
            }
        }
        if (appeal != null && appealState != null && appealState.open && area.opensSheet) {
            AppealSheet(
                area = area,
                draft = appealState.draft,
                evidenceOn = evidenceOn,
                cost = s.appAppealCost(appealState.left.toString()),
                actions = AppealFormActions(
                    onText = appeal::onText,
                    onAddEvidence = appeal::onAddEvidence,
                    onRemoveEvidence = appeal::onRemoveEvidence,
                    onSubmit = appeal::submit,
                    onSignIn = onSignIn,
                    onPricing = onPricing,
                ),
                onClose = appeal::close,
            )
        }
    }
}

/** Native share sheet with the web's share text and the anonymized headline as subject. */
fun shareVerdict(context: Context, chooserTitle: String, headline: String, shareText: String, url: String) {
    val send = Intent(Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(Intent.EXTRA_SUBJECT, headline)
        putExtra(Intent.EXTRA_TITLE, headline)
        putExtra(Intent.EXTRA_TEXT, "$shareText\n$url")
    }
    context.startActivity(Intent.createChooser(send, chooserTitle).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
}

fun copyLink(context: Context, url: String) {
    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    clipboard.setPrimaryClip(ClipData.newPlainText("Judge", url))
}
