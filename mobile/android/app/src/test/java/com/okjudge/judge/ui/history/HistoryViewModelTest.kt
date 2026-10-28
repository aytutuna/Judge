package com.okjudge.judge.ui.history

import androidx.test.core.app.ApplicationProvider
import com.okjudge.judge.Fixtures
import com.okjudge.judge.core.api.JudgeApi
import com.okjudge.judge.core.data.HistoryDb
import com.okjudge.judge.core.data.RoomHistoryRepository
import com.okjudge.judge.core.model.HistoryItem
import com.okjudge.judge.core.model.HistoryPage
import com.okjudge.judge.core.model.WireJson
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.OkHttpClient
import org.junit.After
import org.junit.Assert.assertEquals
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
class HistoryViewModelTest {
    private lateinit var server: MockWebServer
    private lateinit var db: HistoryDb
    private lateinit var repo: RoomHistoryRepository
    private val user = MutableStateFlow<String?>(null)
    private var now = 1_000_000L

    @Before
    fun setUp() {
        Dispatchers.setMain(Dispatchers.Unconfined)
        server = MockWebServer()
        server.start()
        db = HistoryDb.inMemory(ApplicationProvider.getApplicationContext())
        repo = RoomHistoryRepository(db) { now }
    }

    @After
    fun tearDown() {
        db.close()
        server.close()
        Dispatchers.resetMain()
    }

    private fun vm(sync: Boolean = true) =
        HistoryViewModel(repo, JudgeApi(server.url("/").toString(), OkHttpClient(), "ua"), user, { sync }) { now }

    private fun json(code: Int, body: String) =
        MockResponse.Builder().code(code).addHeader("Content-Type", "application/json").body(body).build()

    private fun item(id: String, at: String, kind: String = "verdict", removable: Boolean = true) =
        HistoryItem(kind = kind, id = id, at = at, createdAt = at, state = "ready", verdict = "side_a", headline = "Party A is right", removable = removable)

    private fun pageJson(items: List<HistoryItem>, next: String?) = JsonObject(
        mapOf(
            "items" to JsonArray(items.map { WireJson.json.encodeToJsonElement(HistoryItem.serializer(), it) }),
            "next" to (next?.let { JsonPrimitive(it) } ?: kotlinx.serialization.json.JsonNull),
        ),
    ).toString()

    /** Waits for the requests the view model sends on its own scope. */
    private fun take(n: Int = 1) = List(n) { server.takeRequest() }

    private suspend fun entries(model: HistoryViewModel, size: Int): List<HistoryEntry> = withTimeout(5_000) {
        model.entries.filterNotNull().first { it.size == size }
    }

    private suspend fun keys(model: HistoryViewModel, vararg expected: String): List<HistoryEntry> = withTimeout(5_000) {
        model.entries.filterNotNull().first { list -> list.map { it.key } == expected.toList() }
    }

    @Test
    fun signedIn_loadsPageOne_thenShowMore_andStopsAtTheEnd() = runBlocking {
        server.enqueue(json(200, pageJson(listOf(item("a", "2026-10-05T00:00:00.000Z"), item("b", "2026-10-04T00:00:00.000Z")), "cur1")))
        server.enqueue(json(200, pageJson(listOf(item("c", "2026-10-01T00:00:00.000Z")), null)))
        val model = vm()
        user.value = "u1"
        val first = take().single()
        assertEquals("/api/v1/me/history", first.url.encodedPath)
        assertEquals("20", first.url.queryParameter("limit"))
        assertNull(first.url.queryParameter("cursor"))
        keys(model, "v:a", "v:b")
        withTimeout(5_000) { model.paging.first { it.next == "cur1" } }

        model.loadMore()
        assertEquals("cur1", take().single().url.queryParameter("cursor"))
        keys(model, "v:a", "v:b", "v:c")
        val done = withTimeout(5_000) { model.paging.first { it.loadedAll } }
        assertNull(done.next)
        model.loadMore()
        assertEquals("nothing more is asked for", 2, server.requestCount)
    }

    @Test
    fun aShowMoreThatFails_saysSo_andTheNextTryClearsIt() = runBlocking {
        server.enqueue(json(200, pageJson(listOf(item("a", "2026-10-05T00:00:00.000Z")), "cur1")))
        server.enqueue(json(500, """{"error":"Something went wrong."}"""))
        server.enqueue(json(200, pageJson(listOf(item("b", "2026-10-01T00:00:00.000Z")), null)))
        val model = vm()
        user.value = "u1"
        take()
        withTimeout(5_000) { model.paging.first { it.next == "cur1" } }
        model.loadMore()
        take()
        withTimeout(5_000) { model.notice.first { it == HistoryNotice.LoadMoreFailed } }
        assertEquals("cur1", model.paging.value.next)
        withTimeout(5_000) { model.paging.first { !it.loadingMore } }
        model.loadMore()
        take()
        keys(model, "v:a", "v:b")
        assertNull(model.notice.value)
    }

    @Test
    fun phoneRowsOlderThanWhatIsLoaded_waitForTheAccountsList() = runBlocking {
        val old = Fixtures.sample("win_a_self")
        now = java.time.Instant.parse("2026-09-01T00:00:00Z").toEpochMilli()
        repo.save(old)
        server.enqueue(json(200, pageJson(listOf(item("a", "2026-10-05T00:00:00.000Z")), "cur1")))
        server.enqueue(json(200, pageJson(listOf(item("b", "2026-10-01T00:00:00.000Z")), null)))
        val model = vm()
        // Offline or before any load: everything the phone has shows.
        keys(model, "v:" + old.id)
        user.value = "u1"
        take()
        // Page 1 ends on Oct 5: the September verdict may be on a later page.
        keys(model, "v:a")
        withTimeout(5_000) { model.paging.first { it.next == "cur1" } }
        model.loadMore()
        take()
        assertTrue(keys(model, "v:a", "v:b", "v:" + old.id).last() is HistoryEntry.Phone)
    }

    @Test
    fun withoutTheServersList_onlyThePhonesRowsShow() = runBlocking {
        repo.save(Fixtures.sample("win_a_self"))
        val model = vm(sync = false)
        user.value = "u1"
        model.refresh(force = true)
        assertEquals(1, entries(model, 1).size)
        assertEquals(0, server.requestCount)
    }

    @Test
    fun remove_sendsEachAccountRowToItsOwnRemoval_andMarksItRemoved() = runBlocking {
        val verdict = item("v1", "2026-10-05T00:00:00.000Z")
        val owned = item("c1", "2026-10-04T00:00:00.000Z", kind = "case")
        val answered = item("c2", "2026-10-03T00:00:00.000Z", kind = "case").copy(role = "respondent", party = "b", inviteToken = "tok2")
        val failing = item("c3", "2026-10-02T00:00:00.000Z", kind = "case")
        repo.applyPage("u1", HistoryPage(listOf(verdict, owned, answered, failing), null), above = null)
        repo.save(Fixtures.sample("lean_tie").copy(id = "v1"))
        repo.save(Fixtures.sample("split").copy(id = "phone1"))
        server.enqueue(json(200, """{"removed":true,"removedAt":"2026-10-21T00:00:00.000Z"}"""))
        server.enqueue(json(200, """{"removed":true,"removedAt":"2026-10-21T00:00:00.000Z"}"""))
        server.enqueue(json(200, """{"removed":true,"removedAt":"2026-10-21T00:00:00.000Z"}"""))
        server.enqueue(json(409, """{"error":"Wait for the judges to finish first.","code":"in_progress"}"""))
        val model = vm(sync = false)
        user.value = "u1"
        val list = entries(model, 5)
        var failed: Set<String>? = null
        model.remove(list) { failed = it }
        val sent = take(4)
        assertEquals(
            listOf("/api/v1/verdicts/v1/removal", "/api/v1/cases/c1/removal", "/api/v1/respond/tok2/removal", "/api/v1/cases/c3/removal"),
            sent.map { it.url.encodedPath },
        )
        sent.forEach { assertEquals("remove", Json.parseToJsonElement(it.body!!.utf8()).jsonObject["confirm"].toString().trim('"')) }
        withTimeout(5_000) { while (failed == null) kotlinx.coroutines.delay(10) }
        assertEquals(setOf("c:c3"), failed)
        assertEquals(HistoryNotice.RemoveFailed(1), model.notice.value)

        val after = entries(model, 4).filterIsInstance<HistoryEntry.Account>().associateBy { it.key }
        assertEquals("removed", after.getValue("v:v1").item.state)
        assertNull(after.getValue("v:v1").item.headline)
        assertEquals(true, after.getValue("c:c2").item.removed)
        assertEquals("ready", after.getValue("c:c3").item.state)
        assertNull("the phone's copy goes with the account's", repo.observe("v1").first())
        assertNull("phone rows are deleted here", repo.observe("phone1").first())
    }

    @Test
    fun remove_offline_sendsNothingMore_butStillDeletesPhoneRows() = runBlocking {
        repo.applyPage("u1", HistoryPage(listOf(item("v1", "2026-10-05T00:00:00.000Z"), item("v2", "2026-10-04T00:00:00.000Z")), null), above = null)
        repo.save(Fixtures.sample("split").copy(id = "phone1"))
        val model = vm(sync = false)
        user.value = "u1"
        val list = entries(model, 3)
        server.close()
        var failed: Set<String>? = null
        model.remove(list) { failed = it }
        withTimeout(10_000) { while (failed == null) kotlinx.coroutines.delay(10) }
        assertEquals(setOf("v:v1", "v:v2"), failed)
        assertEquals(HistoryNotice.Offline, model.notice.value)
        assertNull(repo.observe("phone1").first())
    }

    @Test
    fun openingAnAccountVerdictNotOnThePhone_readsItFirst() = runBlocking {
        val sample = Fixtures.sample("win_a_self")
        val mine = JsonObject(
            mapOf(
                "id" to JsonPrimitive(sample.id),
                "result" to Json.parseToJsonElement(sample.result.rawJson),
                "nameMap" to Json.parseToJsonElement(WireJson.encodeNameMap(sample.nameMap)),
                "removed" to kotlinx.serialization.json.JsonNull,
            ),
        ).toString()
        server.enqueue(json(200, mine))
        val model = vm(sync = false)
        user.value = "u1"
        var opened: String? = null
        model.openVerdict(item(sample.id, "2026-10-05T00:00:00.000Z")) { opened = it }
        assertEquals("/api/v1/verdicts/${sample.id}/mine", take().single().url.encodedPath)
        withTimeout(5_000) { while (opened == null) kotlinx.coroutines.delay(10) }
        assertEquals(sample.id, opened)
        val kept = repo.observe(sample.id).first()!!
        assertEquals("u1", kept.ownerUserId)
        assertEquals(sample.nameMap, kept.nameMap)

        // Kept on the phone now: no second read.
        opened = null
        model.openVerdict(item(sample.id, "2026-10-05T00:00:00.000Z")) { opened = it }
        withTimeout(5_000) { while (opened == null) kotlinx.coroutines.delay(10) }
        assertEquals(1, server.requestCount)
    }
}
