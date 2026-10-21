package com.okjudge.judge.core.model

import kotlinx.serialization.SerializationException
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.longOrNull

/** JSON setup and decoders for the /api/v1 bodies. */
object WireJson {
    val json: Json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
        coerceInputValues = true
        encodeDefaults = true
        isLenient = false
    }

    /** Decodes a VerdictResult object, keeping the absent/null difference of `lean`. */
    fun decodeResult(element: JsonElement): ParsedResult {
        val obj = element as? JsonObject ?: throw SerializationException("result is not an object")
        val result = json.decodeFromJsonElement(VerdictResult.serializer(), obj)
            .copy(leanPresent = obj.containsKey("lean"))
        return ParsedResult(result, obj.toString())
    }

    fun decodeResult(rawJson: String): ParsedResult = decodeResult(json.parseToJsonElement(rawJson))

    fun decodeVerdictResponse(body: String): VerdictOutcome {
        val root = json.parseToJsonElement(body).jsonObject
        val id = root.string("id") ?: throw SerializationException("missing id")
        val result = decodeResult(root["result"] ?: throw SerializationException("missing result"))
        val nameMap = decodeNameMapElement(root["name_map"])
        val replayed = (root["replayed"] as? JsonPrimitive)?.booleanOrNull ?: false
        return VerdictOutcome(id, result, nameMap, replayed, root.string("owner_token"))
    }

    /** The 202 body of an async verdict request. */
    fun decodeAccepted(body: String): VerdictAccepted {
        val root = json.parseToJsonElement(body).jsonObject
        return VerdictAccepted(
            id = root.string("id") ?: throw SerializationException("missing id"),
            pollAfterMs = root.long("pollAfterMs")?.takeIf { it >= 0 } ?: DEFAULT_POLL_AFTER_MS,
            nameMap = decodeNameMapElement(root["name_map"]),
            ownerToken = root.string("owner_token"),
            replayed = (root["replayed"] as? JsonPrimitive)?.booleanOrNull ?: false,
        )
    }

    /**
     * One poll answer. A body without `status` but with `id` and `result` is
     * a server from before async verdicts and counts as ready.
     */
    fun decodePoll(body: String): VerdictPoll {
        val root = json.parseToJsonElement(body).jsonObject
        return when (root.string("status")) {
            "judging" -> VerdictPoll.Judging(root.long("pollAfterMs")?.takeIf { it >= 0 })
            "failed" -> VerdictPoll.Failed(root.string("code") ?: "unavailable", root.string("error"))
            else -> VerdictPoll.Ready(
                id = root.string("id") ?: throw SerializationException("missing id"),
                result = decodeResult(root["result"] ?: throw SerializationException("missing result")),
            )
        }
    }

    /** What the server suggests between polls when it does not say (POLL_AFTER_MS). */
    const val DEFAULT_POLL_AFTER_MS = 2000L

    private fun decodeNameMapElement(element: JsonElement?): List<NameMapping> =
        (element as? JsonArray)?.let { json.decodeFromJsonElement(ListSerializer(NameMapping.serializer()), it) }
            ?: emptyList()

    private fun JsonObject.long(key: String): Long? =
        (this[key] as? JsonPrimitive)?.takeIf { !it.isString }?.let { it.longOrNull ?: it.contentOrNull?.toDoubleOrNull()?.toLong() }

    fun decodeTranslateResponse(body: String): TranslateOutcome {
        val root = json.parseToJsonElement(body).jsonObject
        val resultElement = root["result"] ?: throw SerializationException("missing result")
        return TranslateOutcome(
            id = root.string("id") ?: throw SerializationException("missing id"),
            lang = root.string("lang") ?: throw SerializationException("missing lang"),
            source = root.string("source") ?: "",
            translated = (root["translated"] as? JsonPrimitive)?.booleanOrNull ?: false,
            result = decodeResult(resultElement),
        )
    }

    fun decodeStoredVerdict(body: String): StoredVerdict {
        val root = json.parseToJsonElement(body).jsonObject
        return StoredVerdict(
            id = root.string("id") ?: throw SerializationException("missing id"),
            result = decodeResult(root["result"] ?: throw SerializationException("missing result")),
            createdAt = root.string("createdAt") ?: "",
        )
    }

    /** Null when the body is not a JSON object. */
    fun decodeErrorBody(body: String?): ApiErrorBody? {
        if (body.isNullOrBlank()) return null
        return try {
            val obj = json.parseToJsonElement(body) as? JsonObject ?: return null
            ApiErrorBody(
                error = obj.string("error"),
                code = obj.string("code"),
                retryAfterSec = (obj["retryAfterSec"] as? JsonPrimitive)?.takeIf { !it.isString }?.contentOrNull?.toDoubleOrNull(),
                resetsAt = obj.string("resetsAt"),
            )
        } catch (_: SerializationException) {
            null
        } catch (_: IllegalArgumentException) {
            null
        }
    }

    fun encodeNameMap(nameMap: List<NameMapping>): String =
        json.encodeToString(ListSerializer(NameMapping.serializer()), nameMap)

    fun decodeNameMap(raw: String?): List<NameMapping> {
        if (raw.isNullOrBlank()) return emptyList()
        return try {
            json.decodeFromString(ListSerializer(NameMapping.serializer()), raw)
        } catch (_: SerializationException) {
            emptyList()
        } catch (_: IllegalArgumentException) {
            emptyList()
        }
    }

    private fun JsonObject.string(key: String): String? =
        (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content
}

/**
 * Port of `looksLikeVerdict` (lib/use-translation.ts): a light shape check of
 * a translated verdict before it replaces the original on screen.
 */
object VerdictShape {
    private val FINAL = setOf("side_a", "side_b", "split", "conditional", "dissolved", "too_close")
    private val JUDGE = setOf("side_a", "side_b", "split", "conditional", "dissolved")
    private val DISPUTE = setOf("factual", "logical", "definitional", "values", "mixed")
    private val KINDS = setOf("fact", "value", "definition", "logic")

    fun looksLikeVerdict(x: JsonElement?): Boolean {
        val o = x as? JsonObject ?: return false
        val map = o["argument_map"] as? JsonObject ?: return false
        val confidence = (o["confidence"] as? JsonPrimitive)?.takeIf { !it.isString }
        val confidenceInt = confidence?.longOrNull ?: confidence?.contentOrNull?.toDoubleOrNull()?.let {
            if (it % 1.0 == 0.0) it.toLong() else null
        }
        return o.str("verdict") in FINAL &&
            o.str("dispute_type") in DISPUTE &&
            o.str("headline") != null &&
            o.str("crux") != null &&
            o.str("losing_side_best_point") != null &&
            confidenceInt != null && confidenceInt in 1..5 &&
            (o["runs"] as? JsonArray)?.all { (it as? JsonPrimitive)?.takeIf { p -> p.isString }?.content in JUDGE } == true &&
            (o["facts_relied_on"] as? JsonArray)?.all { (it as? JsonPrimitive)?.isString == true } == true &&
            nullOrArray(o["split_points"]) &&
            nullOrArray(o["conditional"]) &&
            (o["demo"] as? JsonPrimitive)?.let { !it.isString && it.booleanOrNull != null } == true &&
            claims(map["side_a"]) && claims(map["side_b"]) &&
            map.str("bedrock_a") != null && map.str("bedrock_b") != null
    }

    /** `null` or an array; an absent key fails, as in the web check. */
    private fun nullOrArray(x: JsonElement?): Boolean = x is JsonNull || x is JsonArray

    private fun claims(x: JsonElement?): Boolean {
        val arr = x as? JsonArray ?: return false
        return arr.isNotEmpty() && arr.all { c ->
            val obj = c as? JsonObject
            obj != null && obj.str("claim") != null && obj.str("kind") in KINDS
        }
    }

    private fun JsonObject.str(key: String): String? =
        (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content
}
