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
import com.okjudge.judge.core.auth.Routes.Companion.PASSWORD_SIGN_IN
import com.okjudge.judge.core.auth.Routes.Companion.SET_PASSWORD
import com.okjudge.judge.core.auth.Routes.Companion.SEND_CODE
import com.okjudge.judge.core.auth.Routes.Companion.VERIFY_CODE
import com.okjudge.judge.core.auth.Routes.Companion.json
import com.okjudge.judge.core.auth.SignInError
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

    /** The 18+ box is ticked unless a test is about it. */
    private fun vm(ticked: Boolean = true): SignInViewModel {
        val api = JudgeApi(server.url("/").toString(), OkHttpClient(), "ua", tokens)
        return SignInViewModel(Account(api, tokens, google, scope)).also { it.onAgeTicked(ticked) }
    }

    private suspend fun SignInViewModel.await(predicate: (SignInUiState) -> Boolean): SignInUiState =
        withTimeout(10_000) { state.first(predicate) }

    @Test
    fun signInWaitsForThe18PlusBox() = runBlocking {
        val vm = vm(ticked = false)
        vm.await { it.providers is Account.Providers.Ready }
        vm.onEmailChange("ada@example.com")
        val unticked = vm.state.value
        assertTrue(unticked.ageNeeded)
        assertFalse(unticked.canGoogle)
        assertFalse(unticked.canRequestCode)
        vm.google(ApplicationProvider.getApplicationContext())
        vm.requestCode(AppLang.EN)
        assertEquals(0, google.calls)
        assertTrue(routes.requestsTo(SEND_CODE).isEmpty())

        vm.onAgeTicked(true)
        val ticked = vm.await { it.ageTicked }
        assertTrue(ticked.canGoogle)
        assertTrue(ticked.canRequestCode)
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
        vm.requestCode(AppLang.EN)
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
        vm.requestCode(AppLang.TR)
        var s = vm.await { it.step == SignInStep.CODE && it.busy == null }
        assertEquals("ada@example.com", s.email)
        assertEquals("tr", routes.requestsTo(SEND_CODE).single().url.queryParameter("lang"))

        vm.onCodeChange("12a3 4-5")
        assertFalse("five digits are not a code", vm.state.value.canSubmitCode)
        vm.onCodeChange("1234567")
        assertEquals("123456", vm.state.value.code)

        vm.submitCode()
        s = vm.await { it.busy == null && it.error != null }
        assertEquals(SignInError.CODE_INVALID, s.error)
        assertNull(tokens.get())

        vm.onCodeChange("654321")
        vm.submitCode()
        vm.await { it.done }
        assertEquals("session", tokens.get())
    }

    @Test
    fun resend_andChangeEmail() = runBlocking {
        routes.always(SEND_CODE, json(200, """{"success":true}"""))
        val vm = vm()
        vm.onEmailChange("ada@example.com")
        vm.requestCode(AppLang.EN)
        vm.await { it.step == SignInStep.CODE && it.busy == null }
        vm.onCodeChange("111")
        vm.resend(AppLang.EN)
        val s = vm.await { it.busy == null && routes.requestsTo(SEND_CODE).size == 2 }
        assertEquals("", s.code)
        assertEquals(SignInStep.CODE, s.step)

        vm.changeEmail()
        assertEquals(SignInStep.EMAIL, vm.state.value.step)
        assertEquals("ada@example.com", vm.state.value.email)
    }

    private fun withPasswords() = routes.always(CONFIG, Routes.config(google = true, emailCode = true, password = true))

    /** Create or forgot: the email, then the emailed code, up to the choose-password step or the end. */
    private suspend fun SignInViewModel.throughTheCode(mode: SignInMode, password: String? = null) {
        await { it.passwordSignIn }
        setMode(mode)
        onEmailChange("ada@example.com")
        if (password != null) onPasswordChange(password)
        requestCode(AppLang.EN)
        await { it.step == SignInStep.CODE && it.busy == null }
        onCodeChange("123456")
        submitCode()
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
    }

    @Test
    fun create_asksThePasswordFirst_thenCode_thenSavesIt() = runBlocking {
        withPasswords()
        routes.always(SEND_CODE, json(200, """{"success":true}"""))
        routes.on(VERIFY_CODE, Routes.grant("new-session"))
        routes.on(SET_PASSWORD, json(200, """{"ok":true}"""))
        val vm = vm()
        vm.await { it.passwordSignIn }
        vm.setMode(SignInMode.CREATE)
        vm.onEmailChange("ada@example.com")
        assertFalse("create needs a password before the code", vm.state.value.canRequestCode)
        vm.onPasswordChange("short")
        vm.requestCode(AppLang.EN)
        assertEquals(SignInError.PASSWORD_SHORT, vm.state.value.error)
        assertTrue(routes.requestsTo(SEND_CODE).isEmpty())

        vm.throughTheCode(SignInMode.CREATE, "made-up-pass")
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
    fun skippingTheNewPassword_finishesSignedIn() = runBlocking {
        withPasswords()
        routes.always(SEND_CODE, json(200, """{"success":true}"""))
        routes.on(VERIFY_CODE, Routes.grant("reset-session"))
        val vm = vm()
        vm.throughTheCode(SignInMode.FORGOT)
        vm.await { it.step == SignInStep.CHOOSE_PASSWORD && it.busy == null }
        vm.skipPassword()
        vm.await { it.done }
        assertEquals("reset-session", tokens.get())
    }

    @Test
    fun codeMode_neverAsksForAPassword() = runBlocking {
        withPasswords()
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
    }
}
