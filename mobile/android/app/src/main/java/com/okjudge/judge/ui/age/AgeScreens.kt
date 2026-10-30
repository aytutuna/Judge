package com.okjudge.judge.ui.age

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withLink
import androidx.compose.ui.unit.dp
import com.okjudge.judge.core.auth.AgeCheck
import com.okjudge.judge.i18n.LocalStrings
import com.okjudge.judge.ui.components.JudgeIcons
import com.okjudge.judge.ui.components.PrimaryButton
import com.okjudge.judge.ui.components.TextAction
import com.okjudge.judge.ui.components.TintedIcon
import com.okjudge.judge.ui.components.rememberIcon
import com.okjudge.judge.ui.theme.JudgeShapes
import com.okjudge.judge.ui.theme.JudgeType
import com.okjudge.judge.ui.theme.Palette

object AgeTags {
    const val CHECKBOX = "age.checkbox"
    const val CONTINUE = "age.continue"
    const val CONFIRM = "age.confirm"
    const val BLOCKED = "age.blocked"
    const val SIGN_OUT = "age.signOut"
    const val DELETE = "age.delete"
    const val ERROR = "age.error"
}

/** "I'm 18 or older", the whole row tappable. */
@Composable
fun AgeCheckbox(ticked: Boolean, onTicked: (Boolean) -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true) {
    val s = LocalStrings.current
    Row(
        modifier
            .fillMaxWidth()
            .clip(JudgeShapes.field)
            .toggleable(value = ticked, enabled = enabled, role = Role.Checkbox, onValueChange = onTicked)
            .testTag(AgeTags.CHECKBOX)
            .padding(vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        val box = RoundedCornerShape(6.dp)
        Box(
            Modifier
                .size(24.dp)
                .clip(box)
                .background(if (ticked) Palette.ink else Palette.paper)
                .border(1.5.dp, if (ticked) Palette.ink else Palette.line2, box),
            contentAlignment = Alignment.Center,
        ) {
            if (ticked) TintedIcon(rememberIcon(Palette.ivory) { JudgeIcons.check(it) }, 16)
        }
        Text(s.appAgeCheckbox, style = JudgeType.bodyStrong)
    }
}

/** Over the whole app until the signed-in account confirms 18+. */
@Composable
fun AgeConfirmScreen(
    ticked: Boolean,
    needsCheckbox: Boolean,
    busy: Boolean,
    error: String?,
    onTicked: (Boolean) -> Unit,
    onContinue: () -> Unit,
    onSignOut: () -> Unit,
    onDelete: () -> Unit,
    deleteFailed: Boolean = false,
) {
    val s = LocalStrings.current
    Cover(Modifier.testTag(AgeTags.CONFIRM)) {
        Text(s.appAgeTitle, style = JudgeType.sectionTitle, modifier = Modifier.semantics { heading() })
        Text(s.appAgeLead, style = JudgeType.lead, modifier = Modifier.padding(top = 10.dp, bottom = 20.dp))
        if (needsCheckbox) AgeCheckbox(ticked, onTicked, enabled = !busy)
        error?.let { ErrorNote(it) }
        PrimaryButton(
            text = s.appAgeContinue,
            enabled = (ticked || !needsCheckbox) && !busy,
            onClick = onContinue,
            modifier = Modifier.fillMaxWidth().padding(top = 20.dp).testTag(AgeTags.CONTINUE),
        )
        TextAction(
            s.accountSignOut,
            onClick = onSignOut,
            color = Palette.ink2,
            enabled = !busy,
            modifier = Modifier.padding(top = 14.dp).align(Alignment.CenterHorizontally).testTag(AgeTags.SIGN_OUT),
        )
        DeleteAccount(busy, deleteFailed, onDelete, Modifier.align(Alignment.CenterHorizontally))
    }
}

/** Judge is for adults only: shown for under-18s and blocked accounts, with a way to sign out. */
@Composable
fun AgeBlockedScreen(
    signedIn: Boolean,
    busy: Boolean,
    onSignOut: () -> Unit,
    onDelete: () -> Unit,
    onContact: () -> Unit,
    deleteFailed: Boolean = false,
) {
    val s = LocalStrings.current
    val linkStyle = TextLinkStyles(SpanStyle(color = Palette.terraInk, textDecoration = TextDecoration.Underline))
    // The address is a link inside the sentence wherever the language put it.
    val body = s.appAgeBlockedBody(AgeCheck.SUPPORT_EMAIL)
    val at = body.indexOf(AgeCheck.SUPPORT_EMAIL)
    val text = buildAnnotatedString {
        if (at < 0) {
            append(body)
        } else {
            append(body.substring(0, at))
            withLink(LinkAnnotation.Clickable(tag = "support", styles = linkStyle) { onContact() }) { append(AgeCheck.SUPPORT_EMAIL) }
            append(body.substring(at + AgeCheck.SUPPORT_EMAIL.length))
        }
    }
    Cover(Modifier.testTag(AgeTags.BLOCKED)) {
        Text(s.appAgeBlockedTitle, style = JudgeType.sectionTitle, modifier = Modifier.semantics { heading() })
        Text(text, style = JudgeType.lead, modifier = Modifier.padding(top = 10.dp))
        if (signedIn) {
            PrimaryButton(
                text = s.accountSignOut,
                enabled = !busy,
                onClick = onSignOut,
                modifier = Modifier.fillMaxWidth().padding(top = 28.dp).testTag(AgeTags.SIGN_OUT),
            )
            DeleteAccount(busy, deleteFailed, onDelete, Modifier.padding(top = 8.dp).align(Alignment.CenterHorizontally))
        }
    }
}

/** "Delete account" with the same confirmation as in Settings. */
@Composable
private fun DeleteAccount(busy: Boolean, failed: Boolean, onDelete: () -> Unit, modifier: Modifier = Modifier) {
    val s = LocalStrings.current
    var confirm by rememberSaveable { mutableStateOf(false) }
    if (failed) ErrorNote(s.accountDeleteFailed)
    TextAction(s.accountDelete, onClick = { confirm = true }, color = Palette.danger, enabled = !busy, modifier = modifier.testTag(AgeTags.DELETE))
    if (confirm) {
        AlertDialog(
            onDismissRequest = { confirm = false },
            title = { Text(s.appAccountDeleteTitle, style = JudgeType.sectionTitle) },
            text = { Text(s.appAccountDeleteBody, style = JudgeType.body) },
            confirmButton = {
                TextButton(onClick = { confirm = false; onDelete() }) { Text(s.appAccountDeleteConfirm, color = Palette.danger) }
            },
            dismissButton = { TextButton(onClick = { confirm = false }) { Text(s.appCancel, color = Palette.ink) } },
            containerColor = Palette.paper,
        )
    }
}

@Composable
private fun ErrorNote(text: String) {
    Text(
        text,
        style = JudgeType.body.copy(color = Palette.ink),
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 12.dp)
            .clip(JudgeShapes.field)
            .background(Palette.terraTint)
            .semantics { liveRegion = LiveRegionMode.Polite }
            .testTag(AgeTags.ERROR)
            .padding(horizontal = 16.dp, vertical = 12.dp),
    )
}

/** An ivory page over everything, taking every touch so nothing underneath reacts. */
@Composable
private fun Cover(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Box(
        modifier
            .fillMaxSize()
            .background(Palette.ivory)
            .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null, onClick = {})
            .safeDrawingPadding()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp),
        contentAlignment = Alignment.TopCenter,
    ) {
        Column(Modifier.widthIn(max = 480.dp).fillMaxWidth().padding(top = 48.dp, bottom = 32.dp), content = content)
    }
}
