package com.okjudge.judge.ui.age

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.RadioButton
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import com.okjudge.judge.ui.signin.Field
import androidx.compose.foundation.focusable
import androidx.compose.foundation.gestures.detectTapGestures
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
import androidx.compose.material3.DatePickerState
import androidx.compose.material3.DisplayMode
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.SelectableDates
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.snapshotFlow
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
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
import android.content.res.Configuration
import com.okjudge.judge.core.auth.AgeCheck
import com.okjudge.judge.core.display.Errors
import com.okjudge.judge.core.display.UiError
import com.okjudge.judge.core.model.AgeHint
import com.okjudge.judge.core.model.ParentView
import com.okjudge.judge.i18n.AppLang
import com.okjudge.judge.i18n.LocalLang
import com.okjudge.judge.i18n.LocalStrings
import com.okjudge.judge.ui.components.PrimaryButton
import com.okjudge.judge.ui.components.TextAction
import com.okjudge.judge.ui.theme.JudgeShapes
import com.okjudge.judge.ui.settings.DeleteAccountDialog
import com.okjudge.judge.ui.settings.DeleteUi
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
    const val APPROVAL = "age.approval"
    const val CHECK_AGAIN = "age.checkAgain"
    const val SIGN_OUT = "age.signOut"
    const val DELETE = "age.delete"
    const val ERROR = "age.error"
    const val COUNTRY = "age.country"
    const val COUNTRY_LIST = "age.countryList"
    const val QUEBEC_YES = "age.quebecYes"
    const val QUEBEC_NO = "age.quebecNo"
    const val REGION = "age.region"
    const val PARENT = "age.parent"
    const val PARENT_WAIT = "age.parentWait"
    const val PARENT_EMAIL = "age.parentEmail"
    const val PARENT_SEND = "age.parentSend"
    const val PARENT_RESEND = "age.parentResend"
    const val PARENT_CHANGE = "age.parentChange"
    const val PARENT_CANCEL = "age.parentCancel"
    const val PARENT_RELOAD = "age.parentReload"
    const val PARENT_DECLINED = "age.parentDeclined"
    const val PARENT_REVOKED = "age.parentRevoked"
}

/** Material's own picker texts and date format follow the system locale; this makes them follow the app's language. */
@Composable
private fun InAppLanguage(lang: AppLang, content: @Composable () -> Unit) {
    val base = LocalContext.current
    val config = remember(base, lang) { Configuration(base.resources.configuration).apply { setLocale(lang.locale) } }
    val context = remember(base, config) { base.createConfigurationContext(config) }
    CompositionLocalProvider(LocalContext provides context, LocalConfiguration provides config, content = content)
}

private fun LocalDate.utcMillis(): Long = atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli()

private fun Long.utcDate(): LocalDate = Instant.ofEpochMilli(this).atOffset(ZoneOffset.UTC).toLocalDate()

/**
 * Over the whole app while the account has no date of birth: the picker, then
 * for an under-13 date one confirm step before anything is sent. The picked
 * date and the step live in saved state, so rotation and a killed process
 * keep them. The only ways past it are a date, signing out or deleting the account.
 */
@Composable
fun AgeDateScreen(
    busy: Boolean,
    failed: Boolean,
    /** The date, then the country (only asked of 13 to 15) and the Quebec answer (only 13 in Canada). */
    onSubmit: (LocalDate, String?, Boolean?) -> Unit,
    onSignOut: () -> Unit,
    onDelete: (String?) -> Unit,
    delete: DeleteUi = DeleteUi(),
    /** The person went back to the picker or is about to confirm: the last failure no longer applies. */
    onEdit: () -> Unit = {},
    /** The server's guess from the request's IP, the first value of the questions. */
    hint: AgeHint? = null,
    nowMillis: () -> Long = System::currentTimeMillis,
) {
    // The input pattern, the first weekday and Material's texts come from the app's language, not the phone's.
    InAppLanguage(LocalLang.current) {
        AgeDateBody(busy, failed, onSubmit, onSignOut, onDelete, delete, onEdit, hint, nowMillis)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AgeDateBody(
    busy: Boolean,
    failed: Boolean,
    onSubmit: (LocalDate, String?, Boolean?) -> Unit,
    onSignOut: () -> Unit,
    onDelete: (String?) -> Unit,
    delete: DeleteUi,
    onEdit: () -> Unit,
    hint: AgeHint?,
    nowMillis: () -> Long,
) {
    val s = LocalStrings.current
    val lang = LocalLang.current
    val latest = remember { AgeCheck.latestDate(nowMillis()) }
    // Typing a birth year is quicker than paging back through months; the calendar stays one tap away on the toggle.
    // The state is built with the app's locale (Material would take the phone's), so its Saver is not usable:
    // the picked day, the shown month and the mode are kept by hand across recreation.
    var savedMillis by rememberSaveable { mutableStateOf<Long?>(null) }
    var savedMonth by rememberSaveable { mutableStateOf<Long?>(null) }
    var savedCalendar by rememberSaveable { mutableStateOf(false) }
    val picker = remember(lang) {
        DatePickerState(
            locale = lang.locale,
            initialSelectedDateMillis = savedMillis,
            initialDisplayedMonthMillis = savedMonth ?: savedMillis,
            yearRange = 1900..latest.year,
            initialDisplayMode = if (savedCalendar) DisplayMode.Picker else DisplayMode.Input,
            selectableDates = object : SelectableDates {
                override fun isSelectableDate(utcTimeMillis: Long) = utcTimeMillis <= latest.utcMillis()
                override fun isSelectableYear(year: Int) = year <= latest.year
            },
        )
    }
    LaunchedEffect(picker) {
        snapshotFlow { Triple(picker.selectedDateMillis, picker.displayedMonthMillis, picker.displayMode == DisplayMode.Picker) }
            .collect { (day, month, calendar) ->
                savedMillis = day
                savedMonth = month
                savedCalendar = calendar
            }
    }
    var confirming by rememberSaveable { mutableStateOf(false) }
    var country by rememberSaveable { mutableStateOf<String?>(null) }
    var quebec by rememberSaveable { mutableStateOf<Boolean?>(null) }
    // The guess fills in only what the person has not answered yet.
    LaunchedEffect(hint) {
        val guess = hint?.country ?: return@LaunchedEffect
        if (country == null) {
            country = guess
            if (guess == "CA") quebec = hint.quebec
        }
    }
    val date = picker.selectedDateMillis?.utcDate()
    val asksCountry = date != null && AgeCheck.asksCountry(date, nowMillis())
    val asksQuebec = date != null && AgeCheck.asksQuebec(date, country, nowMillis())
    val answered = (!asksCountry || country != null) && (!asksQuebec || quebec != null)
    fun send(picked: LocalDate) =
        onSubmit(picked, country.takeIf { asksCountry }, quebec.takeIf { asksQuebec })
    val asking = confirming && date != null
    val focus = remember { FocusRequester() }
    LaunchedEffect(asking) { if (asking) focus.requestFocus() }

    Cover(Modifier.testTag(if (asking) AgeTags.CONFIRM else AgeTags.DATE)) {
        if (asking && date != null) {
            Text(s.ageTitle, style = JudgeType.sectionTitle, modifier = Modifier.semantics { heading() })
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
                onClick = { send(date) },
                modifier = Modifier.fillMaxWidth().padding(top = 20.dp).testTag(AgeTags.CONFIRM_YES),
            )
            TextAction(
                s.ageChange,
                onClick = { onEdit(); confirming = false },
                color = Palette.ink2,
                enabled = !busy,
                modifier = Modifier.padding(top = 14.dp).align(Alignment.CenterHorizontally).testTag(AgeTags.CHANGE),
            )
        } else {
            // Our title takes the headline slot beside the calendar toggle, so no empty header strip is left.
            DatePicker(
                state = picker,
                title = null,
                headline = {
                    Text(s.ageTitle, style = JudgeType.sectionTitle, modifier = Modifier.semantics { heading() })
                },
                modifier = Modifier.fillMaxWidth().semantics { contentDescription = s.ageTitle }.testTag(AgeTags.PICKER),
                colors = DatePickerDefaults.colors(containerColor = Palette.ivory),
            )
            Text(s.ageLead, style = JudgeType.lead, modifier = Modifier.padding(top = 12.dp))
            if (asksCountry) {
                Text(s.ageWhere, style = JudgeType.slotTitle, modifier = Modifier.padding(top = 20.dp).semantics { heading() })
                Text(s.ageWhereWhy, style = JudgeType.body, modifier = Modifier.padding(top = 4.dp, bottom = 8.dp))
                CountryField(country, enabled = !busy, onPick = { country = it; if (it != "CA") quebec = null })
            }
            if (asksQuebec) {
                Text(s.ageQuebec, style = JudgeType.slotTitle, modifier = Modifier.padding(top = 20.dp).semantics { heading() })
                Choice(s.ageYes, quebec == true, !busy, { quebec = true }, AgeTags.QUEBEC_YES)
                Choice(s.ageNo, quebec == false, !busy, { quebec = false }, AgeTags.QUEBEC_NO)
            }
            if (failed) ErrorNote(s.ageFailed)
            PrimaryButton(
                text = s.ageContinue,
                enabled = date != null && answered && !busy,
                onClick = {
                    val picked = date ?: return@PrimaryButton
                    if (AgeCheck.underThirteen(picked, nowMillis())) {
                        onEdit()
                        confirming = true
                    } else {
                        send(picked)
                    }
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
        DeleteAccount(busy, delete, onDelete, Modifier.align(Alignment.CenterHorizontally))
    }
}

/** The final block, for under-13s: no date field and no retry, only a way to sign out or delete. */
@Composable
fun AgeBlockedScreen(
    signedIn: Boolean,
    busy: Boolean,
    onSignOut: () -> Unit,
    onDelete: (String?) -> Unit,
    onContact: () -> Unit,
    delete: DeleteUi = DeleteUi(),
) {
    val s = LocalStrings.current
    val text = supportLink(s.ageBlockedContact(AgeCheck.SUPPORT_EMAIL), onContact)
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
            DeleteAccount(busy, delete, onDelete, Modifier.padding(top = 8.dp).align(Alignment.CenterHorizontally))
        }
    }
}

/** The sentence with the support address as a link, wherever the language put it. */
@Composable
private fun supportLink(contact: String, onContact: () -> Unit): AnnotatedString {
    val linkStyle = TextLinkStyles(SpanStyle(color = Palette.terraInk, textDecoration = TextDecoration.Underline))
    val at = contact.indexOf(AgeCheck.SUPPORT_EMAIL)
    return buildAnnotatedString {
        if (at < 0) {
            append(contact)
        } else {
            append(contact.substring(0, at))
            withLink(LinkAnnotation.Clickable(tag = "support", styles = linkStyle) { onContact() }) { append(AgeCheck.SUPPORT_EMAIL) }
            append(contact.substring(at + AgeCheck.SUPPORT_EMAIL.length))
        }
    }
}

/** Brazil under 18: no retry, the account opens by itself on the 18th birthday. */
@Composable
fun AgeRegionScreen(
    busy: Boolean,
    onSignOut: () -> Unit,
    onDelete: (String?) -> Unit,
    onContact: () -> Unit,
    delete: DeleteUi = DeleteUi(),
) {
    val s = LocalStrings.current
    Cover(Modifier.testTag(AgeTags.REGION)) {
        Text(s.ageRegionTitle, style = JudgeType.sectionTitle, modifier = Modifier.semantics { heading() })
        Text(s.ageRegion, style = JudgeType.lead, modifier = Modifier.padding(top = 10.dp))
        Text(supportLink(s.ageRegionContact(AgeCheck.SUPPORT_EMAIL), onContact), style = JudgeType.lead, modifier = Modifier.padding(top = 10.dp))
        PrimaryButton(
            text = s.accountSignOut,
            enabled = !busy,
            onClick = onSignOut,
            modifier = Modifier.fillMaxWidth().padding(top = 28.dp).testTag(AgeTags.SIGN_OUT),
        )
        DeleteAccount(busy, delete, onDelete, Modifier.padding(top = 8.dp).align(Alignment.CenterHorizontally))
    }
}

/**
 * A parent has to say yes. [status] is the account's `age.parent`; [view] is what the server holds
 * (null until it has answered). The email form shows for a first request, a revoked yes, and while
 * the person is changing the address.
 */
@Composable
fun AgeParentScreen(
    status: String,
    view: ParentView?,
    busy: Boolean,
    error: UiError?,
    onSend: (String) -> Unit,
    onResend: () -> Unit,
    onReload: () -> Unit,
    onSignOut: () -> Unit,
    onDelete: (String?) -> Unit,
    delete: DeleteUi = DeleteUi(),
) {
    val s = LocalStrings.current
    val lang = LocalLang.current
    val deleteOn = Errors.formatDate(lang, view?.deleteAt)
    // Changing the address is over once the server's answer moves on.
    var changing by remember(view?.emailHint, view?.changesLeft, view?.resendsLeft) { mutableStateOf(false) }
    var email by rememberSaveable { mutableStateOf("") }
    val sent = view?.sent == true
    val declined = status == "declined"
    val revoked = status == "revoked"
    val tag = when {
        declined -> AgeTags.PARENT_DECLINED
        revoked -> AgeTags.PARENT_REVOKED
        sent -> AgeTags.PARENT_WAIT
        else -> AgeTags.PARENT
    }
    Cover(Modifier.testTag(tag)) {
        val title = when {
            declined -> s.ageParentDeclinedTitle
            revoked -> s.ageParentRevokedTitle
            sent -> s.ageParentWaitTitle
            else -> s.ageParentTitle
        }
        Text(title, style = JudgeType.sectionTitle, modifier = Modifier.semantics { heading() })
        when {
            declined -> deleteOn?.let { Text(s.ageParentDeclined(it), style = JudgeType.lead, modifier = Modifier.padding(top = 10.dp)) }
            view == null -> Unit
            revoked -> deleteOn?.let { Text(s.ageParentRevoked(it), style = JudgeType.lead, modifier = Modifier.padding(top = 10.dp)) }
            sent && !changing -> {
                Text(s.ageParentSentTo(view.emailHint ?: ""), style = JudgeType.lead, modifier = Modifier.padding(top = 10.dp))
                if (view.expired) Text(s.ageParentExpired, style = JudgeType.lead, modifier = Modifier.padding(top = 6.dp))
                resendTime(lang, view)?.let { Text(s.ageParentResendAt(it), style = JudgeType.body, modifier = Modifier.padding(top = 6.dp)) }
            }
            else -> Text(s.ageParentLead, style = JudgeType.lead, modifier = Modifier.padding(top = 10.dp))
        }
        if (!declined && !revoked && view != null) {
            deleteOn?.let { Text(s.ageParentDelete(it), style = JudgeType.body, modifier = Modifier.padding(top = 10.dp)) }
        }
        if (error != null) ErrorNote(Errors.message(error, s, lang))
        when {
            declined -> Unit
            view == null -> TextAction(s.appRetry, onClick = onReload, color = Palette.ink2, modifier = Modifier.padding(top = 14.dp).testTag(AgeTags.PARENT_RELOAD))
            revoked || !sent || changing -> {
                Text(s.ageParentEmail, style = JudgeType.slotTitle, modifier = Modifier.padding(top = 20.dp, bottom = 8.dp))
                Field(
                    value = email,
                    onChange = { email = it },
                    placeholder = s.ageParentEmail,
                    keyboard = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Go, autoCorrectEnabled = false),
                    onIme = { if (email.isNotBlank() && !busy) onSend(email) },
                    enabled = !busy,
                    modifier = Modifier.testTag(AgeTags.PARENT_EMAIL),
                )
                PrimaryButton(
                    text = s.ageParentSend,
                    enabled = email.isNotBlank() && !busy,
                    onClick = { onSend(email) },
                    modifier = Modifier.fillMaxWidth().padding(top = 16.dp).testTag(AgeTags.PARENT_SEND),
                )
                if (changing) {
                    TextAction(
                        s.ageParentCancel,
                        onClick = { changing = false },
                        color = Palette.ink2,
                        enabled = !busy,
                        modifier = Modifier.padding(top = 8.dp).align(Alignment.CenterHorizontally).testTag(AgeTags.PARENT_CANCEL),
                    )
                }
            }
            else -> {
                PrimaryButton(
                    text = s.ageParentResend,
                    enabled = view.resendsLeft > 0 && !busy,
                    onClick = onResend,
                    modifier = Modifier.fillMaxWidth().padding(top = 20.dp).testTag(AgeTags.PARENT_RESEND),
                )
                TextAction(
                    s.ageParentChange,
                    onClick = { email = ""; changing = true },
                    color = Palette.ink2,
                    enabled = view.changesLeft > 0 && !busy,
                    modifier = Modifier.padding(top = 8.dp).align(Alignment.CenterHorizontally).testTag(AgeTags.PARENT_CHANGE),
                )
            }
        }
        TextAction(
            s.accountSignOut,
            onClick = onSignOut,
            color = Palette.ink2,
            enabled = !busy,
            modifier = Modifier.padding(top = 14.dp).align(Alignment.CenterHorizontally).testTag(AgeTags.SIGN_OUT),
        )
        DeleteAccount(busy, delete, onDelete, Modifier.align(Alignment.CenterHorizontally))
    }
}

/** When a resend is next accepted, as a time of day, or null when it is accepted now. */
private fun resendTime(lang: AppLang, view: ParentView, now: Instant = Instant.now()): String? {
    val at = view.resendAt?.let { runCatching { Instant.parse(it) }.getOrNull() } ?: return null
    if (!at.isAfter(now)) return null
    return android.icu.text.DateFormat.getInstanceForSkeleton("jm", lang.locale).format(java.util.Date.from(at))
}

/** A field-shaped button showing the chosen country; it opens the list. */
@Composable
private fun CountryField(code: String?, enabled: Boolean, onPick: (String) -> Unit) {
    val s = LocalStrings.current
    val locale = LocalLang.current.locale
    val options = remember(locale) { Countries.options(locale) }
    var open by rememberSaveable { mutableStateOf(false) }
    Box(
        Modifier
            .fillMaxWidth()
            .defaultMinSize(minHeight = 52.dp)
            .clip(JudgeShapes.field)
            .background(Palette.paper)
            .border(1.dp, Palette.line2, JudgeShapes.field)
            .semantics { role = Role.DropdownList }
            .clickable(enabled = enabled) { open = true }
            .padding(horizontal = 16.dp, vertical = 14.dp)
            .testTag(AgeTags.COUNTRY),
        contentAlignment = Alignment.CenterStart,
    ) {
        Text(code?.let { Countries.name(it, locale) } ?: "", style = JudgeType.body)
    }
    if (open) {
        AlertDialog(
            onDismissRequest = { open = false },
            title = { Text(s.ageWhere) },
            text = {
                LazyColumn(Modifier.testTag(AgeTags.COUNTRY_LIST)) {
                    items(options, key = { it.first }) { (value, name) ->
                        Text(
                            name,
                            style = JudgeType.body,
                            modifier = Modifier
                                .fillMaxWidth()
                                .defaultMinSize(minHeight = 48.dp)
                                .clickable { onPick(value); open = false }
                                .padding(vertical = 12.dp),
                        )
                    }
                }
            },
            confirmButton = {},
        )
    }
}

/** One answer of a yes/no question. */
@Composable
private fun Choice(label: String, selected: Boolean, enabled: Boolean, onClick: () -> Unit, tag: String) {
    Row(
        Modifier
            .fillMaxWidth()
            .defaultMinSize(minHeight = 48.dp)
            .selectable(selected = selected, enabled = enabled, role = Role.RadioButton, onClick = onClick)
            .testTag(tag),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        RadioButton(selected = selected, onClick = null, enabled = enabled)
        Text(label, style = JudgeType.body, modifier = Modifier.padding(start = 12.dp))
    }
}

/**
 * The store has not shown a parent's approval of a change yet (pending or declined): nothing past this
 * until Play says approved. Asking again is the only way forward besides signing out or deleting.
 */
@Composable
fun AgeApprovalScreen(
    busy: Boolean,
    onCheckAgain: () -> Unit,
    onSignOut: () -> Unit,
    onDelete: (String?) -> Unit,
    delete: DeleteUi = DeleteUi(),
) {
    val s = LocalStrings.current
    Cover(Modifier.testTag(AgeTags.APPROVAL)) {
        Text(s.ageApprovalTitle, style = JudgeType.sectionTitle, modifier = Modifier.semantics { heading() })
        Text(
            s.ageApproval,
            style = JudgeType.lead,
            modifier = Modifier.padding(top = 10.dp),
        )
        PrimaryButton(
            text = s.appRetry,
            enabled = !busy,
            onClick = onCheckAgain,
            modifier = Modifier.fillMaxWidth().padding(top = 28.dp).testTag(AgeTags.CHECK_AGAIN),
        )
        TextAction(
            s.accountSignOut,
            onClick = onSignOut,
            color = Palette.ink2,
            enabled = !busy,
            modifier = Modifier.padding(top = 14.dp).align(Alignment.CenterHorizontally).testTag(AgeTags.SIGN_OUT),
        )
        DeleteAccount(busy, delete, onDelete, Modifier.align(Alignment.CenterHorizontally))
    }
}

/** "Delete account" with the same confirmation as in Settings. */
@Composable
private fun DeleteAccount(busy: Boolean, delete: DeleteUi, onDelete: (String?) -> Unit, modifier: Modifier = Modifier) {
    val s = LocalStrings.current
    var confirm by rememberSaveable { mutableStateOf(false) }
    if (delete.failed && !confirm) ErrorNote(s.accountDeleteFailed)
    TextAction(s.accountDelete, onClick = { confirm = true }, color = Palette.danger, enabled = !busy, modifier = modifier.testTag(AgeTags.DELETE))
    if (confirm) {
        DeleteAccountDialog(
            ui = delete,
            busy = busy,
            billing = false,
            onDelete = onDelete,
            onManageSubscription = null,
            onDismiss = { confirm = false },
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

/** An ivory page over everything, taking every touch so nothing underneath reacts (no clickable: that would merge the whole page into one TalkBack item). */
@Composable
private fun Cover(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Box(
        modifier
            .fillMaxSize()
            .background(Palette.ivory)
            .pointerInput(Unit) { detectTapGestures { } }
            .safeDrawingPadding()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp),
        contentAlignment = Alignment.TopCenter,
    ) {
        Column(Modifier.widthIn(max = 480.dp).fillMaxWidth().padding(top = 48.dp, bottom = 32.dp), content = content)
    }
}
