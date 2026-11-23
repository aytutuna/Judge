package com.okjudge.judge.ui.signin

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.okjudge.judge.core.api.JudgeApi
import com.okjudge.judge.core.api.MemoryTokenStore
import com.okjudge.judge.core.auth.Account
import com.okjudge.judge.core.auth.FakeGoogle
import com.okjudge.judge.core.auth.GoogleIdResult
import com.okjudge.judge.core.auth.Routes
import com.okjudge.judge.core.auth.Routes.Companion.CONFIG
import com.okjudge.judge.core.auth.Routes.Companion.LOOKUP
import com.okjudge.judge.core.auth.Routes.Companion.PASSWORD_SIGN_IN
import com.okjudge.judge.core.auth.Routes.Companion.SET_PASSWORD
import com.okjudge.judge.core.auth.Routes.Companion.SEND_CODE
import com.okjudge.judge.core.auth.Routes.Companion.VERIFY_CODE
import com.okjudge.judge.core.auth.Routes.Companion.json
import com.okjudge.judge.core.auth.LastSignInStore
import com.okjudge.judge.core.auth.SignInError
import com.okjudge.judge.core.auth.SignInMethod
import com.okjudge.judge.i18n.AppLang
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import kotlinx.coroutines.withTimeout
import mockwebserver3.MockWebServer
import okhttp3.OkHttpClient
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class SignInViewModelTest {
    private lateinit var server: MockWebServer
    private val routes = Routes()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Unconfined)
    private val tokens = MemoryTokenStore()
    private val google = FakeGoogle(GoogleIdResult.Token("id"))
    private val context: Context = ApplicationProvider.getApplicationContext()
    private val last = LastSignInStore(context.getSharedPreferences(LastSignInStore.FILE, Context.MODE_PRIVATE))
    private lateinit var account: Account

    @Before
    fun setUp() {
        Dispatchers.setMain(Dispatchers.Unconfined)
        server = MockWebServer()
        server.dispatcher = routes
        server.start()
        routes.always(CONFIG, Routes.config(google = true, emailCode = true))
        routes.always(Routes.ME, Routes.me())
    }

    @After
    fun tearDown() {
        scope.cancel()
        server.close()
        Dispatchers.resetMain()
    }

    private fun vm(): SignInViewModel {
        val api = JudgeApi(server.url("/").toString(), OkHttpClient(), "ua", tokens)
        account = Account(api, tokens, google, scope)
        return SignInViewModel(account, last)
    }

    private suspend fun SignInViewModel.await(predicate: (SignInUiState) -> Boolean): SignInUiState =
        withTimeout(10_000) { state.first(predicate) }

    @Test
    fun continuing_countsAsTheConsent() = runBlocking {
        routes.always(SEND_CODE, json(200, """{"success":true}"""))
        val vm = vm()
        vm.await { it.providers is Account.Providers.Ready }
        assertFalse(account.ageTicked.value)
        assertTrue(vm.state.value.canGoogle)
        vm.onEmailChange("ada@example.com")
        vm.continueWithEmail(AppLang.EN)
        vm.await { it.step == SignInStep.CODE }
        assertTrue(account.ageTicked.value)
    }

    @Test
    fun loadsTheProviders() = runBlocking {
        val ready = vm().await { it.providers is Account.Providers.Ready }
        assertTrue(ready.showGoogle)
        assertTrue(ready.showEmail)
    }

    @Test
    fun aBadAddress_isCaughtBeforeAnyRequest() = runBlocking {
        val vm = vm()
        vm.onEmailChange("not-an-email")
        vm.continueWithEmail(AppLang.EN)
        assertEquals(SignInError.INVALID_EMAIL, vm.state.value.error)
        assertTrue(routes.requestsTo(SEND_CODE).isEmpty())
        vm.onEmailChange("ok@example.com")
        assertNull("typing clears the error", vm.state.value.error)
    }

    @Test
    fun codeFlow_emailThenCode_thenDone() = runBlocking {
        routes.always(SEND_CODE, json(200, """{"success":true}"""))
        routes.on(VERIFY_CODE, json(400, """{"message":"Invalid OTP","code":"INVALID_OTP"}"""))
        routes.on(VERIFY_CODE, Routes.grant("session"))
        val vm = vm()
        vm.onEmailChange(" ada@example.com ")
        vm.continueWithEmail(AppLang.TR)
        var s = vm.await { it.step == SignInStep.CODE && it.busy == null }
        assertEquals("ada@example.com", s.email)
        assertEquals("tr", routes.requestsTo(SEND_CODE).single().url.queryParameter("lang"))

        vm.onCodeChange("12a3 4-5")
        assertFalse("five digits are not a code", vm.state.value.canSubmitCode)
        vm.onCodeChange("1234567")
        assertEquals("123456", vm.state.value.code)

        // The sixth digit submits by itself.
        s = vm.await { it.busy == null && it.error != null }
        assertEquals(SignInError.CODE_INVALID, s.error)
        assertNull(tokens.get())

        vm.onCodeChange("654321")
        vm.await { it.done }
        assertEquals("session", tokens.get())
        assertEquals(2, routes.requestsTo(VERIFY_CODE).size)
        assertEquals(SignInMethod.EMAIL, last.method)
        assertEquals("ada@example.com", last.email)
    }

    @Test
    fun resend_waitsOutTheCountdown_andChangeEmailGoesBack() = runBlocking {
        routes.always(SEND_CODE, json(200, """{"success":true}"""))
        val vm = vm()
        vm.onEmailChange("ada@example.com")
        vm.continueWithEmail(AppLang.EN)
        vm.await { it.step == SignInStep.CODE && it.busy == null && it.resendIn > 0 }
        vm.resend(AppLang.EN)
        assertEquals(1, routes.requestsTo(SEND_CODE).size)
        vm.await { it.resendIn < SignInUiState.RESEND_SECONDS }

        vm.changeEmail()
        assertEquals(SignInStep.EMAIL, vm.state.value.step)
        assertEquals("ada@example.com", vm.state.value.email)
        assertEquals(0, vm.state.value.resendIn)
    }

    @Test
    fun theLastSignIn_prefillsTheAddress() = runBlocking {
        last.save(SignInMethod.GOOGLE, "ada@example.com")
        val s = vm().state.value
        assertEquals("ada@example.com", s.email)
        assertEquals(SignInMethod.GOOGLE, s.lastUsed)
    }

    private fun withPasswords() = routes.always(CONFIG, Routes.config(google = true, emailCode = true, password = true))

    /** From the address to the sixth digit of the emailed code, which submits it, by whichever path [mode] takes. */
    private suspend fun SignInViewModel.throughTheCode(mode: SignInMode, password: String? = null) {
        val method = when (mode) {
            SignInMode.CREATE -> "new"
            SignInMode.CODE -> "code"
            else -> "password"
        }
        routes.always(LOOKUP, json(200, """{"method":"$method"}"""))
        await { it.passwordSignIn }
        onEmailChange("ada@example.com")
        continueWithEmail(AppLang.EN)
        if (mode == SignInMode.CREATE) {
            await { it.step == SignInStep.PASSWORD }
            onPasswordChange(password!!)
            requestCode(AppLang.EN)
        }
        if (mode == SignInMode.FORGOT) {
            await { it.step == SignInStep.PASSWORD }
            forgotPassword(AppLang.EN)
        }
        await { it.step == SignInStep.CODE && it.busy == null }
        onCodeChange("123456")
    }

    @Test
    fun lookup_picksTheScreen() = runBlocking {
        withPasswords()
        routes.on(LOOKUP, json(200, """{"method":"password"}"""))
        routes.on(LOOKUP, json(200, """{"method":"new"}"""))
        routes.on(LOOKUP, json(503, """{"code":"unavailable"}"""))
        routes.always(SEND_CODE, json(200, """{"success":true}"""))
        val vm = vm()
        vm.await { it.passwordSignIn }
        vm.onEmailChange("ada@example.com")

        vm.continueWithEmail(AppLang.EN)
        var s = vm.await { it.step == SignInStep.PASSWORD }
        assertEquals(SignInMode.PASSWORD, s.mode)
        vm.changeEmail()

        vm.continueWithEmail(AppLang.EN)
        s = vm.await { it.step == SignInStep.PASSWORD }
        assertEquals(SignInMode.CREATE, s.mode)
        vm.changeEmail()

        // A failed lookup still leads to the password screen, which offers the code.
        vm.continueWithEmail(AppLang.EN)
        s = vm.await { it.step == SignInStep.PASSWORD }
        assertEquals(SignInMode.PASSWORD, s.mode)
        assertTrue(routes.requestsTo(SEND_CODE).isEmpty())
    }

    @Test
    fun lookup_codeAccount_sendsTheCodeAtOnce() = runBlocking {
        withPasswords()
        routes.always(LOOKUP, json(200, """{"method":"code"}"""))
        routes.always(SEND_CODE, json(200, """{"success":true}"""))
        val vm = vm()
        vm.await { it.passwordSignIn }
        vm.onEmailChange("ada@example.com")
        vm.continueWithEmail(AppLang.EN)
        val s = vm.await { it.step == SignInStep.CODE }
        assertEquals(SignInMode.CODE, s.mode)
    }

    @Test
    fun withoutPasswords_theCodeGoesOutWithoutALookup() = runBlocking {
        routes.always(SEND_CODE, json(200, """{"success":true}"""))
        val vm = vm()
        vm.await { it.providers is Account.Providers.Ready }
        vm.onEmailChange("ada@example.com")
        vm.continueWithEmail(AppLang.EN)
        vm.await { it.step == SignInStep.CODE }
        assertTrue(routes.requestsTo(LOOKUP).isEmpty())
    }

    @Test
    fun withoutPasswordsOnTheServer_onlyTheCodeIsOffered() = runBlocking {
        val s = vm().await { it.providers is Account.Providers.Ready }
        assertFalse(s.passwordSignIn)
        assertEquals(SignInMode.CODE, s.flow)
    }

    @Test
    fun passwordSignIn_failsAlike_thenSucceeds() = runBlocking {
        withPasswords()
        routes.on(PASSWORD_SIGN_IN, json(401, """{"message":"Invalid email or password","code":"INVALID_EMAIL_OR_PASSWORD"}"""))
        routes.on(PASSWORD_SIGN_IN, Routes.grant("pw-session"))
        val vm = vm()
        vm.await { it.passwordSignIn }
        assertEquals(SignInMode.PASSWORD, vm.state.value.flow)
        vm.onEmailChange(" ada@example.com ")
        assertFalse(vm.state.value.canSignInWithPassword)
        vm.onPasswordChange("made-up-pass")
        vm.signInWithPassword()
        val failed = vm.await { it.busy == null && it.error != null }
        assertEquals(SignInError.PASSWORD_WRONG, failed.error)
        assertNull(tokens.get())

        vm.signInWithPassword()
        vm.await { it.done }
        assertEquals("pw-session", tokens.get())
        assertTrue(routes.requestsTo(PASSWORD_SIGN_IN).last().body!!.utf8().contains("\"email\":\"ada@example.com\""))
        assertEquals("", vm.state.value.password)
        assertEquals(SignInMethod.EMAIL, last.method)
        assertEquals("ada@example.com", last.email)
    }

    @Test
    fun create_asksThePasswordFirst_thenCode_thenSavesIt() = runBlocking {
        withPasswords()
        routes.always(SEND_CODE, json(200, """{"success":true}"""))
        routes.on(VERIFY_CODE, Routes.grant("new-session"))
        routes.on(SET_PASSWORD, json(200, """{"ok":true}"""))
        routes.always(LOOKUP, json(200, """{"method":"new"}"""))
        val vm = vm()
        vm.await { it.passwordSignIn }
        vm.onEmailChange("ada@example.com")
        vm.continueWithEmail(AppLang.EN)
        vm.await { it.step == SignInStep.PASSWORD }
        assertFalse("create needs a password before the code", vm.state.value.canRequestCode)
        vm.onPasswordChange("short")
        vm.requestCode(AppLang.EN)
        assertEquals(SignInError.PASSWORD_SHORT, vm.state.value.error)
        assertTrue(routes.requestsTo(SEND_CODE).isEmpty())

        vm.onPasswordChange("made-up-pass")
        vm.requestCode(AppLang.EN)
        vm.await { it.step == SignInStep.CODE && it.busy == null }
        vm.onCodeChange("123456")
        vm.await { it.done }
        assertEquals("new-session", tokens.get())
        val save = routes.requestsTo(SET_PASSWORD).single()
        assertTrue(save.body!!.utf8().contains("made-up-pass"))
        assertFalse(save.body!!.utf8().contains("current"))
        assertEquals("Bearer new-session", save.headers["Authorization"])
    }

    @Test
    fun create_whenSavingFails_staysSignedInWithARetry() = runBlocking {
        withPasswords()
        routes.always(SEND_CODE, json(200, """{"success":true}"""))
        routes.on(VERIFY_CODE, Routes.grant("new-session"))
        routes.on(SET_PASSWORD, json(503, """{"code":"unavailable"}"""))
        routes.on(SET_PASSWORD, json(200, """{"ok":true}"""))
        val vm = vm()
        vm.throughTheCode(SignInMode.CREATE, "made-up-pass")
        val s = vm.await { it.step == SignInStep.CHOOSE_PASSWORD && it.busy == null && it.error != null }
        assertEquals(SignInError.UNAVAILABLE, s.error)
        assertFalse(s.done)
        assertEquals("new-session", tokens.get())

        vm.savePassword()
        assertTrue(vm.await { it.done }.done)
    }

    @Test
    fun forgot_signsInByCode_thenChoosesAPassword() = runBlocking {
        withPasswords()
        routes.always(SEND_CODE, json(200, """{"success":true}"""))
        routes.on(VERIFY_CODE, Routes.grant("reset-session"))
        routes.on(SET_PASSWORD, json(200, """{"ok":true}"""))
        val vm = vm()
        vm.throughTheCode(SignInMode.FORGOT)
        val choosing = vm.await { it.step == SignInStep.CHOOSE_PASSWORD && it.busy == null }
        assertFalse(choosing.done)
        assertTrue(routes.requestsTo(SET_PASSWORD).isEmpty())

        vm.onPasswordChange("short")
        vm.savePassword()
        assertEquals(SignInError.PASSWORD_SHORT, vm.state.value.error)
        vm.onPasswordChange("another-made-up")
        vm.savePassword()
        vm.await { it.done }
        assertEquals(1, routes.requestsTo(SET_PASSWORD).size)
    }

    @Test
    fun forgot_startsTheNewPasswordEmpty() = runBlocking {
        withPasswords()
        routes.always(LOOKUP, json(200, """{"method":"password"}"""))
        routes.always(SEND_CODE, json(200, """{"success":true}"""))
        val vm = vm()
        vm.await { it.passwordSignIn }
        vm.onEmailChange("ada@example.com")
        vm.continueWithEmail(AppLang.EN)
        vm.await { it.step == SignInStep.PASSWORD }
        vm.onPasswordChange("wrong-guess")
        vm.forgotPassword(AppLang.EN)
        val s = vm.await { it.step == SignInStep.CODE }
        assertEquals("", s.password)
    }

    @Test
    fun aFailedSend_takesTheConsentBack() = runBlocking {
        routes.always(SEND_CODE, json(503, """{"code":"unavailable"}"""))
        val vm = vm()
        vm.await { it.providers is Account.Providers.Ready }
        vm.onEmailChange("ada@example.com")
        vm.continueWithEmail(AppLang.EN)
        vm.await { it.busy == null && it.error != null }
        assertFalse(account.ageTicked.value)
    }

    @Test
    fun skippingThePassword_staysSignedIn() = runBlocking {
        withPasswords()
        routes.always(SEND_CODE, json(200, """{"success":true}"""))
        routes.on(VERIFY_CODE, Routes.grant("reset-session"))
        val vm = vm()
        vm.throughTheCode(SignInMode.FORGOT)
        vm.await { it.step == SignInStep.CHOOSE_PASSWORD && it.busy == null }
        vm.skipPassword()
        vm.await { it.done }
        assertEquals("reset-session", tokens.get())
        assertTrue(routes.requestsTo(SET_PASSWORD).isEmpty())
    }

    @Test
    fun forgot_whenTheSignInGrewOld_goesBackToTheCodeStep() = runBlocking {
        withPasswords()
        routes.always(SEND_CODE, json(200, """{"success":true}"""))
        routes.on(VERIFY_CODE, Routes.grant("reset-session"))
        routes.on(SET_PASSWORD, json(403, """{"code":"password_required"}"""))
        val vm = vm()
        vm.throughTheCode(SignInMode.FORGOT)
        vm.await { it.step == SignInStep.CHOOSE_PASSWORD && it.busy == null }
        vm.onPasswordChange("another-made-up")
        vm.savePassword()
        val s = vm.await { it.step == SignInStep.CODE && it.busy == null }
        assertEquals(SignInError.CODE_EXPIRED, s.error)
        assertFalse(s.done)
    }

    @Test
    fun codeMode_withAPassword_justSignsIn() = runBlocking {
        withPasswords()
        routes.always(SEND_CODE, json(200, """{"success":true}"""))
        routes.on(VERIFY_CODE, Routes.grant("code-session"))
        val vm = vm()
        vm.throughTheCode(SignInMode.CODE)
        vm.await { it.done }
        assertTrue(routes.requestsTo(SET_PASSWORD).isEmpty())
    }

    @Test
    fun codeMode_withoutAPassword_mustChooseOne() = runBlocking {
        withPasswords()
        routes.always(Routes.ME, Routes.me(needsPassword = true))
        routes.always(SEND_CODE, json(200, """{"success":true}"""))
        routes.on(VERIFY_CODE, Routes.grant("code-session"))
        routes.on(SET_PASSWORD, json(200, """{"ok":true}"""))
        val vm = vm()
        vm.throughTheCode(SignInMode.CODE)
        val choosing = vm.await { it.step == SignInStep.CHOOSE_PASSWORD && it.busy == null }
        assertFalse(choosing.done)
        vm.onPasswordChange("made-up-pass")
        vm.savePassword()
        vm.await { it.done }
        assertEquals(1, routes.requestsTo(SET_PASSWORD).size)
    }

    @Test
    fun createAccount_whenTheServerTakesNoPassword_stillSignsIn() = runBlocking {
        withPasswords()
        routes.always(SEND_CODE, json(200, """{"success":true}"""))
        routes.on(VERIFY_CODE, Routes.grant("code-session"))
        routes.on(SET_PASSWORD, json(403, """{"code":"invalid"}"""))
        val vm = vm()
        vm.throughTheCode(SignInMode.CREATE, "made-up-pass")
        val done =vm.await { it.done }
        assertNull(done.error)
        assertEquals(1, routes.requestsTo(SET_PASSWORD).size)
    }

    @Test
    fun codeMode_whenMeCannotBeRead_justSignsIn() = runBlocking {
        withPasswords()
        routes.always(Routes.ME, json(503, """{"code":"unavailable"}"""))
        routes.always(SEND_CODE, json(200, """{"success":true}"""))
        routes.on(VERIFY_CODE, Routes.grant("code-session"))
        val vm = vm()
        vm.throughTheCode(SignInMode.CODE)
        vm.await { it.done }
        assertTrue(routes.requestsTo(SET_PASSWORD).isEmpty())
    }

    @Test
    fun google_successAndCancel() = runBlocking {
        routes.on(Routes.GOOGLE, Routes.grant("g-session"))
        val vm = vm()
        val host = ApplicationProvider.getApplicationContext<Context>()
        google.result = GoogleIdResult.Cancelled
        vm.google(host)
        val cancelled = vm.await { it.busy == null }
        assertNull(cancelled.error)
        assertFalse(cancelled.done)

        google.result = GoogleIdResult.Token("id")
        vm.google(host)
        vm.await { it.done }
        assertEquals("g-session", tokens.get())
        assertEquals(SignInMethod.GOOGLE, last.method)
        assertEquals("ada@example.com", last.email)
    }
}
