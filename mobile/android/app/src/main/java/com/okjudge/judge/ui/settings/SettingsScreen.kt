package com.okjudge.judge.ui.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.okjudge.judge.i18n.LangPref
import com.okjudge.judge.i18n.LocalStrings
import com.okjudge.judge.ui.components.Kicker
import com.okjudge.judge.ui.components.TopBar
import com.okjudge.judge.ui.theme.JudgeShapes
import com.okjudge.judge.ui.theme.JudgeType
import com.okjudge.judge.ui.theme.Palette

/** Language choice, links out to the website, and the footer note. */
@Composable
fun SettingsScreen(
    langPref: LangPref,
    versionName: String,
    onLangPref: (LangPref) -> Unit,
    onToggleLang: () -> Unit,
    onOpenLink: (String) -> Unit,
    siteBaseUrl: String,
    modifier: Modifier = Modifier,
) {
    val s = LocalStrings.current
    val base = siteBaseUrl.trimEnd('/')
    Column(modifier.fillMaxSize()) {
        TopBar(onBack = null, onToggleLang = onToggleLang)
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(24.dp),
        ) {
            Text(s.appTabSettings, style = JudgeType.sectionTitle.copy(fontSize = JudgeType.sectionTitle.fontSize * 1.3f))

            Group(s.appSettingsLanguage) {
                listOf(
                    LangPref.SYSTEM to s.appSettingsLanguageDevice,
                    LangPref.EN to s.appLangEn,
                    LangPref.TR to s.appLangTr,
                ).forEachIndexed { i, (pref, label) ->
                    if (i > 0) HorizontalDivider(color = Palette.line)
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .selectable(selected = pref == langPref, role = Role.RadioButton) { onLangPref(pref) }
                            .padding(horizontal = 16.dp, vertical = 14.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(label, style = JudgeType.body, modifier = Modifier.weight(1f))
                        Radio(pref == langPref)
                    }
                }
            }

            Group(null) {
                LinkRow(s.appSettingsAbout) { onOpenLink("$base/about") }
                HorizontalDivider(color = Palette.line)
                LinkRow(s.navHow) { onOpenLink("$base/#how") }
                HorizontalDivider(color = Palette.line)
                LinkRow(s.footerPrivacy) { onOpenLink("$base/privacy") }
            }

            Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth().padding(bottom = 24.dp)) {
                Text(s.footerNote, style = JudgeType.footnote, textAlign = TextAlign.Center)
                Text(s.appSettingsVersion(versionName), style = JudgeType.footnote, modifier = Modifier.padding(top = 8.dp))
            }
        }
    }
}

@Composable
private fun Group(title: String?, content: @Composable () -> Unit) {
    Column {
        if (title != null) Kicker(title, Modifier.padding(start = 4.dp, bottom = 8.dp))
        Column(
            Modifier
                .fillMaxWidth()
                .clip(JudgeShapes.block)
                .background(Palette.paper)
                .border(1.dp, Palette.line, JudgeShapes.block),
        ) { content() }
    }
}

@Composable
private fun LinkRow(label: String, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable(role = Role.Button, onClick = onClick).padding(horizontal = 16.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, style = JudgeType.body, modifier = Modifier.weight(1f))
        Text("↗", style = JudgeType.body.copy(color = Palette.muted))
    }
}

@Composable
private fun Radio(selected: Boolean) {
    Box(
        Modifier.size(20.dp).clip(CircleShape).border(1.5.dp, if (selected) Palette.ink else Palette.line2, CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        if (selected) Box(Modifier.size(10.dp).clip(CircleShape).background(Palette.ink))
    }
}
