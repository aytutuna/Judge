package com.okjudge.judge.core.data

import androidx.test.core.app.ApplicationProvider
import com.okjudge.judge.Fixtures
import com.okjudge.judge.core.model.LeanState
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

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class HistoryRepositoryTest {
    private lateinit var db: HistoryDb
    private lateinit var repo: RoomHistoryRepository
    private var now = 1_000L

    @Before
    fun setUp() {
        db = HistoryDb.inMemory(ApplicationProvider.getApplicationContext())
        repo = RoomHistoryRepository(db.history()) { now }
    }

    @After
    fun tearDown() = db.close()

    @Test
    fun save_listsNewestFirst_andKeepsEverythingForOffline() = runBlocking {
        repo.save(Fixtures.sample("win_a_self"), "balanced")
        now = 2_000L
        repo.save(Fixtures.sample("lean_tie").copy(id = "tie1"), "fairness")
        val all = repo.observeAll().first()
        assertEquals(listOf("tie1", "abc123DEF0"), all.map { it.id })
        val tie = all.first()
        assertEquals("fairness", tie.preset)
        assertEquals(LeanState.Tie, tie.original.result.leanState)
        val win = all.last()
        assertEquals(Fixtures.sample("win_a_self").nameMap, win.nameMap)
        assertEquals(AppLang.EN, win.lang)
        val row = db.history().get("abc123DEF0")!!
        assertEquals("side_a", row.verdict)
        assertEquals(4, row.confidence)
        assertEquals("free", row.tier)
        assertEquals(WireJson.json.parseToJsonElement(Fixtures.sample("win_a_self").result.rawJson), WireJson.json.parseToJsonElement(row.resultJson))
    }

    @Test
    fun replayWithEmptyNameMap_keepsTheStoredNames_andCreatedAt() = runBlocking {
        val first = Fixtures.sample("win_b_named")
        repo.save(first, "balanced")
        now = 9_999L
        repo.save(first.copy(nameMap = emptyList(), replayed = true), "balanced")
        val saved = repo.observe(first.id).first()!!
        assertEquals(first.nameMap, saved.nameMap)
        assertEquals(1_000L, saved.createdAt)
    }

    @Test
    fun aLaterRuling_replacesWhatTheEntryShows_butKeepsItsIdDateAndNames() = runBlocking {
        val first = Fixtures.sample("win_b_named")
        repo.save(first, "balanced")
        repo.cacheTranslation(first.id, AppLang.TR, Fixtures.sample("lean_tie").result)
        now = 5_000L
        val later = Fixtures.sample("win_a_self")
        repo.saveRuling(first.id, later.copy(id = "r1", nameMap = first.nameMap.take(1) + NameMapping("Kim", "Person C")))
        val saved = repo.observe(first.id).first()!!
        assertEquals("r1", saved.rulingId)
        assertEquals(1_000L, saved.createdAt)
        assertEquals("balanced", saved.preset)
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
        repo.save(outcome, "balanced")
        assertEquals(outcome.id, repo.observe(outcome.id).first()!!.rulingId)
    }

    @Test
    fun translations_areCachedPerLanguage() = runBlocking {
        val outcome = Fixtures.sample("win_a_self")
        repo.save(outcome, "balanced")
        val tr = WireJson.decodeTranslateResponse(Fixtures.verdicts["translateResponse"].toString()).result
        repo.cacheTranslation(outcome.id, AppLang.TR, tr)
        val saved = repo.observe(outcome.id).first()!!
        assertEquals(setOf(AppLang.TR), saved.translations.keys)
        assertEquals(tr.result.headline, saved.translations[AppLang.TR]!!.result.headline)
        // Saving the same id again (replay) keeps the cache.
        repo.save(outcome, "balanced")
        assertTrue(repo.observe(outcome.id).first()!!.translations.containsKey(AppLang.TR))
    }

    @Test
    fun delete_andDeleteAll() = runBlocking {
        repo.save(Fixtures.sample("split"), "balanced")
        repo.save(Fixtures.sample("conditional"), "balanced")
        val ids = repo.observeAll().first().map { it.id }
        repo.delete(ids.first())
        assertEquals(1, repo.observeAll().first().size)
        repo.deleteAll()
        assertEquals(0, repo.observeAll().first().size)
        assertNull(repo.observe(ids.last()).first())
    }
}
