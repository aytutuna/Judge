package com.okjudge.judge.ui.verdict

import com.okjudge.judge.FakeHistory
import com.okjudge.judge.Fixtures
import com.okjudge.judge.core.api.JudgeApi
import com.okjudge.judge.i18n.AppLang
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.OkHttpClient
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class VerdictViewModelTest {
    private lateinit var server: MockWebServer
    private val history = FakeHistory()
    private val outcome = Fixtures.sample("win_a_self")

    @Before
    fun setUp() {
        Dispatchers.setMain(Dispatchers.Unconfined)
        server = MockWebServer()
        server.start()
        runBlocking { history.save(outcome, "balanced") }
    }

    @After
    fun tearDown() {
        server.close()
        Dispatchers.resetMain()
    }

    private fun vm(base: String = server.url("/").toString()) =
        VerdictViewModel(outcome.id, history, JudgeApi(base, OkHttpClient(), "ua"))

    private suspend fun VerdictViewModel.awaitStatus(status: TranslationStatus): TranslationView =
        withTimeout(10_000) { state.first { it.view?.status == status }.view!! }

    private fun translateBody(translated: Boolean = true): String {
        val t = Fixtures.verdicts["translateResponse"]!!.jsonObject
        return kotlinx.serialization.json.JsonObject(t + ("translated" to JsonPrimitive(translated))).toString()
    }

    @Test
    fun sameLanguage_showsTheOriginal_withoutARequest() = runBlocking {
        val vm = vm()
        val job = CoroutineScope(Dispatchers.Unconfined).launch { vm.state.collect {} }
        vm.onLang(AppLang.EN)
        val view = vm.awaitStatus(TranslationStatus.ORIGINAL)
        assertEquals(outcome.result.result.headline, view.result.headline)
        assertEquals(0, server.requestCount)
        job.cancel()
    }

    @Test
    fun otherLanguage_fetchesOnce_cachesIt_andSwitchingBackIsInstant() = runBlocking {
        server.enqueue(MockResponse.Builder().code(200).body(translateBody()).build())
        val vm = vm()
        val job = CoroutineScope(Dispatchers.Unconfined).launch { vm.state.collect {} }
        vm.onLang(AppLang.TR)
        val tr = vm.awaitStatus(TranslationStatus.TRANSLATED)
        assertEquals(AppLang.EN, tr.source)
        assertEquals(listOf(outcome.id to AppLang.TR), history.cached)
        vm.onLang(AppLang.EN)
        vm.awaitStatus(TranslationStatus.ORIGINAL)
        vm.onLang(AppLang.TR)
        vm.awaitStatus(TranslationStatus.TRANSLATED)
        assertEquals(1, server.requestCount)
        job.cancel()
    }

    @Test
    fun alreadyInThatLanguage_showsTheOriginal() = runBlocking {
        server.enqueue(MockResponse.Builder().code(200).body(translateBody(translated = false)).build())
        val vm = vm()
        val job = CoroutineScope(Dispatchers.Unconfined).launch { vm.state.collect {} }
        vm.onLang(AppLang.TR)
        withTimeout(10_000) { while (server.requestCount == 0) kotlinx.coroutines.delay(10) }
        vm.awaitStatus(TranslationStatus.ORIGINAL)
        assertEquals(emptyList<Pair<String, AppLang>>(), history.cached)
        job.cancel()
    }

    @Test
    fun rateLimited_keepsTheOriginal_andIsNotRetriedBeforeTheWait() = runBlocking {
        server.enqueue(MockResponse.Builder().code(429).addHeader("Retry-After", "300").body("""{"code":"rate_limited","retryAfterSec":300}""").build())
        val vm = vm()
        val job = CoroutineScope(Dispatchers.Unconfined).launch { vm.state.collect {} }
        vm.onLang(AppLang.TR)
        val view = vm.awaitStatus(TranslationStatus.ERROR)
        assertEquals(outcome.result.result.headline, view.result.headline)
        vm.onLang(AppLang.EN)
        vm.onLang(AppLang.TR)
        vm.awaitStatus(TranslationStatus.ERROR)
        assertEquals(1, server.requestCount)
        job.cancel()
    }

    @Test
    fun otherFailures_retryOnTheNextSwitch() = runBlocking {
        server.enqueue(MockResponse.Builder().code(502).body("<html>bad gateway</html>").build())
        server.enqueue(MockResponse.Builder().code(200).body(translateBody()).build())
        val vm = vm()
        val job = CoroutineScope(Dispatchers.Unconfined).launch { vm.state.collect {} }
        vm.onLang(AppLang.TR)
        vm.awaitStatus(TranslationStatus.ERROR)
        vm.onLang(AppLang.EN)
        vm.onLang(AppLang.TR)
        vm.awaitStatus(TranslationStatus.TRANSLATED)
        assertEquals(2, server.requestCount)
        job.cancel()
    }

    @Test
    fun aLaterRuling_isTranslatedUnderItsOwnId() = runBlocking {
        server.enqueue(MockResponse.Builder().code(200).body(translateBody()).build())
        server.enqueue(MockResponse.Builder().code(200).body(translateBody()).build())
        val vm = vm()
        val job = CoroutineScope(Dispatchers.Unconfined).launch { vm.state.collect {} }
        vm.onLang(AppLang.TR)
        vm.awaitStatus(TranslationStatus.TRANSLATED)
        assertEquals("/api/v1/verdicts/${outcome.id}/translate?lang=tr", server.takeRequest().target)
        history.saveRuling(outcome.id, Fixtures.sample("win_b_named").copy(id = "r1"))
        assertEquals("/api/v1/verdicts/r1/translate?lang=tr", withTimeout(10_000) { server.takeRequest() }.target)
        vm.awaitStatus(TranslationStatus.TRANSLATED)
        job.cancel()
    }

    @Test
    fun offline_saysSo() = runBlocking {
        val vm = vm("http://unresolvable.invalid/")
        val job = CoroutineScope(Dispatchers.Unconfined).launch { vm.state.collect {} }
        vm.onLang(AppLang.TR)
        vm.awaitStatus(TranslationStatus.OFFLINE)
        job.cancel()
    }
}
