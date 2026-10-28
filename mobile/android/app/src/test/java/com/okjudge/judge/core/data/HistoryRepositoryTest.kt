package com.okjudge.judge.core.data

import androidx.test.core.app.ApplicationProvider
import com.okjudge.judge.Fixtures
import com.okjudge.judge.core.model.HistoryItem
import com.okjudge.judge.core.model.HistoryPage
import com.okjudge.judge.core.model.LeanState
import com.okjudge.judge.core.model.MineVerdict
import com.okjudge.judge.core.model.NameMapping
import com.okjudge.judge.core.model.WireJson
import com.okjudge.judge.i18n.AppLang
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.time.Instant

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class HistoryRepositoryTest {
    private lateinit var db: HistoryDb
    private lateinit var repo: RoomHistoryRepository
    private var now = 1_000L

    @Before
    fun setUp() {
        db = HistoryDb.inMemory(ApplicationProvider.getApplicationContext())
        repo = RoomHistoryRepository(db) { now }
    }

    @After
    fun tearDown() = db.close()

    @Test
    fun save_listsNewestFirst_andKeepsEverythingForOffline() = runBlocking {
        repo.save(Fixtures.sample("win_a_self"))
        now = 2_000L
        repo.save(Fixtures.sample("lean_tie").copy(id = "tie1"))
        val all = repo.observeAll().first()
        assertEquals(listOf("tie1", "abc123DEF0"), all.map { it.id })
        val tie = all.first()
        assertEquals(LeanState.Tie, tie.original.result.leanState)
        val win = all.last()
        assertEquals(Fixtures.sample("win_a_self").nameMap, win.nameMap)
        assertEquals(AppLang.EN, win.lang)
        val row = db.history().get("abc123DEF0")!!
        assertEquals("side_a", row.verdict)
        assertEquals(4, row.confidence)
        assertEquals("free", row.tier)
        assertEquals("balanced", row.preset)
        assertEquals(WireJson.json.parseToJsonElement(Fixtures.sample("win_a_self").result.rawJson), WireJson.json.parseToJsonElement(row.resultJson))
    }

    @Test
    fun aRowSavedWithAnotherJudgingStyle_stillLoads() = runBlocking {
        val sample = Fixtures.sample("win_a_self")
        db.history().upsert(
            SavedVerdictRow(
                id = sample.id,
                createdAt = 500L,
                headline = sample.result.result.headline,
                verdict = sample.result.result.verdict,
                lang = "en",
                confidence = sample.result.result.confidence,
                preset = "loyalty",
                tier = "free",
                resultJson = sample.result.rawJson,
                nameMapJson = WireJson.encodeNameMap(sample.nameMap),
            ),
        )
        val saved = repo.observe(sample.id).first()!!
        assertEquals(sample.result.result.headline, saved.original.result.headline)
        assertEquals(sample.nameMap, saved.nameMap)
    }

    @Test
    fun replayWithEmptyNameMap_keepsTheStoredNames_andCreatedAt() = runBlocking {
        val first = Fixtures.sample("win_b_named")
        repo.save(first)
        now = 9_999L
        repo.save(first.copy(nameMap = emptyList(), replayed = true))
        val saved = repo.observe(first.id).first()!!
        assertEquals(first.nameMap, saved.nameMap)
        assertEquals(1_000L, saved.createdAt)
    }

    @Test
    fun aLaterRuling_replacesWhatTheEntryShows_butKeepsItsIdDateAndNames() = runBlocking {
        val first = Fixtures.sample("win_b_named")
        repo.save(first)
        repo.cacheTranslation(first.id, AppLang.TR, Fixtures.sample("lean_tie").result)
        now = 5_000L
        val later = Fixtures.sample("win_a_self")
        repo.saveRuling(first.id, later.copy(id = "r1", nameMap = first.nameMap.take(1) + NameMapping("Kim", "Person C")))
        val saved = repo.observe(first.id).first()!!
        assertEquals("r1", saved.rulingId)
        assertEquals(1_000L, saved.createdAt)
        assertEquals(later.result.result.headline, saved.original.result.headline)
        assertEquals("the earlier ruling's translations are dropped", emptyMap<AppLang, Any>(), saved.translations)
        assertEquals(first.nameMap + NameMapping("Kim", "Person C"), saved.nameMap)
        assertEquals("side_a", db.history().get(first.id)!!.verdict)
        assertEquals(listOf(first.id), repo.observeAll().first().map { it.id })

        repo.saveRuling("missing", later)
        assertNull(repo.observe("missing").first())
    }

    @Test
    fun aFreshEntry_isItsOwnRuling() = runBlocking {
        val outcome = Fixtures.sample("win_a_self")
        repo.save(outcome)
        assertEquals(outcome.id, repo.observe(outcome.id).first()!!.rulingId)
    }

    @Test
    fun translations_areCachedPerLanguage() = runBlocking {
        val outcome = Fixtures.sample("win_a_self")
        repo.save(outcome)
        val tr = WireJson.decodeTranslateResponse(Fixtures.verdicts["translateResponse"].toString()).result
        repo.cacheTranslation(outcome.id, AppLang.TR, tr)
        val saved = repo.observe(outcome.id).first()!!
        assertEquals(setOf(AppLang.TR), saved.translations.keys)
        assertEquals(tr.result.headline, saved.translations[AppLang.TR]!!.result.headline)
        // Saving the same id again (replay) keeps the cache.
        repo.save(outcome)
        assertTrue(repo.observe(outcome.id).first()!!.translations.containsKey(AppLang.TR))
    }

    @Test
    fun delete_andDeleteAll() = runBlocking {
        repo.save(Fixtures.sample("split"))
        repo.save(Fixtures.sample("conditional"))
        val ids = repo.observeAll().first().map { it.id }
        repo.delete(ids.first())
        assertEquals(1, repo.observeAll().first().size)
        repo.deleteAll()
        assertEquals(0, repo.observeAll().first().size)
        assertNull(repo.observe(ids.last()).first())
    }

    private fun item(id: String, at: String, kind: String = "verdict", state: String = "ready") =
        HistoryItem(kind = kind, id = id, at = at, createdAt = at, state = state, verdict = "side_a", headline = "Party A is right", removable = true)

    private fun page(vararg items: HistoryItem, next: String? = "more") = HistoryPage(items.toList(), next)

    private suspend fun keys(user: String = "u1") = repo.observeCached(user).first().map { it.key }

    @Test
    fun firstPage_replacesTheRowsItCovers_andKeepsTheOnesBelow() = runBlocking {
        repo.applyPage("u1", page(item("b", "2026-10-05T12:00:00.000Z"), item("a", "2026-10-05T00:00:00.000Z"), item("c", "2026-10-01T00:00:00.000Z")), above = null)
        // b is gone on the server; c is below the new page and not checked yet.
        repo.applyPage("u1", page(item("n", "2026-10-06T00:00:00.000Z"), item("a", "2026-10-05T00:00:00.000Z")), above = null)
        assertEquals(listOf("v:n", "v:a", "v:c"), keys())
    }

    @Test
    fun lastPage_dropsEverythingBelowIt_thatItLacks() = runBlocking {
        repo.applyPage("u1", page(item("a", "2026-10-05T00:00:00.000Z"), item("b", "2026-10-04T00:00:00.000Z"), item("c", "2026-10-01T00:00:00.000Z")), above = null)
        repo.applyPage("u1", page(item("a", "2026-10-05T00:00:00.000Z"), next = null), above = null)
        assertEquals(listOf("v:a"), keys())
        repo.applyPage("u1", page(next = null), above = null)
        assertEquals(emptyList<String>(), keys())
    }

    @Test
    fun middlePage_reconcilesBetweenThePreviousPageAndItsOwnLastRow() = runBlocking {
        val first = item("a", "2026-10-09T00:00:00.000Z")
        repo.applyPage(
            "u1",
            page(first, item("b", "2026-10-08T00:00:00.000Z"), item("c", "2026-10-07T00:00:00.000Z"), item("d", "2026-10-02T00:00:00.000Z"), next = null),
            above = null,
        )
        // Page 2 starts below a and ends at c: b went, a and d are outside its window.
        repo.applyPage("u1", page(item("c", "2026-10-07T00:00:00.000Z")), above = first)
        assertEquals(listOf("v:a", "v:c", "v:d"), keys())
    }

    @Test
    fun rowsSharingATime_areOrderedByKey_atAPageEdge() = runBlocking {
        val at = "2026-10-05T00:00:00.000Z"
        repo.applyPage("u1", page(item("x", at), item("y", at, kind = "case"), item("z", at), next = null), above = null)
        assertEquals(listOf("v:z", "v:x", "c:y"), keys())
        // A page ending at v:x leaves c:y (below it) alone.
        repo.applyPage("u1", page(item("z", at), item("x", at)), above = null)
        assertEquals(listOf("v:z", "v:x", "c:y"), keys())
    }

    @Test
    fun listedVerdicts_joinTheAccount_andRemovedOnesLeaveThePhone() = runBlocking {
        val kept = Fixtures.sample("win_a_self")
        val gone = Fixtures.sample("lean_tie").copy(id = "gone1")
        val phoneOnly = Fixtures.sample("split").copy(id = "phone1")
        listOf(kept, gone, phoneOnly).forEach { repo.save(it) }
        repo.applyPage(
            "u1",
            page(item(kept.id, "2026-10-05T00:00:00.000Z"), item("gone1", "2026-10-04T00:00:00.000Z").copy(state = "removed", removed = true), next = null),
            above = null,
        )
        assertEquals("u1", repo.observe(kept.id).first()!!.ownerUserId)
        assertNull("the text and names leave with the server's copy", repo.observe("gone1").first())
        assertNull("not in the account: stays the phone's own", repo.observe("phone1").first()!!.ownerUserId)

        // A row the server no longer lists keeps its phone copy (it may never have reached the account).
        repo.applyPage("u1", page(next = null), above = null)
        assertEquals("u1", repo.observe(kept.id).first()!!.ownerUserId)
    }

    @Test
    fun anotherAccount_takesTheFormerAccountsRowsOff_butNotThePhonesOwn() = runBlocking {
        repo.save(Fixtures.sample("win_a_self"))
        repo.save(Fixtures.sample("split").copy(id = "phone1"))
        repo.applyPage("u1", page(item("abc123DEF0", "2026-10-05T00:00:00.000Z"), next = null), above = null)
        repo.setAccount("u2")
        assertEquals(emptyList<String>(), keys("u1"))
        assertNull(repo.observe("abc123DEF0").first())
        assertTrue(repo.observe("phone1").first() != null)
        assertNull(repo.cachedUser())
    }

    @Test
    fun signingOut_forgetsEveryAccountRow_keepsThePhonesOwn() = runBlocking {
        repo.save(Fixtures.sample("win_a_self"))
        repo.save(Fixtures.sample("split").copy(id = "phone1"))
        repo.applyPage("u1", page(item("abc123DEF0", "2026-10-05T00:00:00.000Z"), next = null), above = null)
        assertEquals("u1", repo.cachedUser())
        repo.forgetAccounts()
        assertEquals(emptyList<String>(), keys())
        assertNull(repo.observe("abc123DEF0").first())
        assertTrue(repo.observe("phone1").first() != null)
    }

    @Test
    fun aVerdictSavedSignedIn_isListedAtOnce() = runBlocking {
        now = Instant.parse("2026-10-20T09:00:00Z").toEpochMilli()
        repo.setAccount("u1")
        val outcome = Fixtures.sample("win_b_named")
        repo.save(outcome)
        val listed = repo.observeCached("u1").first().single()
        assertEquals("v:" + outcome.id, listed.key)
        assertEquals("2026-10-20T09:00:00.000Z", listed.at)
        assertEquals("ready", listed.state)
        assertEquals(outcome.result.result.headline, listed.headline)
        assertNull("the account confirms it on the next load", repo.observe(outcome.id).first()!!.ownerUserId)

        repo.saveRuling(outcome.id, Fixtures.sample("win_a_self").copy(id = "r1"))
        val ruled = repo.observeCached("u1").first().single()
        assertEquals("side_a", ruled.verdict)
        assertTrue(ruled.contextAdded)
    }

    @Test
    fun keep_storesAnAccountVerdictForOfflineReading() = runBlocking {
        val sample = Fixtures.sample("win_a_self")
        val listed = item(sample.id, "2026-10-05T10:00:00.000Z")
        repo.keep("u1", listed, MineVerdict(sample.result, sample.nameMap, removed = false))
        val saved = repo.observe(sample.id).first()!!
        assertEquals("u1", saved.ownerUserId)
        assertEquals(Instant.parse("2026-10-05T10:00:00Z").toEpochMilli(), saved.createdAt)
        assertEquals(sample.nameMap, saved.nameMap)
        repo.keep("u1", item("none", "2026-10-05T10:00:00.000Z"), MineVerdict(null, emptyList(), removed = true))
        assertNull(repo.observe("none").first())
    }

    @Test
    fun windows_includeTheLowerBound_excludeTheUpper() {
        val upper = item("u", "2026-10-05T00:00:00.000Z")
        val lower = item("l", "2026-10-01T00:00:00.000Z")
        assertTrue(inWindow("2026-10-03T00:00:00.000Z", "v:m", lower, upper))
        assertTrue(inWindow(lower.at, lower.key, lower, upper))
        assertTrue(!inWindow(upper.at, upper.key, lower, upper))
        assertTrue(!inWindow("2026-09-30T00:00:00.000Z", "v:o", lower, upper))
        assertTrue(inWindow("2020-01-01T00:00:00.000Z", "v:o", null, upper))
        assertEquals("2026-10-20T09:00:00.000Z", isoMillis(Instant.parse("2026-10-20T09:00:00Z").toEpochMilli()))
    }
}
