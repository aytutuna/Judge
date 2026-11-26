package com.okjudge.judge.ui.age

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.SelectableDates
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
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
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
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
import com.okjudge.judge.i18n.LocalLang
import com.okjudge.judge.i18n.LocalStrings
import com.okjudge.judge.ui.components.PrimaryButton
import com.okjudge.judge.ui.components.TextAction
import com.okjudge.judge.ui.theme.JudgeShapes
import com.okjudge.judge.ui.theme.JudgeType
import com.okjudge.judge.ui.theme.Palette
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

object AgeTags {
    const val PICKER = "age.picker"
    const val CONTINUE = "age.continue"
    const val DATE = "age.date"
    const val CONFIRM = "age.confirm"
    const val CONFIRM_TEXT = "age.confirmText"
    const val CONFIRM_YES = "age.confirmYes"
    const val CHANGE = "age.change"
    const val BLOCKED = "age.blocked"
    const val SIGN_OUT = "age.signOut"
    const val DELETE = "age.delete"
    const val ERROR = "age.error"
}

private fun LocalDate.utcMillis(): Long = atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli()

private fun Long.utcDate(): LocalDate = Instant.ofEpochMilli(this).atOffset(ZoneOffset.UTC).toLocalDate()

/**
 * Over the whole app while the account has no date of birth: the picker, then
 * for an under-13 date one confirm step before anything is sent. The picked
 * date and the step live in saved state, so rotation and a killed process
 * keep them. The only ways past it are a date, signing out or deleting the account.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AgeDateScreen(
    busy: Boolean,
    failed: Boolean,
    onSubmit: (LocalDate) -> Unit,
    onSignOut: () -> Unit,
    onDelete: () -> Unit,
    deleteFailed: Boolean = false,
    nowMillis: () -> Long = System::currentTimeMillis,
) {
    val s = LocalStrings.current
    val lang = LocalLang.current
    val latest = remember { AgeCheck.latestDate(nowMillis()) }
    val picker = rememberDatePickerState(
        yearRange = 1900..latest.year,
        selectableDates = remember(latest) {
            object : SelectableDates {
                override fun isSelectableDate(utcTimeMillis: Long) = utcTimeMillis <= latest.utcMillis()
                override fun isSelectableYear(year: Int) = year <= latest.year
            }
        },
    )
    var confirming by rememberSaveable { mutableStateOf(false) }
    val date = picker.selectedDateMillis?.utcDate()
    val asking = confirming && date != null
    val focus = remember { FocusRequester() }
    LaunchedEffect(asking) { if (asking) focus.requestFocus() }

    Cover(Modifier.testTag(if (asking) AgeTags.CONFIRM else AgeTags.DATE)) {
        Text(s.ageTitle, style = JudgeType.sectionTitle, modifier = Modifier.semantics { heading() })
        if (asking && date != null) {
            val written = DateTimeFormatter.ofLocalizedDate(FormatStyle.LONG).withLocale(lang.locale).format(date)
            Text(
                s.ageConfirmDate(written),
                style = JudgeType.lead,
                modifier = Modifier
                    .padding(top = 10.dp, bottom = 8.dp)
                    .focusRequester(focus)
                    .focusable()
                    .semantics { liveRegion = LiveRegionMode.Polite }
                    .testTag(AgeTags.CONFIRM_TEXT),
            )
            if (failed) ErrorNote(s.ageFailed)
            PrimaryButton(
                text = s.ageConfirmYes,
                enabled = !busy,
                onClick = { onSubmit(date) },
                modifier = Modifier.fillMaxWidth().padding(top = 20.dp).testTag(AgeTags.CONFIRM_YES),
            )
            TextAction(
                s.ageChange,
                onClick = { confirming = false },
                color = Palette.ink2,
                enabled = !busy,
                modifier = Modifier.padding(top = 14.dp).align(Alignment.CenterHorizontally).testTag(AgeTags.CHANGE),
            )
        } else {
            Text(s.ageLead, style = JudgeType.lead, modifier = Modifier.padding(top = 10.dp, bottom = 12.dp))
            DatePicker(
                state = picker,
                title = null,
                modifier = Modifier.fillMaxWidth().semantics { contentDescription = s.ageTitle }.testTag(AgeTags.PICKER),
                colors = DatePickerDefaults.colors(containerColor = Palette.ivory),
            )
            if (failed) ErrorNote(s.ageFailed)
            PrimaryButton(
                text = s.ageContinue,
                enabled = date != null && !busy,
                onClick = {
                    val picked = date ?: return@PrimaryButton
                    if (AgeCheck.underThirteen(picked, nowMillis())) confirming = true else onSubmit(picked)
                },
                modifier = Modifier.fillMaxWidth().padding(top = 20.dp).testTag(AgeTags.CONTINUE),
            )
        }
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

/** The final block, for under-13s: no date field and no retry, only a way to sign out or delete. */
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
    val contact = s.ageBlockedContact(AgeCheck.SUPPORT_EMAIL)
    val at = contact.indexOf(AgeCheck.SUPPORT_EMAIL)
    val text = buildAnnotatedString {
        if (at < 0) {
            append(contact)
        } else {
            append(contact.substring(0, at))
            withLink(LinkAnnotation.Clickable(tag = "support", styles = linkStyle) { onContact() }) { append(AgeCheck.SUPPORT_EMAIL) }
            append(contact.substring(at + AgeCheck.SUPPORT_EMAIL.length))
        }
    }
    Cover(Modifier.testTag(AgeTags.BLOCKED)) {
        Text(s.ageBlockedTitle, style = JudgeType.sectionTitle, modifier = Modifier.semantics { heading() })
        Text(s.ageBlocked, style = JudgeType.lead, modifier = Modifier.padding(top = 10.dp))
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
