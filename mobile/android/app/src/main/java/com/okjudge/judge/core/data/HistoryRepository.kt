package com.okjudge.judge.core.data

import com.okjudge.judge.core.display.ContentLang
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

/** A saved verdict, decoded. */
data class SavedVerdict(
    val id: String,
    val createdAt: Long,
    val original: ParsedResult,
    val nameMap: List<NameMapping>,
    val translations: Map<AppLang, ParsedResult>,
    /** Whose verdict [original] is: [id], or the round of added context that ruled last. */
    val rulingId: String = id,
) {
    val lang: AppLang get() = ContentLang.verdictLang(original.result)
}

/** "My verdicts": stored on this phone only. */
interface HistoryRepository {
    fun observeAll(): Flow<List<SavedVerdict>>
    fun observe(id: String): Flow<SavedVerdict?>
    suspend fun save(outcome: VerdictOutcome)

    /** A later ruling on saved verdict [id] (added context): the entry keeps its id and date and shows [ruling]. */
    suspend fun saveRuling(id: String, ruling: VerdictOutcome)
    suspend fun cacheTranslation(id: String, lang: AppLang, translation: ParsedResult)
    suspend fun delete(id: String)
    suspend fun deleteAll()
}

class RoomHistoryRepository(
    private val dao: HistoryDao,
    private val clock: () -> Long = System::currentTimeMillis,
) : HistoryRepository {

    override fun observeAll(): Flow<List<SavedVerdict>> = dao.observeAll().map { rows -> rows.mapNotNull(::decode) }

    override fun observe(id: String): Flow<SavedVerdict?> = dao.observe(id).map { row -> row?.let(::decode) }

    override suspend fun save(outcome: VerdictOutcome) {
        val result = outcome.result.result
        val existing = dao.get(outcome.id)
        // An idempotent replay returns an empty name map: keep the one we have.
        val nameMap = if (outcome.nameMap.isEmpty() && existing != null) existing.nameMapJson
        else WireJson.encodeNameMap(outcome.nameMap)
        dao.upsert(
            SavedVerdictRow(
                id = outcome.id,
                createdAt = existing?.createdAt ?: clock(),
                headline = result.headline,
                verdict = result.verdict,
                lang = ContentLang.verdictLang(result).tag,
                confidence = result.confidence,
                tier = result.tier ?: "free",
                resultJson = outcome.result.rawJson,
                nameMapJson = nameMap,
                translationsJson = existing?.translationsJson,
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
