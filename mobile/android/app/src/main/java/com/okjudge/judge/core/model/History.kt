package com.okjudge.judge.core.model

import kotlinx.serialization.SerializationException
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/** One row of GET /api/v1/me/history (HistoryRow in lib/history-types.ts), from the viewer's side. */
@Serializable
data class HistoryItem(
    val kind: String = "verdict",
    val id: String = "",
    val role: String = "owner",
    val party: String = "a",
    /** Sort time, ISO; compared as a plain string like the server does. */
    val at: String = "",
    val createdAt: String = "",
    /** A [HistoryState] value; one this build doesn't know gets no label. */
    val state: String = "",
    val yourMove: Boolean = false,
    val verdict: String? = null,
    val contextAdded: Boolean = false,
    val contextBy: String? = null,
    val headline: String? = null,
    val excerpt: String? = null,
    val nameMap: List<NameMapping> = emptyList(),
    val expiresAt: String? = null,
    val removed: Boolean = false,
    val removable: Boolean = false,
    val inviteToken: String? = null,
) {
    val isCase: Boolean get() = kind == "case"
    val isRespondent: Boolean get() = role == "respondent"
    val key: String get() = historyKey(kind, id)
    val historyState: HistoryState? get() = HistoryState.of(state)
}

enum class HistoryState(val raw: String) {
    JUDGING("judging"),
    FAILED("failed"),
    READY("ready"),
    REJUDGING("rejudging"),
    REJUDGE_FAILED("rejudge_failed"),
    WAITING("waiting"),
    EXPIRED("expired"),
    REMOVED("removed"),
    REMOVED_BY_OTHER("removed_by_other"),
    ;

    val thinking: Boolean get() = this == JUDGING || this == REJUDGING

    companion object {
        fun of(raw: String): HistoryState? = entries.firstOrNull { it.raw == raw }
    }
}

data class HistoryPage(val items: List<HistoryItem>, val next: String?)

/** "v:<id>" for verdicts, "c:<id>" for cases (historyKey). */
fun historyKey(kind: String, id: String): String = "${if (kind == "case") "c" else "v"}:$id"

/** Newest first: `at`, then key, both as plain strings (compareHistory). */
val HistoryOrder: Comparator<Pair<String, String>> = Comparator { x, y ->
    when {
        x.first != y.first -> y.first.compareTo(x.first)
        else -> y.second.compareTo(x.second)
    }
}

/** A page; rows this build can't read are left out rather than failing the page. */
fun decodeHistoryPage(body: String): HistoryPage {
    val root = WireJson.json.parseToJsonElement(body) as? JsonObject ?: throw SerializationException("not an object")
    val items = (root["items"] as? JsonArray ?: throw SerializationException("missing items")).mapNotNull { element ->
        try {
            WireJson.json.decodeFromJsonElement(HistoryItem.serializer(), element).takeIf { it.id.isNotEmpty() && it.at.isNotEmpty() }
        } catch (_: SerializationException) {
            null
        } catch (_: IllegalArgumentException) {
            null
        }
    }
    return HistoryPage(items, (root["next"] as? JsonPrimitive)?.contentOrNull?.takeIf { it.isNotEmpty() })
}

/** GET /api/v1/verdicts/{id}/mine, the parts the app reads to keep an account verdict on the phone. */
data class MineVerdict(val result: ParsedResult?, val nameMap: List<NameMapping>, val removed: Boolean)

fun decodeMineVerdict(body: String): MineVerdict {
    val root = WireJson.json.parseToJsonElement(body) as? JsonObject ?: throw SerializationException("not an object")
    val result = root["result"]?.takeIf { it is JsonObject }?.let { WireJson.decodeResult(it) }
    return MineVerdict(result, WireJson.decodeNameMap(root["nameMap"]?.toString()), root["removed"] is JsonObject)
}
