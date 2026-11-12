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
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
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
import com.okjudge.judge.core.data.Appearance
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
    const val ACCOUNT = "settings.account"
    const val PRICING = "settings.pricing"
    const val RESTORE = "settings.restore"
    const val RESTORE_NOTE = "settings.restoreNote"
    const val LANGUAGE = "settings.language"
    const val USAGE_STATS = "settings.usageStats"
    const val DARK_MODE = "settings.darkMode"

    /** A row of the language list: "settings.lang.system", "settings.lang.de". */
    fun langOption(pref: LangPref): String = "settings.lang.${pref.stored}"
}

/** "Restore purchases" in the account group; shown while the store is ready for this account. */
data class RestoreUi(val working: Boolean = false, val notice: PurchaseController.RestoreNotice? = null)

/** Account, language, dark mode and privacy choices, links out to the website, then sign out. */
@Composable
fun SettingsScreen(
    langPref: LangPref,
    versionName: String,
    onLangPref: (LangPref) -> Unit,
    onOpenLink: (String) -> Unit,
    siteBaseUrl: String,
    modifier: Modifier = Modifier,
    account: Account.State = Account.State.SignedOut,
    accountBusy: Boolean = false,
    onSignIn: () -> Unit = {},
    onSignOut: () -> Unit = {},
    onOpenAccount: () -> Unit = {},
    onOpenPricing: (() -> Unit)? = null,
    restore: RestoreUi? = null,
    onRestore: () -> Unit = {},
    /** Gets the stored choice: dark for the switch on, light for off. */
    onAppearance: (Appearance) -> Unit = {},
    usageStats: Boolean = true,
    onUsageStats: (Boolean) -> Unit = {},
) {
    val s = LocalStrings.current
    val base = siteBaseUrl.trimEnd('/')
    var pickingLang by rememberSaveable { mutableStateOf(false) }
    var confirmSignOut by rememberSaveable { mutableStateOf(false) }
    val signedIn = account is Account.State.SignedIn
    // A session that ends while the dialog is open must not bring it back after the next sign-in.
    LaunchedEffect(signedIn) { if (!signedIn) confirmSignOut = false }
    if (pickingLang) {
        LanguageDialog(langPref, onPick = { pickingLang = false; onLangPref(it) }, onDismiss = { pickingLang = false })
    }
    if (confirmSignOut && signedIn) {
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
    Column(modifier.fillMaxSize()) {
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(24.dp),
        ) {
            AccountGroup(account, accountBusy, onSignIn, onOpenAccount, onOpenPricing, restore, onRestore)

            Group(s.appSettingsLanguage) {
                ActionRow(
                    langPref.fixed?.nativeName ?: s.appSettingsLanguageDevice,
                    Modifier.testTag(SettingsTags.LANGUAGE),
                    trailing = "›",
                ) { pickingLang = true }
            }

            Group(s.appSettingsAppearance) {
                // The switch shows the scheme in use, which is the phone's until the person picks one.
                SwitchRow(s.settingsDarkMode, Palette.dark, SettingsTags.DARK_MODE) { on ->
                    onAppearance(if (on) Appearance.DARK else Appearance.LIGHT)
                }
            }

            Column {
                Group(s.footerPrivacy) {
                    SwitchRow(s.appSettingsUsageStats, usageStats, SettingsTags.USAGE_STATS, onUsageStats)
                    HorizontalDivider(color = Palette.line)
                    LinkRow(s.appSettingsAbout) { onOpenLink("$base/about") }
                    HorizontalDivider(color = Palette.line)
                    LinkRow(s.howTitle) { onOpenLink("$base/about#how") }
                    HorizontalDivider(color = Palette.line)
                    LinkRow(s.footerPrivacy) { onOpenLink("$base/privacy") }
                    HorizontalDivider(color = Palette.line)
                    LinkRow(s.appLegalTerms) { onOpenLink("$base/terms") }
                }
                Text(s.appSettingsUsageStatsHint, style = JudgeType.footnote, modifier = Modifier.padding(start = 4.dp, top = 8.dp, end = 4.dp))
            }

            if (signedIn) {
                Group(null) {
                    ActionRow(s.accountSignOut, Modifier.testTag(SettingsTags.SIGN_OUT), enabled = !accountBusy) { confirmSignOut = true }
                }
            }

            Column(horizontalAlignment = Alignment.Start, modifier = Modifier.fillMaxWidth().padding(bottom = 24.dp)) {
                Text(s.footerNote, style = JudgeType.footnote, textAlign = TextAlign.Start)
                Text(s.appSettingsVersion(versionName), style = JudgeType.footnote, modifier = Modifier.padding(top = 8.dp))
            }
        }
    }
}

@Composable
private fun SwitchRow(label: String, checked: Boolean, tag: String, onChange: (Boolean) -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .testTag(tag)
            .toggleable(value = checked, role = Role.Switch, onValueChange = onChange)
            .padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, style = JudgeType.body, modifier = Modifier.weight(1f))
        Switch(
            checked = checked,
            onCheckedChange = null,
            colors = SwitchDefaults.colors(checkedTrackColor = Palette.terraInk, checkedThumbColor = Palette.paper),
        )
    }
}

@Composable
private fun AccountGroup(
    account: Account.State,
    busy: Boolean,
    onSignIn: () -> Unit,
    onOpenAccount: () -> Unit,
    onOpenPricing: (() -> Unit)?,
    restore: RestoreUi?,
    onRestore: () -> Unit,
) {
    val s = LocalStrings.current
    val lang = LocalLang.current
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
                if (user != null) {
                    ActionRow(s.accountSignedInAs(user.email), Modifier.testTag(SettingsTags.ACCOUNT), trailing = "›", onClick = onOpenAccount)
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
                } else {
                    Text(
                        if (account.loadFailed) s.accountLoadFailed else s.accountLoading,
                        style = JudgeType.body.copy(color = Palette.ink2),
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 14.dp),
                    )
                }
            }
        }
        if (restore != null) {
            HorizontalDivider(color = Palette.line)
            RestoreRow(restore, enabled = !busy, if (account is Account.State.SignedIn) onRestore else onSignIn)
        }
        if (onOpenPricing != null) {
            HorizontalDivider(color = Palette.line)
            ActionRow(s.navPricing, Modifier.testTag(SettingsTags.PRICING), trailing = "›", onClick = onOpenPricing)
        }
    }
}

/** Settings > Account: the email and Delete account, behind its confirmation. */
@Composable
fun AccountScreen(
    account: Account.State,
    busy: Boolean,
    onDelete: () -> Unit,
    onBack: () -> Unit,
    onManageSubscription: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val s = LocalStrings.current
    // A subscription that still renews keeps billing after the account is gone.
    val billing = (account as? Account.State.SignedIn)?.me?.entitlement?.subscription?.willRenew == true
    var confirmDelete by rememberSaveable { mutableStateOf(false) }
    val signedIn = account is Account.State.SignedIn
    LaunchedEffect(signedIn) { if (!signedIn) confirmDelete = false }
    Column(modifier.fillMaxSize()) {
        TopBar(onBack = onBack)
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(24.dp),
        ) {
            Text(s.accountTitle, style = JudgeType.sectionTitle)
            Group(null) {
                (account as? Account.State.SignedIn)?.me?.user?.let {
                    Text(
                        s.accountSignedInAs(it.email),
                        style = JudgeType.body.copy(color = Palette.ink2),
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 14.dp),
                    )
                    HorizontalDivider(color = Palette.line)
                }
                ActionRow(s.accountDelete, Modifier.testTag(SettingsTags.DELETE), color = Palette.danger, enabled = !busy) {
                    confirmDelete = true
                }
            }
        }
    }
    if (confirmDelete && signedIn) {
        AlertDialog(
            onDismissRequest = { confirmDelete = false },
            title = { Text(s.appAccountDeleteTitle, style = JudgeType.sectionTitle) },
            text = {
                Text(
                    if (billing) s.appAccountDeleteBody + "\n\n" + s.appAccountDeleteSubscription else s.appAccountDeleteBody,
                    style = JudgeType.body,
                )
            },
            confirmButton = {
                TextButton(onClick = { confirmDelete = false; onDelete() }) { Text(s.appAccountDeleteConfirm, color = Palette.danger) }
            },
            dismissButton = {
                Row {
                    if (billing) TextButton(onClick = onManageSubscription) { Text(s.appAccountManageSubscription, color = Palette.ink) }
                    TextButton(onClick = { confirmDelete = false }) { Text(s.appCancel, color = Palette.ink) }
                }
            },
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
        Text(label, style = JudgeType.body.copy(color = Palette.ink2), modifier = Modifier.padding(end = 12.dp))
        Column(Modifier.weight(1f), horizontalAlignment = Alignment.End) {
            Text(value, style = JudgeType.bodyMedium.copy(color = Palette.ink), textAlign = TextAlign.End)
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
