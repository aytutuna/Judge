package com.okjudge.judge.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialogDefaults
import androidx.compose.material3.BasicAlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.autofill.ContentType
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.okjudge.judge.core.auth.DeleteProblem
import com.okjudge.judge.i18n.LocalStrings
import com.okjudge.judge.ui.signin.PasswordField
import com.okjudge.judge.ui.theme.JudgeType
import com.okjudge.judge.ui.theme.Palette

object DeleteTags {
    const val PASSWORD = "delete.password"
    const val ERROR = "delete.error"
    const val CONFIRM = "delete.confirm"
    const val SIGN_IN_AGAIN = "delete.signInAgain"
}

/** What the delete sheet needs to know about the account and the last attempt. */
data class DeleteUi(
    /** The account has a password: the sheet asks for it. */
    val hasPassword: Boolean = false,
    val problem: DeleteProblem? = null,
    /** The last attempt failed for another reason. */
    val failed: Boolean = false,
    val onClearProblem: () -> Unit = {},
    /** Ends the session so the person can sign in afresh and delete. */
    val onSignInAgain: () -> Unit = {},
)

/** The delete confirmation in a dialog window. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DeleteAccountDialog(
    ui: DeleteUi,
    busy: Boolean,
    billing: Boolean,
    onDelete: (String?) -> Unit,
    onManageSubscription: (() -> Unit)?,
    onDismiss: () -> Unit,
) {
    BasicAlertDialog(onDismissRequest = { ui.onClearProblem(); onDismiss() }) {
        Surface(shape = AlertDialogDefaults.shape, color = Palette.paper, tonalElevation = AlertDialogDefaults.TonalElevation) {
            DeleteAccountForm(ui, busy, billing, onDelete, onManageSubscription, onDismiss, Modifier.padding(24.dp))
        }
    }
}

/**
 * What the delete dialog says, with a password box for an account that has one. A session too old to delete
 * without a password gets the "sign out" step in place of Delete.
 */
@Composable
fun DeleteAccountForm(
    ui: DeleteUi,
    busy: Boolean,
    billing: Boolean,
    onDelete: (String?) -> Unit,
    onManageSubscription: (() -> Unit)?,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val s = LocalStrings.current
    var password by remember { mutableStateOf("") }
    val message = when {
        ui.problem == DeleteProblem.REAUTH_REQUIRED -> s.errorReauthRequired
        ui.problem == DeleteProblem.PASSWORD_WRONG -> s.errorPasswordWrong
        ui.problem == DeleteProblem.RATE_LIMITED -> s.accountDeleteLimited
        ui.failed -> s.accountDeleteFailed
        else -> null
    }
    Column(modifier) {
        Text(s.appAccountDeleteTitle, style = JudgeType.sectionTitle)
        Text(
            if (billing) s.appAccountDeleteBody + "\n\n" + s.appAccountDeleteSubscription else s.appAccountDeleteBody,
            style = JudgeType.body,
            modifier = Modifier.padding(top = 16.dp),
        )
        if (ui.hasPassword) {
            Text(s.signinPassword, style = JudgeType.slotTitle, modifier = Modifier.padding(top = 20.dp, bottom = 8.dp))
            PasswordField(
                value = password,
                onChange = { password = it },
                autofill = ContentType.Password,
                onDone = {},
                modifier = Modifier.testTag(DeleteTags.PASSWORD),
            )
        }
        if (message != null) {
            Text(
                message,
                style = JudgeType.footnote.copy(color = Palette.danger),
                modifier = Modifier.padding(top = 12.dp).testTag(DeleteTags.ERROR),
            )
        }
        Row(Modifier.fillMaxWidth().padding(top = 16.dp), horizontalArrangement = Arrangement.End) {
            if (onManageSubscription != null) {
                TextButton(onClick = onManageSubscription) { Text(s.appAccountManageSubscription, color = Palette.ink) }
            }
            TextButton(onClick = { ui.onClearProblem(); onDismiss() }) { Text(s.appCancel, color = Palette.ink) }
            val reauth = ui.problem == DeleteProblem.REAUTH_REQUIRED
            if (reauth || ui.problem == DeleteProblem.PASSWORD_WRONG) {
                TextButton(onClick = ui.onSignInAgain, enabled = !busy, modifier = Modifier.testTag(DeleteTags.SIGN_IN_AGAIN)) {
                    Text(s.accountSignOut, color = Palette.danger)
                }
            }
            // An empty box sends no password: a fresh sign-in may delete without one, and the server says when it may not.
            if (!reauth || ui.hasPassword) {
                TextButton(
                    onClick = { onDelete(password.takeIf { ui.hasPassword && it.isNotEmpty() }) },
                    enabled = !busy,
                    modifier = Modifier.testTag(DeleteTags.CONFIRM),
                ) { Text(s.appAccountDeleteConfirm, color = Palette.danger) }
            }
        }
    }
}
