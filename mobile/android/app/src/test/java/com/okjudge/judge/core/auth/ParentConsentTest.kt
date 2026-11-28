package com.okjudge.judge.core.auth

import com.okjudge.judge.core.api.JudgeApi
import com.okjudge.judge.core.api.MemoryTokenStore
import com.okjudge.judge.core.auth.Routes.Companion.json
import com.okjudge.judge.core.display.UiError
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import mockwebserver3.MockWebServer
import okhttp3.OkHttpClient
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class ParentConsentTest {
    private lateinit var server: MockWebServer
    private val routes = Routes()
    private var refreshed = 0

    @Before
    fun setUp() {
        server = MockWebServer()
        server.dispatcher = routes
        server.start()
    }

    @After
    fun tearDown() = server.close()

    private fun consent() = ParentConsent(
        JudgeApi(server.url("/").toString(), OkHttpClient(), "Judge-Android/test (1)", MemoryTokenStore("session-1")),
    ) { refreshed++ }

    private fun view(sent: Boolean = true, resends: Int = 3, changes: Int = 3, expired: Boolean = false) =
        """{"status":"pending","sent":$sent,"emailHint":"m***@example.com","expiresAt":null,"expired":$expired,"resendsLeft":$resends,"changesLeft":$changes,"resendAt":null,"deleteAt":"2026-12-28T00:00:00.000Z"}"""

    @Test
    fun load_readsTheViewWithTheMaskedAddress() = runBlocking {
        routes.on("GET /api/v1/me/parent", json(200, view(resends = 0, expired = true)))
        val c = consent()
        c.load()
        val v = c.state.value.view!!
        assertEquals("m***@example.com", v.emailHint)
        assertEquals(0, v.resendsLeft)
        assertTrue(v.expired)
    }

    @Test
    fun send_postsTheAddress_keepsTheAnswer_andRefreshesTheAccount() = runBlocking {
        routes.on("POST /api/v1/me/parent", json(200, view()))
        val c = consent()
        c.send("  mum@example.com ")
        val body = Json.parseToJsonElement(routes.requestsTo("POST /api/v1/me/parent")[0].body!!.utf8()).jsonObject
        assertEquals("mum@example.com", body["email"]!!.jsonPrimitive.content)
        assertTrue(c.state.value.view!!.sent)
        assertNull(c.state.value.error)
        assertEquals(1, refreshed)
    }

    @Test
    fun resend_usesTheResendRoute() = runBlocking {
        routes.on("POST /api/v1/me/parent/resend", json(200, view(resends = 2)))
        val c = consent()
        c.resend()
        assertEquals(2, c.state.value.view!!.resendsLeft)
    }

    @Test
    fun failures_keepTheirCodeForTheMessage() = runBlocking {
        for ((status, code) in listOf(400 to "parent_email", 409 to "parent_declined", 409 to "parent_limit", 429 to "parent_wait", 503 to "unavailable")) {
            routes.on("POST /api/v1/me/parent", json(status, """{"error":"x","code":"$code","retryAfterSec":600}"""))
            val c = consent()
            c.send("mum@example.com")
            assertEquals(code, (c.state.value.error as UiError.Api).code)
            assertFalse(c.state.value.busy)
        }
        assertEquals(0, refreshed)
    }

    @Test
    fun aConflict_reloadsTheView() = runBlocking {
        routes.on("POST /api/v1/me/parent", json(409, """{"error":"x","code":"parent_conflict"}"""))
        routes.on("GET /api/v1/me/parent", json(200, view(changes = 1)))
        val c = consent()
        c.send("other@example.com")
        assertEquals("parent_conflict", (c.state.value.error as UiError.Api).code)
        assertEquals(1, c.state.value.view!!.changesLeft)
    }
}
