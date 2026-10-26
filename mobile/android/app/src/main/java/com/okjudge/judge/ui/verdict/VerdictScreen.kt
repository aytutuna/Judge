package com.okjudge.judge.ui.verdict

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
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
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.okjudge.judge.core.display.PartyNames
import com.okjudge.judge.core.display.VerdictDisplay
import com.okjudge.judge.core.model.VerdictResult
import com.okjudge.judge.i18n.LocalLang
import com.okjudge.judge.i18n.LocalStrings
import com.okjudge.judge.ui.components.ArgumentBubble
import com.okjudge.judge.ui.components.JudgesBadge
import com.okjudge.judge.ui.components.SceneView
import com.okjudge.judge.ui.components.TopBar
import com.okjudge.judge.ui.components.warmShadow
import com.okjudge.judge.ui.judging.rememberReducedMotion
import com.okjudge.judge.ui.theme.JudgeShapes
import com.okjudge.judge.ui.theme.JudgeType
import com.okjudge.judge.ui.theme.Palette
import kotlinx.coroutines.delay

/** Share link for a verdict id: `{SHARE_BASE_URL}/v/<id>`. */
fun shareUrl(shareBaseUrl: String, id: String): String = "${shareBaseUrl.trimEnd('/')}/v/$id"

/**
 * The verdict screen, fed by a saved history row (fresh verdicts are saved
 * before the app navigates here, so this works offline and after process death).
 * A fresh verdict stays in its thread: the argument, the judges' badge and
 * the settled scene above the card; the header's "+" starts the next one.
 */
@Composable
fun VerdictRoute(
    id: String,
    viewModel: VerdictViewModel,
    shareBaseUrl: String,
    onBack: (() -> Unit)?,
    thread: Boolean,
    onNew: (() -> Unit)?,
    argument: String? = null,
    fromHome: Boolean = false,
) {
    val lang = LocalLang.current
    LaunchedEffect(lang) { viewModel.onLang(lang) }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val s = LocalStrings.current
    var copied by remember { mutableStateOf(false) }
    LaunchedEffect(copied) {
        if (copied) {
            delay(2000)
            copied = false
        }
    }
    val url = shareUrl(shareBaseUrl, id)

    Column(Modifier.fillMaxSize()) {
        TopBar(onBack = onBack, onNew = onNew, backLabel = if (fromHome) s.homeKicker else s.appHistoryTitle)
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
        val restored = remember(saved.nameMap, selfLang) { PartyNames.restoredNames(saved.nameMap, selfLang) }
        val shown = remember(view, saved.nameMap, selfLang) { view.personalized(saved.nameMap, selfLang) }
        Column(
            Modifier
                .weight(1f)
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp, vertical = 12.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            if (thread) {
                VerdictThreadHead(
                    argument = argument,
                    result = shown.result,
                    reducedMotion = rememberReducedMotion(),
                    modifier = Modifier.widthIn(max = 640.dp).fillMaxWidth().padding(bottom = 16.dp),
                )
            }
            VerdictContent(
                view = shown,
                parties = parties,
                restoredNames = restored,
                actions = CardActions(
                    onShare = { shareVerdict(context, s.appShareTitle, view.result.headline, s.shareText, url) },
                    onCopy = {
                        copyLink(context, url)
                        copied = true
                    },
                    copied = copied,
                ),
                modifier = Modifier.widthIn(max = 640.dp).fillMaxWidth().padding(bottom = 32.dp),
            )
        }
    }
}

/** The thread above a fresh verdict: what was argued, how far the judges agreed and the settled balance. */
@Composable
fun VerdictThreadHead(argument: String?, result: VerdictResult, reducedMotion: Boolean, modifier: Modifier = Modifier) {
    val s = LocalStrings.current
    Column(modifier, verticalArrangement = Arrangement.spacedBy(16.dp)) {
        if (argument != null) ArgumentBubble(argument, Modifier.padding(bottom = 12.dp))
        JudgesBadge(VerdictDisplay.judgesLabel(result, s))
        Box(
            Modifier
                .fillMaxWidth()
                .warmShadow(3.dp, JudgeShapes.card)
                .clip(JudgeShapes.card)
                .background(Palette.paper)
                .border(1.dp, Palette.line, JudgeShapes.card)
                .padding(12.dp),
        ) {
            SceneView(VerdictDisplay.sceneVerdict(result), reducedMotion, Modifier.fillMaxWidth().height(180.dp))
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
