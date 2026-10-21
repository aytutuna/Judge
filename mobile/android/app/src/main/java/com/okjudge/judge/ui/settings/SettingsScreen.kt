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
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.okjudge.judge.core.auth.Account
import com.okjudge.judge.core.display.Errors
import com.okjudge.judge.i18n.LangPref
import com.okjudge.judge.i18n.LocalLang
import com.okjudge.judge.i18n.LocalStrings
import com.okjudge.judge.ui.components.Kicker
import com.okjudge.judge.ui.components.TopBar
import com.okjudge.judge.ui.theme.JudgeShapes
import com.okjudge.judge.ui.theme.JudgeType
import com.okjudge.judge.ui.theme.Palette

object SettingsTags {
    const val SIGN_IN = "settings.signIn"
    const val SIGN_OUT = "settings.signOut"
    const val DELETE = "settings.delete"
}

/** The account, language choice, links out to the website, and the footer note. */
@Composable
fun SettingsScreen(
    langPref: LangPref,
    versionName: String,
    onLangPref: (LangPref) -> Unit,
    onToggleLang: () -> Unit,
    onOpenLink: (String) -> Unit,
    siteBaseUrl: String,
    modifier: Modifier = Modifier,
    account: Account.State = Account.State.SignedOut,
    accountBusy: Boolean = false,
    onSignIn: () -> Unit = {},
    onSignOut: () -> Unit = {},
    onDeleteAccount: () -> Unit = {},
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

            AccountGroup(account, accountBusy, onSignIn, onSignOut, onDeleteAccount)

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
private fun AccountGroup(
    account: Account.State,
    busy: Boolean,
    onSignIn: () -> Unit,
    onSignOut: () -> Unit,
    onDelete: () -> Unit,
) {
    val s = LocalStrings.current
    val lang = LocalLang.current
    var confirmSignOut by rememberSaveable { mutableStateOf(false) }
    var confirmDelete by rememberSaveable { mutableStateOf(false) }
    val signedIn = account is Account.State.SignedIn
    // A session that ends while a dialog is open must not bring it back after the next sign-in.
    LaunchedEffect(signedIn) {
        if (!signedIn) {
            confirmSignOut = false
            confirmDelete = false
        }
    }

    Group(s.accountTitle) {
        when (account) {
            Account.State.SignedOut -> {
                Text(
                    s.accountSignInPrompt,
                    style = JudgeType.body.copy(color = Palette.ink2),
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 14.dp),
                )
                HorizontalDivider(color = Palette.line)
                ActionRow(s.signinTitle, Modifier.testTag(SettingsTags.SIGN_IN), trailing = "›", onClick = onSignIn)
            }
            is Account.State.SignedIn -> {
                val user = account.me?.user
                val e = account.me?.entitlement
                val status = when {
                    user != null -> s.accountSignedInAs(user.email)
                    account.loadFailed -> s.accountLoadFailed
                    else -> s.accountLoading
                }
                Text(
                    status,
                    style = JudgeType.body.copy(color = Palette.ink2),
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 14.dp),
                )
                if (user != null) {
                    HorizontalDivider(color = Palette.line)
                    FactRow(s.accountPlan, if (e?.isPremium == true) s.accountPlanPremium else s.accountPlanFree)
                    HorizontalDivider(color = Palette.line)
                    FactRow(s.accountCredits, (e?.credits ?: 0).toString())
                    e?.subscription?.let { sub ->
                        val date = Errors.formatDate(lang, sub.periodEnd) ?: sub.periodEnd
                        HorizontalDivider(color = Palette.line)
                        FactRow(
                            s.accountSubscription,
                            if (sub.willRenew) s.accountSubscriptionRenews(date) else s.accountSubscriptionUntil(date),
                            note = s.accountFairUse(sub.used.toString(), sub.cap.toString()),
                        )
                    }
                }
                HorizontalDivider(color = Palette.line)
                ActionRow(s.accountSignOut, Modifier.testTag(SettingsTags.SIGN_OUT), enabled = !busy) { confirmSignOut = true }
                HorizontalDivider(color = Palette.line)
                ActionRow(s.accountDelete, Modifier.testTag(SettingsTags.DELETE), color = Palette.danger, enabled = !busy) {
                    confirmDelete = true
                }
            }
        }
    }

    if (confirmSignOut && account is Account.State.SignedIn) {
        AlertDialog(
            onDismissRequest = { confirmSignOut = false },
            text = { Text(s.appAccountSignOutConfirm, style = JudgeType.body) },
            confirmButton = {
                TextButton(onClick = { confirmSignOut = false; onSignOut() }) { Text(s.accountSignOut, color = Palette.ink) }
            },
            dismissButton = { TextButton(onClick = { confirmSignOut = false }) { Text(s.appCancel, color = Palette.ink) } },
            containerColor = Palette.paper,
        )
    }
    if (confirmDelete && account is Account.State.SignedIn) {
        AlertDialog(
            onDismissRequest = { confirmDelete = false },
            title = { Text(s.appAccountDeleteTitle, style = JudgeType.sectionTitle) },
            text = { Text(s.appAccountDeleteBody, style = JudgeType.body) },
            confirmButton = {
                TextButton(onClick = { confirmDelete = false; onDelete() }) { Text(s.appAccountDeleteConfirm, color = Palette.danger) }
            },
            dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text(s.appCancel, color = Palette.ink) } },
            containerColor = Palette.paper,
        )
    }
}

@Composable
private fun FactRow(label: String, value: String, note: String? = null) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 14.dp), verticalAlignment = Alignment.Top) {
        // The label keeps its width; a long value wraps instead of the label.
        Text(label, style = JudgeType.body, modifier = Modifier.padding(end = 12.dp))
        Column(Modifier.weight(1f), horizontalAlignment = Alignment.End) {
            Text(value, style = JudgeType.bodyStrong, textAlign = TextAlign.End)
            if (note != null) Text(note, style = JudgeType.footnote, textAlign = TextAlign.End)
        }
    }
}

@Composable
private fun ActionRow(
    label: String,
    modifier: Modifier = Modifier,
    color: Color = Palette.ink,
    trailing: String? = null,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    Row(
        modifier
            .fillMaxWidth()
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, style = JudgeType.body.copy(color = if (enabled) color else Palette.muted), modifier = Modifier.weight(1f))
        if (trailing != null) Text(trailing, style = JudgeType.body.copy(color = Palette.muted))
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
