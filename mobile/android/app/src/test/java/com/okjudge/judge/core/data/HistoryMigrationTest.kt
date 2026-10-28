package com.okjudge.judge.core.data

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import androidx.test.core.app.ApplicationProvider
import com.okjudge.judge.Fixtures
import com.okjudge.judge.core.model.HistoryItem
import com.okjudge.judge.core.model.HistoryPage
import com.okjudge.judge.core.model.WireJson
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File

/** A store written by the version-2 app opens in version 3 with every row as it was. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class HistoryMigrationTest {
    private val context: Context = ApplicationProvider.getApplicationContext()

    /** Creates history.db exactly as schema 2 (schemas/.../2.json) describes it. */
    private fun writeVersion2(rows: Int) {
        val schema = WireJson.json.parseToJsonElement(File("schemas/com.okjudge.judge.core.data.HistoryDb/2.json").readText())
            .jsonObject["database"]!!.jsonObject
        val file = context.getDatabasePath(HistoryDb.NAME)
        file.parentFile?.mkdirs()
        file.delete()
        val db = SQLiteDatabase.openOrCreateDatabase(file, null)
        for (entity in schema["entities"]!!.jsonArray) {
            val table = entity.jsonObject["tableName"]!!.jsonPrimitive.content
            db.execSQL(entity.jsonObject["createSql"]!!.jsonPrimitive.content.replace("\${TABLE_NAME}", table))
        }
        for (query in schema["setupQueries"]!!.jsonArray) db.execSQL(query.jsonPrimitive.content)
        val sample = Fixtures.sample("win_b_named")
        repeat(rows) { i ->
            db.execSQL(
                "INSERT INTO saved_verdicts (id, created_at, headline, verdict, lang, confidence, preset, tier, result_json, name_map_json, translations_json, ruling_id) " +
                    "VALUES (?, ?, ?, ?, 'en', 4, 'balanced', 'free', ?, ?, NULL, ?)",
                arrayOf<Any?>("old$i", 1_000L + i, sample.result.result.headline, sample.result.result.verdict, sample.result.rawJson, WireJson.encodeNameMap(sample.nameMap), if (i == 0) "round1" else null),
            )
        }
        db.version = 2
        db.close()
    }

    @Test
    fun version2Store_opensWithEveryRow_andTheListCache() = runBlocking {
        writeVersion2(rows = 3)
        val db = HistoryDb.create(context)
        try {
            val repo = RoomHistoryRepository(db)
            val all = repo.observeAll().first()
            assertEquals(listOf("old2", "old1", "old0"), all.map { it.id })
            assertEquals("round1", all.last().rulingId)
            assertEquals(Fixtures.sample("win_b_named").nameMap, all.first().nameMap)
            all.forEach { assertNull("old rows belong to no account yet", it.ownerUserId) }

            val at = "2026-10-05T00:00:00.000Z"
            repo.applyPage("u1", HistoryPage(listOf(HistoryItem(kind = "verdict", id = "old1", at = at, state = "ready")), null), above = null)
            assertEquals(listOf("v:old1"), repo.observeCached("u1").first().map { it.key })
            assertEquals("u1", repo.observe("old1").first()!!.ownerUserId)
            assertEquals(3, repo.observeAll().first().size)
        } finally {
            db.close()
        }
    }
}
