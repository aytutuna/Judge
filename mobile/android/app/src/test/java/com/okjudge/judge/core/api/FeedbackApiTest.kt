package com.okjudge.judge.core.api

import com.okjudge.judge.core.model.ConsentState
import com.okjudge.judge.core.model.ConsentStatus
import com.okjudge.judge.core.display.UiError
import com.okjudge.judge.core.model.Rating
import com.okjudge.judge.core.feedback.DataExport
import com.okjudge.judge.i18n.AppLang
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withTimeout
import java.time.LocalDate
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.OkHttpClient
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test

class FeedbackApiTest {
    private lateinit var server: MockWebServer

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
    }

    @After
    fun tearDown() = server.close()

    private fun api() = JudgeApi(server.url("/").toString(), OkHttpClient(), "ua")

    private fun ok(body: String) = MockResponse.Builder().code(200).addHeader("Content-Type", "application/json").body(body).build()

    @Test
    fun consent_readsTheState() = runBlocking {
        server.enqueue(ok("""{"state":"not_asked","updatedAt":null,"policyVersion":"2026-11-14","ask":true,"sensitiveAgreed":true}"""))
        assertEquals(ApiResult.Ok(ConsentStatus(ConsentState.NOT_ASKED, ask = true, sensitiveAgreed = true)), api().consent())
        assertEquals("/api/v1/me/consent", server.takeRequest().url.encodedPath)
    }

    @Test
    fun consent_askAndAgreementDefaultToFalseWhenTheServerLeavesThemOut() = runBlocking {
        server.enqueue(ok("""{"state":"not_asked"}"""))
        assertEquals(ApiResult.Ok(ConsentStatus(ConsentState.NOT_ASKED, ask = false, sensitiveAgreed = false)), api().consent())
    }

    @Test
    fun consent_anUnknownStateIsAnErrorNotACard() = runBlocking {
        server.enqueue(ok("""{"state":"maybe"}"""))
        server.enqueue(ok("""{}"""))
        assertEquals(ApiResult.Err(UiError.Unknown), api().consent())
        assertEquals(ApiResult.Err(UiError.Unknown), api().consent())
    }

    @Test
    fun setConsent_sendsTheChoiceWordingAndPlatform() = runBlocking {
        server.enqueue(ok("""{"state":"on","updatedAt":"2026-11-14T10:00:00.000Z","policyVersion":"2026-11-14"}"""))
        assertEquals(ApiResult.Ok(ConsentStatus(ConsentState.ON, ask = false, sensitiveAgreed = false)), api().setConsent(true, "card", "consent.cardBody", AppLang.TR))
        val sent = server.takeRequest()
        assertEquals("POST", sent.method)
        val body = Json.parseToJsonElement(sent.body!!.utf8()).jsonObject
        assertEquals("on", body["choice"]!!.jsonPrimitive.content)
        assertEquals("card", body["source"]!!.jsonPrimitive.content)
        assertEquals("consent.cardBody", body["wordingKey"]!!.jsonPrimitive.content)
        assertEquals("tr", body["lang"]!!.jsonPrimitive.content)
        assertEquals("android", body["platform"]!!.jsonPrimitive.content)
    }

    @Test
    fun exportData_returnsTheFileTextAsIs() = runBlocking {
        server.enqueue(ok("""{"exportedAt":"2026-11-14","verdicts":[]}"""))
        assertEquals(ApiResult.Ok("""{"exportedAt":"2026-11-14","verdicts":[]}"""), api().exportData())
        val sent = server.takeRequest()
        assertEquals("GET", sent.method)
        assertEquals("/api/v1/me/export", sent.url.encodedPath)
    }

    @Test
    fun exportData_aRateLimitIsAnError() = runBlocking {
        server.enqueue(MockResponse.Builder().code(429).body("""{"error":"slow","code":"rate_limited"}""").build())
        assertEquals("rate_limited", ((api().exportData() as ApiResult.Err).error as UiError.Api).code)
    }

    @Test
    fun dataExport_isReadyWithTheDatedFileName() = runBlocking {
        server.enqueue(ok("""{"a":1}"""))
        val export = DataExport(api(), CoroutineScope(Dispatchers.Unconfined)) { LocalDate.of(2026, 11, 14) }
        export.start()
        withTimeout(5000) { while (export.state.value == DataExport.State.Busy) delay(10) }
        assertEquals(DataExport.State.Ready("judge-data-2026-11-14.json", """{"a":1}"""), export.state.value)
        export.done()
        assertEquals(DataExport.State.Idle, export.state.value)
    }

    @Test
    fun dataExport_failsWhenTheServerRefuses() = runBlocking {
        server.enqueue(MockResponse.Builder().code(503).body("""{"error":"x","code":"unavailable"}""").build())
        val export = DataExport(api(), CoroutineScope(Dispatchers.Unconfined))
        export.start()
        withTimeout(5000) { while (export.state.value == DataExport.State.Busy) delay(10) }
        assertEquals(DataExport.State.Failed, export.state.value)
    }

    @Test
    fun rating_isReadFromTheVerdict_andNullWhenAbsent() = runBlocking {
        server.enqueue(ok("""{"id":"a","rating":"down"}"""))
        server.enqueue(ok("""{"id":"a"}"""))
        assertEquals(ApiResult.Ok(Rating.DOWN), api().rating("a"))
        assertEquals(ApiResult.Ok(null), api().rating("a"))
    }

    @Test
    fun setRating_putsTheRating_andNullClearsIt() = runBlocking {
        server.enqueue(ok("""{"rating":"up"}"""))
        server.enqueue(ok("""{"rating":null}"""))
        api().setRating("a", Rating.UP)
        val up = server.takeRequest()
        assertEquals("PUT", up.method)
        assertEquals("/api/v1/verdicts/a/rating", up.url.encodedPath)
        assertEquals("up", Json.parseToJsonElement(up.body!!.utf8()).jsonObject["rating"]!!.jsonPrimitive.content)
        api().setRating("a", null)
        assertEquals("""{"rating":null}""", server.takeRequest().body!!.utf8())
    }
}
