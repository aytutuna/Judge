package com.okjudge.judge.core.api

import com.okjudge.judge.Fixtures
import com.okjudge.judge.core.display.UiError
import com.okjudge.judge.core.model.VerdictRequest
import com.okjudge.judge.i18n.AppLang
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.SocketEffect
import okhttp3.Call
import okhttp3.EventListener
import okhttp3.OkHttpClient
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.util.Collections
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class JudgeApiTest {
    private lateinit var server: MockWebServer
    private val request = VerdictRequest(argument = "My friend says a hot dog is a sandwich.", lang = "en")

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
    }

    @After
    fun tearDown() = server.close()

    private fun api(tokens: TokenStore = NoTokenStore, onSignedOut: () -> Unit = {}, timeouts: JudgeApi.Timeouts = JudgeApi.Timeouts()) =
        JudgeApi(server.url("/").toString(), OkHttpClient(), "Judge-Android/test (1)", tokens, onSignedOut, timeouts)

    private fun json(code: Int, body: String, vararg headers: Pair<String, String>) =
        MockResponse.Builder().code(code).addHeader("Content-Type", "application/json").apply {
            headers.forEach { addHeader(it.first, it.second) }
        }.body(body).build()

    @Test
    fun verdict_success_postsTheRequestAndDecodes() = runBlocking {
        server.enqueue(json(200, Fixtures.sampleJson("win_b_named")))
        val res = api().submitVerdict(request)
        assertTrue(res is ApiResult.Ok)
        val outcome = (res as ApiResult.Ok).value
        assertEquals("side_b", outcome.result.result.verdict)
        val recorded = server.takeRequest()
        assertEquals("POST", recorded.method)
        assertEquals("/api/v1/verdict", recorded.url.encodedPath)
        assertEquals("application/json", recorded.headers["Accept"])
        assertEquals("Judge-Android/test (1)", recorded.headers["User-Agent"])
        assertNull(recorded.headers["Authorization"])
        assertNull(recorded.headers["Cookie"])
        val body = Json.parseToJsonElement(recorded.body!!.utf8()).jsonObject
        assertEquals("premium", body["tier"]!!.jsonPrimitive.content)
        assertTrue("no null fields on the wire", "clarifications" !in body && "evidence" !in body)
        assertTrue("framework" !in body)
    }

    @Test
    fun everyStableErrorCode_mapsToApiError() = runBlocking {
        for (e in Fixtures.verdicts["errorBodies"]!!.let { it as kotlinx.serialization.json.JsonArray }.map { it.jsonObject }) {
            val status = e["status"]!!.jsonPrimitive.content.toInt()
            val body = e["body"]!!
            server.enqueue(json(status, body.toString()))
            val res = api().submitVerdict(request)
            val err = (res as ApiResult.Err).error
            if (body is kotlinx.serialization.json.JsonNull) {
                // A JSON `null` body is not an error object: bare status mapping.
                assertTrue(err is UiError.Api)
            } else {
                val code = body.jsonObject["code"]?.jsonPrimitive?.content
                assertEquals(code, (err as UiError.Api).code)
                assertEquals(status, err.status)
            }
        }
    }

    @Test
    fun rateLimited_carriesTheWait_fromBodyOrHeader() = runBlocking {
        server.enqueue(json(429, """{"error":"Slow down","code":"rate_limited","retryAfterSec":420}""", "Retry-After" to "420"))
        assertEquals(420.0, ((api().submitVerdict(request) as ApiResult.Err).error as UiError.Api).retryAfterSec!!, 0.0)
        server.enqueue(MockResponse.Builder().code(429).addHeader("Retry-After", "90").body("Too Many Requests").build())
        val bare = (api().submitVerdict(request) as ApiResult.Err).error as UiError.Api
        assertNull(bare.code)
        assertEquals(429, bare.status)
        assertEquals(90.0, bare.retryAfterSec!!, 0.0)
    }

    @Test
    fun htmlBadGateway_isUnavailable_and524_isTimeout() = runBlocking {
        server.enqueue(MockResponse.Builder().code(502).addHeader("Content-Type", "text/html").body("<html>Bad gateway</html>").build())
        assertEquals(UiError.Api(code = "unavailable", status = 502), (api().submitVerdict(request) as ApiResult.Err).error)
        server.enqueue(MockResponse.Builder().code(524).body("<html>A timeout occurred</html>").build())
        assertEquals(UiError.Timeout, (api().submitVerdict(request) as ApiResult.Err).error)
    }

    @Test
    fun malformedSuccessBody_isUnknown() = runBlocking {
        server.enqueue(json(200, """{"id":"x"}"""))
        assertEquals(UiError.Unknown, (api().submitVerdict(request) as ApiResult.Err).error)
        server.enqueue(json(200, "not json"))
        assertEquals(UiError.Unknown, (api().submitVerdict(request) as ApiResult.Err).error)
    }

    @Test
    fun slowServer_isTimeout() = runBlocking {
        server.enqueue(MockResponse.Builder().code(200).body(Fixtures.sampleJson("split")).headersDelay(3, TimeUnit.SECONDS).build())
        val res = api(timeouts = JudgeApi.Timeouts(verdictSec = 1)).submitVerdict(request)
        assertEquals(UiError.Timeout, (res as ApiResult.Err).error)
    }

    @Test
    fun droppedConnection_isNotRetried() = runBlocking {
        server.enqueue(MockResponse.Builder().onRequestStart(SocketEffect.ShutdownConnection).build())
        server.enqueue(json(200, Fixtures.sampleJson("split")))
        val res = api().submitVerdict(request)
        assertTrue(res is ApiResult.Err)
        assertEquals("the verdict POST is sent exactly once", 1, server.requestCount)
    }

    @Test
    fun offline_isOffline() = runBlocking {
        val dead = JudgeApi("http://unresolvable.invalid", OkHttpClient(), "ua")
        assertEquals(UiError.Offline, (dead.submitVerdict(request) as ApiResult.Err).error)
    }

    @Test
    fun translate_hitsTheV1Route() = runBlocking {
        server.enqueue(json(200, Fixtures.verdicts["translateResponse"].toString()))
        val res = api().translate("abc123DEF0", AppLang.TR)
        assertTrue(res is ApiResult.Ok)
        val recorded = server.takeRequest()
        assertEquals("POST", recorded.method)
        assertEquals("/api/v1/verdicts/abc123DEF0/translate?lang=tr", recorded.target)
    }

    @Test
    fun getVerdict_and404() = runBlocking {
        server.enqueue(json(200, Fixtures.verdicts["storedVerdictResponse"].toString()))
        assertTrue(api().getVerdict("abc").let { it is ApiResult.Ok })
        server.enqueue(json(404, """{"error":"Not found","code":"not_found"}"""))
        assertEquals("not_found", ((api().getVerdict("zzz") as ApiResult.Err).error as UiError.Api).code)
        assertEquals("/api/v1/verdicts/abc", server.takeRequest().target)
    }

    @Test
    fun bearerToken_isSent_andA401ClearsIt() = runBlocking {
        val tokens = MemoryTokenStore("tok-1")
        var signedOut = false
        server.enqueue(json(401, """{"error":"Sign in","code":"signin_required"}"""))
        api(tokens, onSignedOut = { signedOut = true }).submitVerdict(request)
        assertEquals("Bearer tok-1", server.takeRequest().headers["Authorization"])
        assertNull(tokens.get())
        assertTrue(signedOut)
    }

    @Test
    fun a401ForAnOlderSession_leavesANewerOneAlone() = runBlocking {
        val tokens = MemoryTokenStore("old")
        var signedOut = false
        server.enqueue(
            MockResponse.Builder().code(401).addHeader("Content-Type", "application/json")
                .body("""{"error":"Sign in","code":"signin_required"}""")
                .headersDelay(500, TimeUnit.MILLISECONDS)
                .build(),
        )
        val api = api(tokens, onSignedOut = { signedOut = true })
        val call = async(kotlinx.coroutines.Dispatchers.IO) { api.submitVerdict(request) }
        assertEquals("Bearer old", server.takeRequest().headers["Authorization"])
        tokens.set("new")
        call.await()
        assertEquals("new", tokens.get())
        assertTrue(!signedOut)
    }

    @Test
    fun bodyIsReadOffTheCallersThread() {
        // A single-thread dispatcher stands in for Dispatchers.Main: the body
        // must be read on another thread, and the sign-out callback must come
        // back to the caller's thread.
        val readThreads = Collections.synchronizedList(mutableListOf<Thread>())
        val client = OkHttpClient.Builder().eventListener(object : EventListener() {
            override fun responseBodyEnd(call: Call, byteCount: Long) {
                readThreads += Thread.currentThread()
            }
        }).build()
        val tokens = MemoryTokenStore("tok-1")
        var signedOutOn: Thread? = null
        val api = JudgeApi(server.url("/").toString(), client, "Judge-Android/test (1)", tokens, { signedOutOn = Thread.currentThread() })
        server.enqueue(json(200, Fixtures.sampleJson("win_b_named")))
        server.enqueue(json(401, """{"error":"Sign in","code":"signin_required"}"""))
        val executor = Executors.newSingleThreadExecutor { Thread(it, "main-like") }
        try {
            runBlocking {
                withContext(executor.asCoroutineDispatcher()) {
                    val callerThread = Thread.currentThread()
                    assertTrue(api.submitVerdict(request) is ApiResult.Ok)
                    assertTrue(api.submitVerdict(request) is ApiResult.Err)
                    assertEquals(2, readThreads.size)
                    readThreads.forEach { assertTrue("body read on ${it.name}", it !== callerThread) }
                    assertTrue("sign-out callback back on the caller", signedOutOn === callerThread)
                }
            }
        } finally {
            executor.shutdownNow()
        }
    }

    @Test
    fun history_passesTheCursor_andDecodesThePage() = runBlocking {
        server.enqueue(json(200, Fixtures.verdicts["history"].toString()))
        val res = api(tokens = FixedTokens("tok")).history(limit = 20, cursor = "abc")
        val page = (res as ApiResult.Ok).value
        val recorded = server.takeRequest()
        assertEquals("/api/v1/me/history", recorded.url.encodedPath)
        assertEquals("20", recorded.url.queryParameter("limit"))
        assertEquals("abc", recorded.url.queryParameter("cursor"))
        assertEquals("Bearer tok", recorded.headers["Authorization"])
        assertEquals(7, page.items.size)
        assertEquals("c:case0000010", page.items.first().key)
        val answered = page.items.first { it.isRespondent }
        assertEquals("b", answered.party)
        assertEquals("case0000013.inviteTokenFixture0001", answered.inviteToken)
        assertTrue(page.next!!.isNotEmpty())
    }

    @Test
    fun history_keepsRowsItCanRead_andToleratesNewStates() = runBlocking {
        val body = """{"items":[
            {"kind":"verdict","id":"v1","at":"2026-10-05T00:00:00.000Z","state":"archived"},
            {"kind":"case","id":"c1","at":"2026-10-04T00:00:00.000Z","state":"ready","verdict":"split","nameMap":"nope"},
            {"kind":"case","at":"2026-10-03T00:00:00.000Z"}
        ],"next":null}"""
        server.enqueue(json(200, body))
        val page = (api().history() as ApiResult.Ok).value
        assertEquals(listOf("v:v1"), page.items.map { it.key })
        assertNull("a state this build doesn't know", page.items.single().historyState)
        assertNull(page.next)
    }

    @Test
    fun removals_postTheConfirmation_toEachSidesOwnEndpoint() = runBlocking {
        repeat(2) { server.enqueue(json(200, """{"removed":true,"removedAt":"2026-10-21T00:00:00.000Z"}""")) }
        assertTrue(api().removeVerdict("v1") is ApiResult.Ok)
        assertTrue(api().removeAnsweredCase("tok_1") is ApiResult.Ok)
        val verdict = server.takeRequest()
        val answered = server.takeRequest()
        assertEquals("/api/v1/verdicts/v1/removal", verdict.url.encodedPath)
        assertEquals("/api/v1/respond/tok_1/removal", answered.url.encodedPath)
        for (r in listOf(verdict, answered)) {
            assertEquals("POST", r.method)
            assertEquals("remove", Json.parseToJsonElement(r.body!!.utf8()).jsonObject["confirm"]!!.jsonPrimitive.content)
        }
    }

    @Test
    fun config_readsTheHistorySwitch() = runBlocking {
        server.enqueue(json(200, Fixtures.verdicts["config"]!!.jsonObject["full"].toString()))
        server.enqueue(json(200, """{"signIn":{"google":true},"features":{"cases":true}}"""))
        assertTrue((api().config() as ApiResult.Ok).value.features.history)
        assertTrue("an older server has no list", !(api().config() as ApiResult.Ok).value.features.history)
    }

    private class FixedTokens(private val token: String) : TokenStore {
        override fun get(): String = token
        override fun set(token: String) {}
        override fun clear() {}
        override fun user(): String? = null
        override fun setUser(id: String) {}
    }
}
