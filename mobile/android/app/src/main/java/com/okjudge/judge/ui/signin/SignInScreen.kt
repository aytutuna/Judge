package com.okjudge.judge.ui.signin

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.activity.compose.BackHandler
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.autofill.ContentType
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentType
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withLink
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.okjudge.judge.R
import com.okjudge.judge.core.auth.Account
import com.okjudge.judge.core.auth.SignInError
import com.okjudge.judge.core.auth.SignInMethod
import com.okjudge.judge.ui.components.GhostButton
import com.okjudge.judge.i18n.LocalStrings
import com.okjudge.judge.i18n.Strings
import com.okjudge.judge.ui.components.CardElevation
import com.okjudge.judge.ui.components.PrimaryButton
import com.okjudge.judge.ui.components.TextAction
import com.okjudge.judge.ui.components.TopBar
import com.okjudge.judge.ui.components.warmShadow
import com.okjudge.judge.ui.theme.JudgeShapes
import com.okjudge.judge.ui.theme.JudgeType
import com.okjudge.judge.ui.theme.Palette
import com.okjudge.judge.ui.theme.cappedScale

object SignInTags {
    const val GOOGLE = "signin.google"
    const val DEV = "signin.dev"
    const val EMAIL = "signin.email"
    const val CONTINUE = "signin.continue"
    const val REQUEST_CODE = "signin.requestCode"
    const val CODE = "signin.code"
    const val SUBMIT_CODE = "signin.submitCode"
    const val ERROR = "signin.error"
    const val LEGAL = "signin.legal"
    const val PASSWORD = "signin.password"
    const val SUBMIT_PASSWORD = "signin.submitPassword"
    const val FORGOT = "signin.forgot"
    const val USE_CODE = "signin.useCode"
    const val NEW_PASSWORD = "signin.newPassword"
    const val SAVE_PASSWORD = "signin.savePassword"
    const val SKIP = "signin.skip"
    const val RESEND = "signin.resend"
    const val LAST_USED = "signin.lastUsed"
}

/** Everything the sign-in screen can ask for; no-ops by default (previews, screenshots). */
data class SignInActions(
    val onGoogle: () -> Unit = {},
    val onEmailChange: (String) -> Unit = {},
    val onContinue: () -> Unit = {},
    val onRequestCode: () -> Unit = {},
    val onPasswordChange: (String) -> Unit = {},
    val onSignInWithPassword: () -> Unit = {},
    val onForgot: () -> Unit = {},
    val onUseCode: () -> Unit = {},
    val onSavePassword: () -> Unit = {},
    val onSkip: () -> Unit = {},
    val onCodeChange: (String) -> Unit = {},
    val onSubmitCode: () -> Unit = {},
    val onResend: () -> Unit = {},
    val onChangeEmail: () -> Unit = {},
    val onRetryProviders: () -> Unit = {},
    val onOpenTerms: () -> Unit = {},
    val onOpenPrivacy: () -> Unit = {},
    /** Set in debug builds only; the button is drawn when it is. */
    val onDevSignIn: (() -> Unit)? = null,
)

/**
 * Sign-in: Google and an email address, whichever the server offers. The
 * address leads to a password or an emailed code. The consent line (18+ and
 * the outside AI) sits at the bottom.
 */
@Composable
fun SignInScreen(
    state: SignInUiState,
    onBack: (() -> Unit)?,
    actions: SignInActions,
    modifier: Modifier = Modifier,
    forLink: Boolean = false,
) {
    val s = LocalStrings.current
    // Signed in by the code already: the password is the only way on.
    val choosing = state.step == SignInStep.CHOOSE_PASSWORD
    BackHandler(enabled = choosing) {}
    Column(modifier.fillMaxSize()) {
        TopBar(onBack = if (choosing) null else onBack, backLabel = s.appClose)
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .imePadding()
                .padding(horizontal = 20.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Column(Modifier.widthIn(max = 480.dp).fillMaxWidth().padding(top = 12.dp, bottom = 32.dp)) {
                Text(s.signinTitle, style = JudgeType.display1.cappedScale())
                Text(if (forLink) s.appSigninLink else s.appSigninRequired, style = JudgeType.lead, modifier = Modifier.padding(top = 10.dp, bottom = 28.dp))

                Column(
                    Modifier
                        .fillMaxWidth()
                        .warmShadow(CardElevation, JudgeShapes.card)
                        .clip(JudgeShapes.card)
                        .background(Palette.paper)
                        .border(1.dp, Palette.line, JudgeShapes.card)
                        .padding(20.dp),
                ) {
                    when (state.providers) {
                        Account.Providers.Loading -> Text(s.signinLoading, style = JudgeType.body.copy(color = Palette.muted))
                        Account.Providers.Failed -> Unavailable(s, onRetry = actions.onRetryProviders)
                        is Account.Providers.Ready -> if (state.noneAvailable) {
                            Unavailable(s, onRetry = actions.onRetryProviders)
                        } else {
                            if (state.showGoogle && state.step == SignInStep.EMAIL) {
                                GoogleButton(s.signinGoogle, enabled = state.canGoogle, lastUsed = state.lastUsed == SignInMethod.GOOGLE, onClick = actions.onGoogle)
                            }
                            if (state.showGoogle && state.showEmail && state.step == SignInStep.EMAIL) OrDivider(s.appSigninOr)
                            if (state.showEmail) {
                                when (state.step) {
                                    SignInStep.EMAIL -> EmailStep(state, actions)
                                    SignInStep.PASSWORD -> PasswordStep(state, actions)
                                    SignInStep.CODE -> CodeStep(state, actions)
                                    SignInStep.CHOOSE_PASSWORD -> ChoosePasswordStep(state, actions)
                                }
                            }
                        }
                    }

                    state.error?.let { ErrorNote(errorText(s, it)) }
                }

                actions.onDevSignIn?.let {
                    GhostButton(s.signinDev, null, it, Modifier.padding(top = 16.dp).testTag(SignInTags.DEV), enabled = state.busy == null)
                }

                LegalLine(s, actions.onOpenTerms, actions.onOpenPrivacy, Modifier.padding(top = 32.dp))
            }
        }
    }
}

fun errorText(s: Strings, error: SignInError): String = when (error) {
    SignInError.INVALID_EMAIL -> s.signinEmailInvalid
    SignInError.CODE_INVALID -> s.appSigninCodeInvalid
    SignInError.CODE_EXPIRED -> s.appSigninCodeExpired
    SignInError.CODE_TOO_MANY -> s.appSigninCodeTooMany
    SignInError.PASSWORD_WRONG -> s.signinPasswordWrong
    SignInError.PASSWORD_SHORT -> s.signinPasswordShort
    SignInError.PASSWORD_SAVE_FAILED, SignInError.PASSWORD_NOT_TAKEN -> s.signinPasswordSaveFailed
    SignInError.CURRENT_PASSWORD_WRONG -> s.errorPasswordWrong
    SignInError.CURRENT_PASSWORD_REQUIRED -> s.errorPasswordRequired
    SignInError.RATE_LIMITED -> s.appSigninRateLimited
    SignInError.UNAVAILABLE -> s.appSigninUnavailable
    SignInError.PROVIDER_UNAVAILABLE -> s.signinProviderUnavailable
    SignInError.OFFLINE -> s.appErrorOffline
    SignInError.FAILED -> s.signinFailed
}

@Composable
private fun Unavailable(s: Strings, onRetry: () -> Unit) {
    Column {
        Text(s.appSigninUnavailable, style = JudgeType.body.copy(color = Palette.ink2))
        TextAction(s.appRetry, onClick = onRetry, modifier = Modifier.padding(top = 8.dp))
    }
}

@Composable
private fun GoogleButton(text: String, enabled: Boolean, lastUsed: Boolean, onClick: () -> Unit) {
    Box {
        OutlinePill(
            text,
            enabled,
            onClick,
            Modifier.testTag(SignInTags.GOOGLE),
            icon = { Image(painterResource(R.drawable.ic_google_g), contentDescription = null, modifier = Modifier.size(20.dp)) },
        )
        // On the button's edge, so a long translation of the label never runs into it.
        if (lastUsed) LastUsedTag(Modifier.align(Alignment.TopEnd).padding(end = 16.dp).offset(y = (-9).dp))
    }
}

@Composable
private fun LastUsedTag(modifier: Modifier = Modifier) {
    Text(
        LocalStrings.current.signinLastUsed,
        style = JudgeType.footnote.copy(fontSize = 11.sp, lineHeight = 14.sp, color = Palette.terraInk),
        modifier = modifier
            .clip(JudgeShapes.chip)
            .background(Palette.terraTint)
            .padding(horizontal = 8.dp, vertical = 2.dp)
            .testTag(SignInTags.LAST_USED),
    )
}

@Composable
private fun OutlinePill(
    text: String,
    enabled: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    icon: (@Composable () -> Unit)? = null,
) {
    Row(
        modifier
            .fillMaxWidth()
            .defaultMinSize(minHeight = 54.dp)
            .clip(JudgeShapes.chip)
            .background(Palette.paper)
            .border(1.dp, Palette.line2, JudgeShapes.chip)
            .semantics { role = Role.Button }
            .clickable(enabled = enabled, onClick = onClick)
            .padding(horizontal = 24.dp, vertical = 15.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Center,
    ) {
        if (icon != null) icon()
        Text(
            text,
            style = JudgeType.button.copy(color = if (enabled) Palette.ink else Palette.muted),
            modifier = Modifier.padding(start = if (icon != null) 12.dp else 0.dp),
        )
    }
}

@Composable
private fun OrDivider(text: String) {
    Row(Modifier.fillMaxWidth().padding(vertical = 22.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.weight(1f).height(1.dp).background(Palette.line2))
        Text(text, style = JudgeType.footnote, modifier = Modifier.padding(horizontal = 14.dp))
        Box(Modifier.weight(1f).height(1.dp).background(Palette.line2))
    }
}

@Composable
private fun EmailStep(state: SignInUiState, actions: SignInActions) {
    val s = LocalStrings.current
    Row(Modifier.fillMaxWidth().padding(bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(s.signinEmailLabel, style = JudgeType.slotTitle, modifier = Modifier.weight(1f))
        if (state.lastUsed == SignInMethod.EMAIL) LastUsedTag()
    }
    Field(
        value = state.email,
        onChange = actions.onEmailChange,
        placeholder = s.signinEmailPlaceholder,
        keyboard = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Go, autoCorrectEnabled = false),
        onIme = actions.onContinue,
        enabled = state.busy == null,
        modifier = Modifier.semantics { contentType = ContentType.Username + ContentType.EmailAddress }.testTag(SignInTags.EMAIL),
    )
    PrimaryButton(
        text = s.signinContinue,
        enabled = state.canContinue,
        onClick = actions.onContinue,
        modifier = Modifier.fillMaxWidth().padding(top = 16.dp).testTag(SignInTags.CONTINUE),
    )
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun PasswordStep(state: SignInUiState, actions: SignInActions) {
    val s = LocalStrings.current
    val creating = state.flow == SignInMode.CREATE
    Text(state.email, style = JudgeType.bodyStrong)
    TextAction(
        s.appSigninChangeEmail,
        onClick = { if (state.busy == null) actions.onChangeEmail() },
        color = Palette.ink2,
        modifier = Modifier.padding(bottom = 10.dp),
    )
    Text(
        if (creating) s.signinPasswordNew else s.signinPassword,
        style = JudgeType.slotTitle,
        modifier = Modifier.padding(bottom = 8.dp),
    )
    PasswordField(
        value = state.password,
        onChange = actions.onPasswordChange,
        autofill = if (creating) ContentType.NewPassword else ContentType.Password,
        onDone = if (creating) actions.onRequestCode else actions.onSignInWithPassword,
        modifier = Modifier.testTag(if (creating) SignInTags.NEW_PASSWORD else SignInTags.PASSWORD),
    )
    if (creating) {
        PrimaryButton(
            text = s.signinContinue,
            enabled = state.canRequestCode,
            onClick = actions.onRequestCode,
            modifier = Modifier.fillMaxWidth().padding(top = 16.dp).testTag(SignInTags.REQUEST_CODE),
        )
        return
    }
    PrimaryButton(
        text = s.signinPasswordSubmit,
        enabled = state.canSignInWithPassword,
        onClick = actions.onSignInWithPassword,
        modifier = Modifier.fillMaxWidth().padding(top = 16.dp).testTag(SignInTags.SUBMIT_PASSWORD),
    )
    FlowRow(Modifier.fillMaxWidth().padding(top = 10.dp), horizontalArrangement = Arrangement.SpaceBetween) {
        TextAction(s.signinForgot, onClick = actions.onForgot, modifier = Modifier.testTag(SignInTags.FORGOT))
        TextAction(s.signinUseCode, onClick = actions.onUseCode, color = Palette.ink2, modifier = Modifier.testTag(SignInTags.USE_CODE))
    }
}

@Composable
private fun ChoosePasswordStep(state: SignInUiState, actions: SignInActions) {
    val s = LocalStrings.current
    Text(s.signinPasswordChoose, style = JudgeType.body.copy(color = Palette.ink2), modifier = Modifier.padding(bottom = 18.dp))
    Text(s.signinPasswordNew, style = JudgeType.slotTitle, modifier = Modifier.padding(bottom = 8.dp))
    PasswordField(
        value = state.password,
        onChange = actions.onPasswordChange,
        autofill = ContentType.NewPassword,
        onDone = actions.onSavePassword,
        modifier = Modifier.testTag(SignInTags.NEW_PASSWORD),
    )
    PrimaryButton(
        text = if (state.error == null) s.signinPasswordSave else s.appRetry,
        enabled = state.canSavePassword,
        onClick = actions.onSavePassword,
        modifier = Modifier.fillMaxWidth().padding(top = 16.dp).testTag(SignInTags.SAVE_PASSWORD),
    )
    TextAction(
        s.signinSkip,
        onClick = { if (state.busy == null) actions.onSkip() },
        color = Palette.ink2,
        modifier = Modifier.padding(top = 6.dp).testTag(SignInTags.SKIP),
    )
}

/** A password box with a show switch; [autofill] tells password managers which kind it is. */
@Composable
internal fun PasswordField(
    value: String,
    onChange: (String) -> Unit,
    autofill: ContentType,
    onDone: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val s = LocalStrings.current
    var shown by remember { mutableStateOf(false) }
    Field(
        value = value,
        onChange = onChange,
        placeholder = "",
        keyboard = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done, autoCorrectEnabled = false),
        onIme = onDone,
        modifier = modifier.semantics { contentType = autofill },
        visualTransformation = if (shown) VisualTransformation.None else PasswordVisualTransformation(),
        trailing = {
            Text(
                s.signinPasswordShow,
                style = JudgeType.footnote.copy(color = if (shown) Palette.terraInk else Palette.muted),
                modifier = Modifier
                    .padding(start = 12.dp)
                    .toggleable(value = shown, role = Role.Switch, onValueChange = { shown = it }),
            )
        },
    )
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun CodeStep(state: SignInUiState, actions: SignInActions) {
    val s = LocalStrings.current
    Text(
        s.appSigninCodeSent(state.email),
        style = JudgeType.body.copy(color = Palette.ink2),
        modifier = Modifier.padding(bottom = 18.dp),
    )
    Text(s.appSigninCodeLabel, style = JudgeType.slotTitle, modifier = Modifier.padding(bottom = 8.dp))
    Field(
        value = state.code,
        onChange = actions.onCodeChange,
        placeholder = "000000",
        keyboard = KeyboardOptions(keyboardType = KeyboardType.NumberPassword, imeAction = ImeAction.Done, autoCorrectEnabled = false),
        onIme = actions.onSubmitCode,
        enabled = state.busy == null,
        textStyle = JudgeType.body.copy(
            fontFamily = FontFamily.Monospace,
            fontWeight = FontWeight.SemiBold,
            fontSize = 28.sp,
            lineHeight = 34.sp,
            letterSpacing = 8.sp,
            textAlign = TextAlign.Center,
        ),
        minHeight = 60.dp,
        align = Alignment.Center,
        modifier = Modifier.semantics { contentType = ContentType.SmsOtpCode }.testTag(SignInTags.CODE),
    )
    PrimaryButton(
        text = s.appSigninCodeSubmit,
        enabled = state.canSubmitCode,
        onClick = actions.onSubmitCode,
        modifier = Modifier.fillMaxWidth().padding(top = 16.dp).testTag(SignInTags.SUBMIT_CODE),
    )
    FlowRow(
        Modifier.fillMaxWidth().padding(top = 10.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        TextAction(
            if (state.resendIn > 0) s.signinCodeResendIn(state.resendIn.toString()) else s.appSigninCodeResend,
            onClick = actions.onResend,
            enabled = state.busy == null && state.resendIn == 0,
            modifier = Modifier.testTag(SignInTags.RESEND),
        )
        TextAction(s.appSigninChangeEmail, onClick = { if (state.busy == null) actions.onChangeEmail() }, color = Palette.ink2)
    }
}

@Composable
internal fun Field(
    value: String,
    onChange: (String) -> Unit,
    placeholder: String,
    keyboard: KeyboardOptions,
    onIme: () -> Unit,
    modifier: Modifier = Modifier,
    textStyle: TextStyle = JudgeType.body,
    minHeight: Dp = 52.dp,
    align: Alignment = Alignment.CenterStart,
    visualTransformation: VisualTransformation = VisualTransformation.None,
    trailing: (@Composable () -> Unit)? = null,
    enabled: Boolean = true,
) {
    var focused by remember { mutableStateOf(false) }
    Box(
        Modifier
            .fillMaxWidth()
            .defaultMinSize(minHeight = minHeight)
            .clip(JudgeShapes.field)
            .background(Palette.paper)
            .border(1.dp, if (focused) Palette.terraInk else Palette.line2, JudgeShapes.field)
            .padding(horizontal = 16.dp, vertical = 14.dp),
        contentAlignment = Alignment.CenterStart,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            BasicTextField(
                value = value,
                onValueChange = onChange,
                enabled = enabled,
                textStyle = textStyle,
                singleLine = true,
                cursorBrush = SolidColor(Palette.terraInk),
                keyboardOptions = keyboard,
                keyboardActions = KeyboardActions(onAny = { onIme() }),
                visualTransformation = visualTransformation,
                modifier = modifier.weight(1f).onFocusChanged { focused = it.isFocused },
                decorationBox = { inner ->
                    Box(Modifier.fillMaxWidth(), contentAlignment = align) {
                        if (value.isEmpty()) Text(placeholder, style = textStyle.copy(color = Palette.placeholder))
                        inner()
                    }
                },
            )
            trailing?.invoke()
        }
    }
}

@Composable
private fun ErrorNote(text: String) {
    Text(
        text,
        style = JudgeType.body.copy(fontSize = 14.5.sp, lineHeight = 21.sp, color = Palette.ink),
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 20.dp)
            .clip(JudgeShapes.field)
            .background(Palette.terraTint)
            .border(1.dp, Palette.terra.copy(alpha = 0.4f), JudgeShapes.field)
            .semantics { liveRegion = LiveRegionMode.Polite }
            .testTag(SignInTags.ERROR)
            .padding(horizontal = 16.dp, vertical = 12.dp),
    )
}

/** "By continuing, you confirm you're 18 or older and agree to the Terms and the Privacy Policy. An outside AI reads your arguments." with both links tappable. */
@Composable
private fun LegalLine(s: Strings, onOpenTerms: () -> Unit, onOpenPrivacy: () -> Unit, modifier: Modifier = Modifier) {
    val linkStyle = TextLinkStyles(SpanStyle(color = Palette.terraInk, textDecoration = TextDecoration.Underline))
    val text = buildAnnotatedString {
        append(s.appSigninLegal)
        withLink(LinkAnnotation.Clickable(tag = "terms", styles = linkStyle) { onOpenTerms() }) {
            append(s.appSigninLegalTerms)
        }
        append(s.appSigninLegalAnd)
        withLink(LinkAnnotation.Clickable(tag = "privacy", styles = linkStyle) { onOpenPrivacy() }) {
            append(s.appSigninLegalPrivacy)
        }
        append(s.appSigninLegalAfter)
    }
    Text(
        text,
        style = JudgeType.footnote,
        textAlign = TextAlign.Center,
        modifier = modifier.fillMaxWidth().testTag(SignInTags.LEGAL),
    )
}
