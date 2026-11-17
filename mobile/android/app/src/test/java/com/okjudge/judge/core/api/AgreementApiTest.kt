package com.okjudge.judge.core.api

import com.okjudge.judge.core.display.UiError
import com.okjudge.judge.core.feedback.Agreement
import com.okjudge.judge.i18n.AppLang
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.yield
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.OkHttpClient
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class AgreementApiTest {
    private lateinit var server: MockWebServer

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
    }

    @After
    fun tearDown() = server.close()

    private class Tokens(private val token: String?) : TokenStore {
        override fun get(): String? = token
        override fun set(token: String) {}
        override fun clear() {}
        override fun user(): String? = null
        override fun setUser(id: String) {}
    }

    private fun api(token: String? = "tok", ask: suspend () -> Boolean) =
        JudgeApi(server.url("/").toString(), OkHttpClient(), "ua", tokenStore = Tokens(token), askAgreement = ask)

    private fun json(code: Int, body: String) =
        MockResponse.Builder().code(code).addHeader("Content-Type", "application/json").body(body).build()

    private val refused = json(403, """{"error":"Agree first.","code":"agreement_required"}""")
    private val started = json(202, """{"id":"v1","status":"judging","ownerToken":"o"}""")

    @Test
    fun aRefusedVerdictIsSentAgainOnceTheyAgree() = runBlocking {
        server.enqueue(refused)
        server.enqueue(started)
        var asked = 0
        val res = api(ask = { asked++; true }).startVerdictBody("""{"argument":"x"}""", "key-1")
        assertTrue(res is ApiResult.Ok)
        assertEquals(1, asked)
        assertEquals(2, server.requestCount)
        val first = server.takeRequest()
        val second = server.takeRequest()
        assertEquals("key-1", second.headers["Idempotency-Key"])
        assertEquals(first.body!!.utf8(), second.body!!.utf8())
    }

    @Test
    fun aDeclinedTickKeepsTheRefusal() = runBlocking {
        server.enqueue(refused)
        val res = api(ask = { false }).startVerdictBody("""{"argument":"x"}""", "key-1")
        val error = (res as ApiResult.Err).error as UiError.Api
        assertEquals("agreement_required", error.code)
        assertEquals(1, server.requestCount)
    }

    @Test
    fun aSecondRefusalIsNotAskedAgain() = runBlocking {
        server.enqueue(refused)
        server.enqueue(refused)
        var asked = 0
        val res = api(ask = { asked++; true }).startVerdictBody("""{"argument":"x"}""", null)
        assertTrue(res is ApiResult.Err)
        assertEquals(1, asked)
        assertEquals(2, server.requestCount)
    }

    @Test
    fun signedOutCallsAreNeverAsked() = runBlocking {
        server.enqueue(refused)
        var asked = 0
        val res = api(token = null, ask = { asked++; true }).startVerdictBody("""{"argument":"x"}""", null)
        assertTrue(res is ApiResult.Err)
        assertEquals(0, asked)
    }

    @Test
    fun agree_sendsTheLanguageAndPlatform() = runBlocking {
        server.enqueue(json(200, """{"agreed":true,"at":"2026-11-14T10:00:00.000Z"}"""))
        assertEquals(ApiResult.Ok(Unit), api(ask = { false }).agree(AppLang.TR))
        val sent = server.takeRequest()
        assertEquals("/api/v1/me/agreement", sent.url.encodedPath)
        val body = Json.parseToJsonElement(sent.body!!.utf8()).jsonObject
        assertEquals("tr", body["lang"]!!.jsonPrimitive.content)
        assertEquals("android", body["platform"]!!.jsonPrimitive.content)
    }

    @Test
    fun theSheetAnswersEveryCallWaitingOnIt() = runBlocking {
        server.enqueue(json(200, """{"agreed":true,"at":"2026-11-14T10:00:00.000Z"}"""))
        val agreement = Agreement(api(ask = { false }), CoroutineScope(Dispatchers.Unconfined))
        val one = async { agreement.ask() }
        val two = async { agreement.ask() }
        yield()
        assertTrue(agreement.state.value.open)
        agreement.confirm(AppLang.EN)
        assertTrue(one.await())
        assertTrue(two.await())
        assertFalse(agreement.state.value.open)
        assertEquals(1, server.requestCount)
    }

    @Test
    fun aFailedAgreementKeepsTheSheetOpenUntilDeclined() = runBlocking {
        server.enqueue(json(500, """{"error":"x"}"""))
        val agreement = Agreement(api(ask = { false }), CoroutineScope(Dispatchers.Unconfined))
        val asked = async { agreement.ask() }
        yield()
        agreement.confirm(AppLang.EN)
        withTimeout(5000) { while (!agreement.state.value.failed) delay(10) }
        assertTrue(agreement.state.value.open)
        agreement.decline()
        assertFalse(asked.await())
        assertFalse(agreement.state.value.open)
    }
}
