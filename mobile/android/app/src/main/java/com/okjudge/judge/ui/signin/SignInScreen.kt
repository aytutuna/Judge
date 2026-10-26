package com.okjudge.judge.ui.signin

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
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
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.autofill.ContentType
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
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
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withLink
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.okjudge.judge.R
import com.okjudge.judge.core.auth.Account
import com.okjudge.judge.core.auth.SignInError
import com.okjudge.judge.i18n.LocalStrings
import com.okjudge.judge.i18n.Strings
import com.okjudge.judge.ui.components.PrimaryButton
import com.okjudge.judge.ui.components.TextAction
import com.okjudge.judge.ui.components.TopBar
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
}

/** Everything the sign-in screen can ask for; no-ops by default (previews, screenshots). */
data class SignInActions(
    val onGoogle: () -> Unit = {},
    val onEmailChange: (String) -> Unit = {},
    val onRequestCode: () -> Unit = {},
    val onCodeChange: (String) -> Unit = {},
    val onSubmitCode: () -> Unit = {},
    val onResend: () -> Unit = {},
    val onChangeEmail: () -> Unit = {},
    val onRetryProviders: () -> Unit = {},
    val onOpenPrivacy: () -> Unit = {},
)

/**
 * Sign-in: Google and/or an emailed code, whichever the server offers, and
 * the consent line for the outside AI at the bottom.
 */
@Composable
fun SignInScreen(
    state: SignInUiState,
    onBack: (() -> Unit)?,
    onNew: (() -> Unit)?,
    actions: SignInActions,
    modifier: Modifier = Modifier,
) {
    val s = LocalStrings.current
    Column(modifier.fillMaxSize()) {
        TopBar(onBack = onBack, onNew = onNew)
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .imePadding()
                .padding(horizontal = 20.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Column(Modifier.widthIn(max = 480.dp).fillMaxWidth().padding(top = 12.dp, bottom = 32.dp)) {
                Text(s.signinTitle, style = JudgeType.display1.copy(fontSize = 36.sp, lineHeight = 38.sp).cappedScale())
                Text(s.appSigninRequired, style = JudgeType.lead, modifier = Modifier.padding(top = 10.dp, bottom = 28.dp))

                when (state.providers) {
                    Account.Providers.Loading -> Text(s.signinLoading, style = JudgeType.body.copy(color = Palette.muted))
                    Account.Providers.Failed -> Unavailable(s, onRetry = actions.onRetryProviders)
                    is Account.Providers.Ready -> if (state.noneAvailable) {
                        Unavailable(s, onRetry = actions.onRetryProviders)
                    } else {
                        if (state.showGoogle) {
                            GoogleButton(s.signinGoogle, enabled = state.busy == null, onClick = actions.onGoogle)
                        }
                        if (state.showGoogle && state.showEmail) OrDivider(s.appSigninOr)
                        if (state.showEmail) {
                            when (state.step) {
                                SignInStep.EMAIL -> EmailStep(state, actions)
                                SignInStep.CODE -> CodeStep(state, actions)
                            }
                        }
                    }
                }

                state.error?.let { ErrorNote(errorText(s, it)) }

                LegalLine(s, actions.onOpenPrivacy, Modifier.padding(top = 32.dp))
            }
        }
    }
}

fun errorText(s: Strings, error: SignInError): String = when (error) {
    SignInError.INVALID_EMAIL -> s.signinEmailInvalid
    SignInError.CODE_INVALID -> s.appSigninCodeInvalid
    SignInError.CODE_EXPIRED -> s.appSigninCodeExpired
    SignInError.CODE_TOO_MANY -> s.appSigninCodeTooMany
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
    Row(
        Modifier
            .fillMaxWidth()
            .defaultMinSize(minHeight = 54.dp)
            .clip(JudgeShapes.chip)
            .background(Palette.paper)
            .border(1.dp, Palette.line2, JudgeShapes.chip)
            .semantics { role = Role.Button }
            .clickable(enabled = enabled, onClick = onClick)
            .testTag(SignInTags.GOOGLE)
            .padding(horizontal = 24.dp, vertical = 15.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Center,
    ) {
        Image(painterResource(R.drawable.ic_google_g), contentDescription = null, modifier = Modifier.size(20.dp))
        Text(
            text,
            style = JudgeType.button.copy(color = if (enabled) Palette.ink else Palette.muted),
            modifier = Modifier.padding(start = 12.dp),
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
    Text(s.signinEmailLabel, style = JudgeType.slotTitle, modifier = Modifier.padding(bottom = 8.dp))
    Field(
        value = state.email,
        onChange = actions.onEmailChange,
        placeholder = s.signinEmailPlaceholder,
        keyboard = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Send, autoCorrectEnabled = false),
        onIme = actions.onRequestCode,
        modifier = Modifier.semantics { contentType = ContentType.EmailAddress }.testTag(SignInTags.EMAIL),
    )
    PrimaryButton(
        text = s.appSigninCodeRequest,
        enabled = state.canRequestCode,
        onClick = actions.onRequestCode,
        modifier = Modifier.fillMaxWidth().padding(top = 16.dp).testTag(SignInTags.REQUEST_CODE),
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
        textStyle = JudgeType.body.copy(fontSize = 24.sp, lineHeight = 30.sp, letterSpacing = 0.3.em),
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
private fun Field(
    value: String,
    onChange: (String) -> Unit,
    placeholder: String,
    keyboard: KeyboardOptions,
    onIme: () -> Unit,
    modifier: Modifier = Modifier,
    textStyle: TextStyle = JudgeType.body,
) {
    Box(
        Modifier
            .fillMaxWidth()
            .clip(JudgeShapes.field)
            .background(Palette.paper)
            .border(1.dp, Palette.line2, JudgeShapes.field)
            .padding(horizontal = 16.dp, vertical = 14.dp),
    ) {
        BasicTextField(
            value = value,
            onValueChange = onChange,
            textStyle = textStyle,
            singleLine = true,
            cursorBrush = SolidColor(Palette.terraInk),
            keyboardOptions = keyboard,
            keyboardActions = KeyboardActions(onAny = { onIme() }),
            modifier = modifier.fillMaxWidth(),
            decorationBox = { inner ->
                if (value.isEmpty()) Text(placeholder, style = textStyle.copy(color = Palette.placeholder))
                inner()
            },
        )
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

/** "An outside AI reads your arguments. By continuing you agree to the Privacy Policy." with the link tappable. */
@Composable
private fun LegalLine(s: Strings, onOpenPrivacy: () -> Unit, modifier: Modifier = Modifier) {
    val linkStyle = TextLinkStyles(SpanStyle(color = Palette.terraInk, textDecoration = TextDecoration.Underline))
    val text = buildAnnotatedString {
        append(s.signinLegal)
        append(" ")
        withLink(LinkAnnotation.Clickable(tag = "privacy", styles = linkStyle) { onOpenPrivacy() }) {
            append(s.signinLegalLink)
        }
        append(s.signinLegalAfter)
    }
    Text(
        text,
        style = JudgeType.footnote,
        textAlign = TextAlign.Center,
        modifier = modifier.fillMaxWidth().testTag(SignInTags.LEGAL),
    )
}
