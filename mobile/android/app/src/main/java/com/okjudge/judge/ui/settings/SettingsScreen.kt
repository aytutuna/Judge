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
import androidx.compose.material3.CircularProgressIndicator
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
import com.okjudge.judge.core.purchases.PurchaseController
import com.okjudge.judge.i18n.AppLang
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
    const val PRICING = "settings.pricing"
    const val RESTORE = "settings.restore"
    const val RESTORE_NOTE = "settings.restoreNote"
    const val LANGUAGE = "settings.language"

    /** A row of the language list: "settings.lang.system", "settings.lang.de". */
    fun langOption(pref: LangPref): String = "settings.lang.${pref.stored}"
}

/** "Restore purchases" in the account group; shown while the store is ready for this account. */
data class RestoreUi(val working: Boolean = false, val notice: PurchaseController.RestoreNotice? = null)

/** The account, language choice, links out to the website, and the footer note. */
@Composable
fun SettingsScreen(
    langPref: LangPref,
    versionName: String,
    onLangPref: (LangPref) -> Unit,
    onNew: (() -> Unit)?,
    onOpenLink: (String) -> Unit,
    siteBaseUrl: String,
    modifier: Modifier = Modifier,
    account: Account.State = Account.State.SignedOut,
    accountBusy: Boolean = false,
    onSignIn: () -> Unit = {},
    onSignOut: () -> Unit = {},
    onDeleteAccount: () -> Unit = {},
    onOpenPricing: (() -> Unit)? = null,
    restore: RestoreUi? = null,
    onRestore: () -> Unit = {},
) {
    val s = LocalStrings.current
    val base = siteBaseUrl.trimEnd('/')
    var pickingLang by rememberSaveable { mutableStateOf(false) }
    if (pickingLang) {
        LanguageDialog(langPref, onPick = { pickingLang = false; onLangPref(it) }, onDismiss = { pickingLang = false })
    }
    Column(modifier.fillMaxSize()) {
        TopBar(onBack = null, onNew = onNew)
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(24.dp),
        ) {
            Text(s.appTabSettings, style = JudgeType.sectionTitle.copy(fontSize = JudgeType.sectionTitle.fontSize * 1.3f))

            AccountGroup(account, accountBusy, onSignIn, onSignOut, onDeleteAccount, restore, onRestore)

            Group(s.appSettingsLanguage) {
                ActionRow(
                    langPref.fixed?.nativeName ?: s.appSettingsLanguageDevice,
                    Modifier.testTag(SettingsTags.LANGUAGE),
                    trailing = "›",
                ) { pickingLang = true }
            }

            if (onOpenPricing != null) {
                Group(null) {
                    ActionRow(s.navPricing, Modifier.testTag(SettingsTags.PRICING), trailing = "›", onClick = onOpenPricing)
                }
            }

            Group(null) {
                LinkRow(s.appSettingsAbout) { onOpenLink("$base/about") }
                HorizontalDivider(color = Palette.line)
                LinkRow(s.howTitle) { onOpenLink("$base/about#how") }
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
    restore: RestoreUi?,
    onRestore: () -> Unit,
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
                    if (restore != null) {
                        HorizontalDivider(color = Palette.line)
                        RestoreRow(restore, enabled = !busy, onRestore)
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
private fun RestoreRow(restore: RestoreUi, enabled: Boolean, onRestore: () -> Unit) {
    val s = LocalStrings.current
    Column {
        ActionRow(s.appPurchaseRestore, Modifier.testTag(SettingsTags.RESTORE), enabled = enabled && !restore.working, onClick = onRestore)
        val note = when (restore.notice) {
            PurchaseController.RestoreNotice.DONE -> s.appPurchaseRestoreDone
            PurchaseController.RestoreNotice.NONE -> s.appPurchaseRestoreNone
            PurchaseController.RestoreNotice.FAILED -> s.appPurchaseFailed
            null -> null
        }
        if (restore.working) {
            CircularProgressIndicator(
                Modifier.padding(start = 16.dp, bottom = 12.dp).size(12.dp),
                color = Palette.ink2,
                strokeWidth = 1.5.dp,
            )
        } else if (note != null) {
            Text(
                note,
                style = JudgeType.footnote.copy(
                    color = if (restore.notice == PurchaseController.RestoreNotice.FAILED) Palette.danger else Palette.ink2,
                ),
                modifier = Modifier.padding(start = 16.dp, end = 16.dp, bottom = 12.dp).testTag(SettingsTags.RESTORE_NOTE),
            )
        }
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

/** "Same as the phone" and every language the app speaks, each in its own words. */
@Composable
private fun LanguageDialog(current: LangPref, onPick: (LangPref) -> Unit, onDismiss: () -> Unit) {
    val s = LocalStrings.current
    val options = listOf(LangPref.SYSTEM) + AppLang.enabled.map { LangPref(it) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(s.appSettingsLanguage, style = JudgeType.sectionTitle) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                options.forEach { pref ->
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .testTag(SettingsTags.langOption(pref))
                            .selectable(selected = pref == current, role = Role.RadioButton) { onPick(pref) }
                            .padding(vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(pref.fixed?.nativeName ?: s.appSettingsLanguageDevice, style = JudgeType.body, modifier = Modifier.weight(1f))
                        Radio(pref == current)
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text(s.appCancel, color = Palette.ink) } },
        containerColor = Palette.paper,
    )
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
