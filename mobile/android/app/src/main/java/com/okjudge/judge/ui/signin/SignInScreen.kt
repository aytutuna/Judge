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
import com.okjudge.judge.i18n.LocalStrings
import com.okjudge.judge.i18n.Strings
import com.okjudge.judge.ui.age.AgeCheckbox
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
    const val EMAIL = "signin.email"
    const val REQUEST_CODE = "signin.requestCode"
    const val CODE = "signin.code"
    const val SUBMIT_CODE = "signin.submitCode"
    const val ERROR = "signin.error"
    const val LEGAL = "signin.legal"
    const val PASSWORD = "signin.password"
    const val SUBMIT_PASSWORD = "signin.submitPassword"
    const val FORGOT = "signin.forgot"
    const val CREATE = "signin.create"
    const val USE_CODE = "signin.useCode"
    const val USE_PASSWORD = "signin.usePassword"
    const val NEW_PASSWORD = "signin.newPassword"
    const val SAVE_PASSWORD = "signin.savePassword"
    const val SKIP_PASSWORD = "signin.skipPassword"
}

/** Everything the sign-in screen can ask for; no-ops by default (previews, screenshots). */
data class SignInActions(
    val onGoogle: () -> Unit = {},
    val onEmailChange: (String) -> Unit = {},
    val onRequestCode: () -> Unit = {},
    val onPasswordChange: (String) -> Unit = {},
    val onSignInWithPassword: () -> Unit = {},
    val onMode: (SignInMode) -> Unit = {},
    val onSavePassword: () -> Unit = {},
    val onSkipPassword: () -> Unit = {},
    val onCodeChange: (String) -> Unit = {},
    val onSubmitCode: () -> Unit = {},
    val onResend: () -> Unit = {},
    val onChangeEmail: () -> Unit = {},
    val onRetryProviders: () -> Unit = {},
    val onAgeTicked: (Boolean) -> Unit = {},
    val onOpenTerms: () -> Unit = {},
    val onOpenPrivacy: () -> Unit = {},
)

/**
 * Sign-in: Google, a password and/or an emailed code, whichever the server offers, the
 * 18+ checkbox above them unless the phone already said 18+, and the consent
 * line for the outside AI at the bottom.
 */
@Composable
fun SignInScreen(
    state: SignInUiState,
    onBack: (() -> Unit)?,
    actions: SignInActions,
    modifier: Modifier = Modifier,
) {
    val s = LocalStrings.current
    // Signed in by the code already: leaving this step skips the password and goes on.
    val choosing = state.step == SignInStep.CHOOSE_PASSWORD
    BackHandler(enabled = choosing, onBack = actions.onSkipPassword)
    Column(modifier.fillMaxSize()) {
        TopBar(onBack = if (choosing) actions.onSkipPassword else onBack)
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
                Text(s.appSigninRequired, style = JudgeType.lead, modifier = Modifier.padding(top = 10.dp, bottom = 28.dp))

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
                            if (state.ageNeeded && state.step == SignInStep.EMAIL) {
                                AgeCheckbox(state.ageTicked, actions.onAgeTicked, Modifier.padding(bottom = 14.dp), enabled = state.busy == null)
                            }
                            if (state.showGoogle && !choosing) {
                                GoogleButton(s.signinGoogle, enabled = state.canGoogle, onClick = actions.onGoogle)
                            }
                            if (state.showGoogle && state.showEmail && !choosing) OrDivider(s.appSigninOr)
                            if (state.showEmail) {
                                when (state.step) {
                                    SignInStep.EMAIL -> EmailStep(state, actions)
                                    SignInStep.CODE -> CodeStep(state, actions)
                                    SignInStep.CHOOSE_PASSWORD -> ChoosePasswordStep(state, actions)
                                }
                            }
                        }
                    }

                    state.error?.let { ErrorNote(errorText(s, it)) }
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
    SignInError.PASSWORD_SAVE_FAILED -> s.signinPasswordSaveFailed
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
private fun GoogleButton(text: String, enabled: Boolean, onClick: () -> Unit) {
    OutlinePill(
        text,
        enabled,
        onClick,
        Modifier.testTag(SignInTags.GOOGLE),
        icon = { Image(painterResource(R.drawable.ic_google_g), contentDescription = null, modifier = Modifier.size(20.dp)) },
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

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun EmailStep(state: SignInUiState, actions: SignInActions) {
    val s = LocalStrings.current
    val focus = LocalFocusManager.current
    val flow = state.flow
    val passwordNext = flow == SignInMode.PASSWORD || flow == SignInMode.CREATE
    Text(s.signinEmailLabel, style = JudgeType.slotTitle, modifier = Modifier.padding(bottom = 8.dp))
    Field(
        value = state.email,
        onChange = actions.onEmailChange,
        placeholder = s.signinEmailPlaceholder,
        keyboard = KeyboardOptions(
            keyboardType = KeyboardType.Email,
            imeAction = if (passwordNext) ImeAction.Next else ImeAction.Send,
            autoCorrectEnabled = false,
        ),
        onIme = if (passwordNext) ({ focus.moveFocus(FocusDirection.Down); Unit }) else actions.onRequestCode,
        modifier = Modifier
            .semantics {
                contentType = when (flow) {
                    SignInMode.PASSWORD -> ContentType.Username
                    SignInMode.CREATE -> ContentType.NewUsername
                    else -> ContentType.EmailAddress
                }
            }
            .testTag(SignInTags.EMAIL),
    )
    if (flow == SignInMode.PASSWORD) {
        Text(s.signinPassword, style = JudgeType.slotTitle, modifier = Modifier.padding(top = 16.dp, bottom = 8.dp))
        PasswordField(
            value = state.password,
            onChange = actions.onPasswordChange,
            autofill = ContentType.Password,
            onDone = actions.onSignInWithPassword,
            modifier = Modifier.testTag(SignInTags.PASSWORD),
        )
        PrimaryButton(
            text = s.signinPasswordSubmit,
            enabled = state.canSignInWithPassword,
            onClick = actions.onSignInWithPassword,
            modifier = Modifier.fillMaxWidth().padding(top = 16.dp).testTag(SignInTags.SUBMIT_PASSWORD),
        )
        FlowRow(Modifier.fillMaxWidth().padding(top = 10.dp), horizontalArrangement = Arrangement.SpaceBetween) {
            TextAction(s.signinForgot, onClick = { actions.onMode(SignInMode.FORGOT) }, modifier = Modifier.testTag(SignInTags.FORGOT))
            TextAction(s.signinCreate, onClick = { actions.onMode(SignInMode.CREATE) }, modifier = Modifier.testTag(SignInTags.CREATE))
        }
        TextAction(
            s.signinUseCode,
            onClick = { actions.onMode(SignInMode.CODE) },
            color = Palette.ink2,
            modifier = Modifier.testTag(SignInTags.USE_CODE),
        )
        return
    }
    if (flow == SignInMode.CREATE) {
        Text(s.signinPasswordNew, style = JudgeType.slotTitle, modifier = Modifier.padding(top = 16.dp, bottom = 8.dp))
        PasswordField(
            value = state.password,
            onChange = actions.onPasswordChange,
            autofill = ContentType.NewPassword,
            onDone = actions.onRequestCode,
            modifier = Modifier.testTag(SignInTags.NEW_PASSWORD),
        )
        Text(s.signinCreateNote, style = JudgeType.footnote, modifier = Modifier.padding(top = 10.dp))
    }
    OutlinePill(
        text = s.appSigninCodeRequest,
        enabled = state.canRequestCode,
        onClick = actions.onRequestCode,
        modifier = Modifier.padding(top = 16.dp).testTag(SignInTags.REQUEST_CODE),
    )
    if (state.passwordSignIn) {
        TextAction(
            s.signinUsePassword,
            onClick = { actions.onMode(SignInMode.PASSWORD) },
            color = Palette.ink2,
            modifier = Modifier.padding(top = 6.dp).testTag(SignInTags.USE_PASSWORD),
        )
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
        text = s.signinPasswordSave,
        enabled = state.canSavePassword,
        onClick = actions.onSavePassword,
        modifier = Modifier.fillMaxWidth().padding(top = 16.dp).testTag(SignInTags.SAVE_PASSWORD),
    )
    TextAction(
        s.signinPasswordSkip,
        onClick = actions.onSkipPassword,
        color = Palette.ink2,
        modifier = Modifier.padding(top = 6.dp).testTag(SignInTags.SKIP_PASSWORD),
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
        modifier = Modifier.testTag(SignInTags.CODE),
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
        TextAction(s.appSigninCodeResend, onClick = { if (state.busy == null) actions.onResend() })
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

/** "An outside AI reads your arguments. By continuing you agree to the Terms and Privacy Policy." with both links tappable. */
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
