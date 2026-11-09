package com.okjudge.judge.ui.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.autofill.ContentType
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import com.okjudge.judge.core.auth.SignInError
import com.okjudge.judge.i18n.LocalStrings
import com.okjudge.judge.ui.signin.PasswordField
import com.okjudge.judge.ui.signin.SignInUiState
import com.okjudge.judge.ui.signin.errorText
import com.okjudge.judge.ui.theme.JudgeShapes
import com.okjudge.judge.ui.theme.JudgeType
import com.okjudge.judge.ui.theme.Palette
import kotlinx.coroutines.launch

@Composable
internal fun PasswordDialog(
    hasPassword: Boolean,
    onSave: suspend (new: String, current: String?) -> SignInError?,
    onDismiss: () -> Unit,
) {
    Dialog(onDismissRequest = onDismiss) {
        PasswordPanel(hasPassword, onSave, onDismiss)
    }
}

/**
 * Sets or changes the password. Changing asks for the current one; the server
 * lets a fresh code sign-in skip it and answers password_required otherwise.
 */
@Composable
internal fun PasswordPanel(
    hasPassword: Boolean,
    onSave: suspend (new: String, current: String?) -> SignInError?,
    onClose: () -> Unit,
) {
    val s = LocalStrings.current
    val scope = rememberCoroutineScope()
    var current by remember { mutableStateOf("") }
    var new by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var saved by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<SignInError?>(null) }

    fun save() {
        if (busy || new.isEmpty() || (hasPassword && current.isEmpty())) return
        if (new.length < SignInUiState.PASSWORD_MIN) {
            error = SignInError.PASSWORD_SHORT
            return
        }
        busy = true
        error = null
        scope.launch {
            error = onSave(new, current.takeIf { hasPassword })
            saved = error == null
            busy = false
        }
    }

    Column(
        Modifier
            .fillMaxWidth()
            .clip(JudgeShapes.card)
            .background(Palette.paper)
            .padding(24.dp),
    ) {
        Text(
            if (hasPassword) s.accountPasswordChange else s.accountPasswordSet,
            style = JudgeType.sectionTitle,
            modifier = Modifier.padding(bottom = 16.dp),
        )
        if (saved) {
            Text(s.accountPasswordSaved, style = JudgeType.body, modifier = Modifier.testTag(SettingsTags.PASSWORD_SAVED))
        } else {
            if (hasPassword) {
                Text(s.accountPasswordCurrent, style = JudgeType.slotTitle, modifier = Modifier.padding(bottom = 8.dp))
                PasswordField(
                    value = current,
                    onChange = { current = it; error = null },
                    autofill = ContentType.Password,
                    onDone = {},
                    modifier = Modifier.testTag(SettingsTags.PASSWORD_CURRENT),
                )
            }
            Text(
                s.signinPasswordNew,
                style = JudgeType.slotTitle,
                modifier = Modifier.padding(top = if (hasPassword) 16.dp else 0.dp, bottom = 8.dp),
            )
            PasswordField(
                value = new,
                onChange = { new = it.take(SignInUiState.PASSWORD_MAX); error = null },
                autofill = ContentType.NewPassword,
                onDone = ::save,
                modifier = Modifier.testTag(SettingsTags.PASSWORD_NEW),
            )
            error?.let {
                Text(
                    errorText(s, it),
                    style = JudgeType.body.copy(color = Palette.danger),
                    modifier = Modifier.padding(top = 12.dp).testTag(SettingsTags.PASSWORD_ERROR),
                )
            }
        }
        Row(
            Modifier.fillMaxWidth().padding(top = 12.dp),
            horizontalArrangement = Arrangement.End,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (saved) {
                TextButton(onClick = onClose) { Text(s.appClose, color = Palette.ink) }
            } else {
                TextButton(onClick = onClose, enabled = !busy) { Text(s.appCancel, color = Palette.ink) }
                TextButton(
                    onClick = ::save,
                    enabled = !busy && new.isNotEmpty() && (!hasPassword || current.isNotEmpty()),
                    modifier = Modifier.testTag(SettingsTags.PASSWORD_SAVE),
                ) { Text(s.signinPasswordSave, color = Palette.ink) }
            }
        }
    }
}
