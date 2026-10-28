package com.okjudge.judge.core.data

import androidx.room.withTransaction
import com.okjudge.judge.core.display.ContentLang
import com.okjudge.judge.core.model.HistoryItem
import com.okjudge.judge.core.model.HistoryOrder
import com.okjudge.judge.core.model.HistoryPage
import com.okjudge.judge.core.model.MineVerdict
import com.okjudge.judge.core.model.NameMapping
import com.okjudge.judge.core.model.ParsedResult
import com.okjudge.judge.core.model.VerdictOutcome
import com.okjudge.judge.core.model.WireJson
import com.okjudge.judge.i18n.AppLang
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException

/** A saved verdict, decoded. */
data class SavedVerdict(
    val id: String,
    val createdAt: Long,
    val original: ParsedResult,
    val nameMap: List<NameMapping>,
    val translations: Map<AppLang, ParsedResult>,
    /** Whose verdict [original] is: [id], or the round of added context that ruled last. */
    val rulingId: String = id,
    /** The account it was judged in or listed by; null: judged signed out or by an older version. */
    val ownerUserId: String? = null,
) {
    val lang: AppLang get() = ContentLang.verdictLang(original.result)
}

/**
 * Verdicts kept on the phone for offline reading, and the account's Verdicts
 * list as last loaded (the server's list wins; this is its cache).
 */
interface HistoryRepository {
    fun observeAll(): Flow<List<SavedVerdict>>
    fun observe(id: String): Flow<SavedVerdict?>
    suspend fun save(outcome: VerdictOutcome)

    /** A later ruling on saved verdict [id] (added context): the entry keeps its id and date and shows [ruling]. */
    suspend fun saveRuling(id: String, ruling: VerdictOutcome)
    suspend fun cacheTranslation(id: String, lang: AppLang, translation: ParsedResult)
    suspend fun delete(id: String)
    suspend fun deleteAll()

    /** The account's list rows as last loaded, newest first. */
    fun observeCached(user: String): Flow<List<HistoryItem>>

    /** The account the cache was last filled for. */
    suspend fun cachedUser(): String?

    /** [user] is signed in: other accounts' rows leave the phone. Null: signed out (rows stay, unlisted). */
    suspend fun setAccount(user: String?)

    /** Signed out or deleted by the user: every account's rows leave; verdicts with no account stay. */
    suspend fun forgetAccounts()

    /**
     * One page of the account's list. Cached rows between [above] (the
     * previous page's last row; null for the first page) and this page's last
     * row that the page lacks are gone on the server; with no page after this
     * one, so is everything below it.
     */
    suspend fun applyPage(user: String, page: HistoryPage, above: HistoryItem?)

    suspend fun updateCached(user: String, item: HistoryItem)

    /** An account verdict read from the server, kept for offline reading. */
    suspend fun keep(user: String, item: HistoryItem, mine: MineVerdict)
}

/** ISO time with milliseconds, as the server writes it, so the two compare as strings. */
fun isoMillis(epochMs: Long): String = ISO.format(Instant.ofEpochMilli(epochMs))

fun parseIso(iso: String): Long? = try {
    Instant.parse(iso).toEpochMilli()
} catch (_: DateTimeParseException) {
    null
}

private val ISO: DateTimeFormatter = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC)

/** Whether ([at], [key]) lies between [lower] (included) and [upper] (excluded); null bounds are open. */
internal fun inWindow(at: String, key: String, lower: HistoryItem?, upper: HistoryItem?): Boolean {
    val p = at to key
    if (lower != null && HistoryOrder.compare(p, lower.at to lower.key) > 0) return false
    if (upper != null && HistoryOrder.compare(p, upper.at to upper.key) <= 0) return false
    return true
}

class RoomHistoryRepository(
    private val db: HistoryDb,
    private val clock: () -> Long = System::currentTimeMillis,
) : HistoryRepository {
    private val dao = db.history()

    @Volatile private var account: String? = null

    override fun observeAll(): Flow<List<SavedVerdict>> = dao.observeAll().map { rows -> rows.mapNotNull(::decode) }

    override fun observe(id: String): Flow<SavedVerdict?> = dao.observe(id).map { row -> row?.let(::decode) }

    override suspend fun save(outcome: VerdictOutcome) {
        val existing = dao.get(outcome.id)
        write(outcome, existing, existing?.createdAt ?: clock(), existing?.ownerUserId ?: account)
        // Listed at once; the next load of the list confirms it.
        val user = account ?: return
        if (dao.cachedRow(user, "v:${outcome.id}") != null) return
        val result = outcome.result.result
        val item = HistoryItem(
            kind = "verdict",
            id = outcome.id,
            at = isoMillis(clock()),
            createdAt = isoMillis(clock()),
            state = "ready",
            verdict = result.verdict,
            headline = result.headline,
            nameMap = outcome.nameMap,
            removable = true,
        )
        dao.upsertCached(listOf(cacheRow(user, item)))
    }

    private suspend fun write(outcome: VerdictOutcome, existing: SavedVerdictRow?, createdAt: Long, owner: String?) {
        val result = outcome.result.result
        // An idempotent replay returns an empty name map: keep the one we have.
        val nameMap = if (outcome.nameMap.isEmpty() && existing != null) existing.nameMapJson
        else WireJson.encodeNameMap(outcome.nameMap)
        dao.upsert(
            SavedVerdictRow(
                id = outcome.id,
                createdAt = createdAt,
                headline = result.headline,
                verdict = result.verdict,
                lang = ContentLang.verdictLang(result).tag,
                confidence = result.confidence,
                tier = result.tier ?: "free",
                resultJson = outcome.result.rawJson,
                nameMapJson = nameMap,
                translationsJson = existing?.translationsJson,
                ownerUserId = owner,
            ),
        )
    }

    override suspend fun saveRuling(id: String, ruling: VerdictOutcome) {
        val row = dao.get(id) ?: return
        val result = ruling.result.result
        // The round's own people join the writer's names (withRoundNames).
        val names = WireJson.decodeNameMap(row.nameMapJson)
        val have = names.map { it.replacement }.toSet()
        dao.upsert(
            row.copy(
                headline = result.headline,
                verdict = result.verdict,
                lang = ContentLang.verdictLang(result).tag,
                confidence = result.confidence,
                tier = result.tier ?: "free",
                resultJson = ruling.result.rawJson,
                nameMapJson = WireJson.encodeNameMap(names + ruling.nameMap.filter { it.replacement !in have }),
                // Translations of the earlier ruling no longer apply.
                translationsJson = null,
                rulingId = ruling.id,
            ),
        )
        val user = account ?: return
        val listed = dao.cachedRow(user, "v:$id")?.let(::decodeItem) ?: return
        val updated = listed.copy(state = "ready", yourMove = false, verdict = result.verdict, headline = result.headline, contextAdded = true)
        dao.upsertCached(listOf(cacheRow(user, updated)))
    }

    override suspend fun cacheTranslation(id: String, lang: AppLang, translation: ParsedResult) {
        val row = dao.get(id) ?: return
        val current = parseTranslations(row.translationsJson)
        val merged = buildJsonObject {
            current.forEach { (k, v) -> put(k, v) }
            put(lang.tag, WireJson.json.parseToJsonElement(translation.rawJson))
        }
        dao.setTranslations(id, merged.toString())
    }

    override suspend fun delete(id: String) = dao.delete(id)

    override suspend fun deleteAll() = dao.deleteAll()

    override fun observeCached(user: String): Flow<List<HistoryItem>> =
        dao.observeCached(user).map { rows -> rows.mapNotNull(::decodeItem) }

    override suspend fun cachedUser(): String? = dao.anyCachedUser()

    override suspend fun setAccount(user: String?) {
        account = user
        if (user == null) return
        db.withTransaction {
            dao.deleteCachedOfOthers(user)
            dao.deleteSavedOfOthers(user)
        }
    }

    override suspend fun forgetAccounts() {
        account = null
        db.withTransaction {
            dao.deleteAllCached()
            dao.deleteSavedOfAccounts()
        }
    }

    override suspend fun applyPage(user: String, page: HistoryPage, above: HistoryItem?) = db.withTransaction {
        val keys = page.items.map { it.key }.toSet()
        val lower = if (page.next == null) null else page.items.lastOrNull()
        val gone = dao.cached(user).filter { it.key !in keys && inWindow(it.at, it.key, lower, above) }
        if (gone.isNotEmpty()) dao.deleteCached(user, gone.map { it.key })
        dao.upsertCached(page.items.map { cacheRow(user, it) })
        for (item in page.items) {
            if (item.isCase) continue
            // Removed from the account: the text and names leave this phone too.
            if (item.removed) dao.delete(item.id) else dao.claimSaved(item.id, user)
        }
    }

    override suspend fun updateCached(user: String, item: HistoryItem) = dao.upsertCached(listOf(cacheRow(user, item)))

    override suspend fun keep(user: String, item: HistoryItem, mine: MineVerdict) {
        val result = mine.result ?: return
        write(VerdictOutcome(item.id, result, mine.nameMap), dao.get(item.id), parseIso(item.at) ?: clock(), user)
    }

    private fun cacheRow(user: String, item: HistoryItem) = HistoryCacheRow(
        userId = user,
        key = item.key,
        kind = item.kind,
        itemId = item.id,
        at = item.at,
        json = WireJson.json.encodeToString(HistoryItem.serializer(), item),
    )

    private fun decodeItem(row: HistoryCacheRow): HistoryItem? = try {
        WireJson.json.decodeFromString(HistoryItem.serializer(), row.json)
    } catch (_: SerializationException) {
        null
    } catch (_: IllegalArgumentException) {
        null
    }

    private fun decode(row: SavedVerdictRow): SavedVerdict? = try {
        val translations = parseTranslations(row.translationsJson).mapNotNull { (tag, element) ->
            val lang = AppLang.fromTag(tag) ?: return@mapNotNull null
            try {
                lang to WireJson.decodeResult(element)
            } catch (_: SerializationException) {
                null
            } catch (_: IllegalArgumentException) {
                null
            }
        }.toMap()
        SavedVerdict(
            id = row.id,
            createdAt = row.createdAt,
            original = WireJson.decodeResult(row.resultJson),
            nameMap = WireJson.decodeNameMap(row.nameMapJson),
            translations = translations,
            rulingId = row.rulingId ?: row.id,
            ownerUserId = row.ownerUserId,
        )
    } catch (_: SerializationException) {
        null
    } catch (_: IllegalArgumentException) {
        null
    }

    private fun parseTranslations(raw: String?): JsonObject {
        if (raw.isNullOrBlank()) return JsonObject(emptyMap())
        return try {
            WireJson.json.parseToJsonElement(raw) as? JsonObject ?: JsonObject(emptyMap())
        } catch (_: SerializationException) {
            JsonObject(emptyMap())
        }
    }
}
