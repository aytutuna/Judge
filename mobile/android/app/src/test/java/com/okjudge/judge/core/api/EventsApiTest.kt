package com.okjudge.judge.core.api

import com.okjudge.judge.core.analytics.Delivery
import kotlinx.coroutines.runBlocking
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.OkHttpClient
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test

/** POST /api/v1/events and the device headers at sign-in. */
class EventsApiTest {
    private lateinit var server: MockWebServer

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
    }

    @After
    fun tearDown() = server.close()

    private fun api(tokens: TokenStore = NoTokenStore, deviceId: String? = null) =
        JudgeApi(server.url("/").toString(), OkHttpClient(), "Judge-Android/test (1)", tokens, deviceId = deviceId)

    @Test
    fun events_goOutAsJson_withTheSession() = runBlocking {
        server.enqueue(MockResponse.Builder().code(204).build())
        val body = """{"context":{"platform":"android"},"events":[]}"""
        assertEquals(Delivery.SENT, api(MemoryTokenStore("s3ss10n")).sendEvents(body))
        val recorded = server.takeRequest()
        assertEquals("POST", recorded.method)
        assertEquals("/api/v1/events", recorded.url.encodedPath)
        assertEquals("application/json", recorded.headers["Content-Type"])
        assertEquals("Bearer s3ss10n", recorded.headers["Authorization"])
        assertEquals(body, recorded.body!!.utf8())
    }

    @Test
    fun statuses_mapToDeliveries() = runBlocking {
        for ((status, want) in listOf(400 to Delivery.REJECTED, 429 to Delivery.FAILED, 503 to Delivery.FAILED)) {
            server.enqueue(MockResponse.Builder().code(status).build())
            assertEquals("$status", want, api().sendEvents("{}"))
        }
        server.close()
        assertEquals(Delivery.FAILED, api().sendEvents("{}"))
    }

    @Test
    fun aDeadSessionOnEvents_doesNotSignOut() = runBlocking {
        val tokens = MemoryTokenStore("old")
        server.enqueue(MockResponse.Builder().code(401).body("""{"error":"Sign in first.","code":"signin_required"}""").build())
        assertEquals(Delivery.FAILED, api(tokens).sendEvents("{}"))
        assertEquals("old", tokens.get())
    }

    @Test
    fun signIn_carriesTheDevice_otherAuthCallsDoNot() = runBlocking {
        server.enqueue(MockResponse.Builder().code(200).addHeader("Content-Type", "application/json").body("""{"token":"t0k3n"}""").build())
        server.enqueue(MockResponse.Builder().code(200).addHeader("Content-Type", "application/json").body("{}").build())
        val api = api(deviceId = "3f2a9c1d0e4b5a68")
        api.signInWithCode("ann@example.com", "123456")
        api.signOut()
        val signIn = server.takeRequest()
        assertEquals("3f2a9c1d0e4b5a68", signIn.headers["Device-Id"])
        assertEquals("android", signIn.headers["Device-Platform"])
        assertNull(server.takeRequest().headers["Device-Id"])
    }
}
