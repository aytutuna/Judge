package com.okjudge.judge

import com.okjudge.judge.core.model.NameMapping
import com.okjudge.judge.core.model.VerdictOutcome
import com.okjudge.judge.core.model.WireJson
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * Golden data exported from the web code (mobile/shared/fixtures, on the
 * test classpath via the `test` source set's resources).
 */
object Fixtures {
    private fun load(name: String): JsonObject {
        val stream = Fixtures::class.java.classLoader!!.getResourceAsStream(name)
            ?: error("$name not on the test classpath (mobile/shared/fixtures)")
        return Json.parseToJsonElement(stream.bufferedReader(Charsets.UTF_8).readText()).jsonObject
    }

    val verdicts: JsonObject by lazy { load("verdicts.json") }
    val vectors: JsonObject by lazy { load("display-vectors.json") }

    val sampleNames: List<String> get() = verdicts["verdictResponses"]!!.jsonObject.keys.toList()

    fun sampleJson(name: String): String = verdicts["verdictResponses"]!!.jsonObject[name]!!.toString()

    fun sample(name: String): VerdictOutcome = WireJson.decodeVerdictResponse(sampleJson(name))

    fun nameMap(element: JsonElement): List<NameMapping> = element.jsonArray.map {
        NameMapping(it.jsonObject.str("original")!!, it.jsonObject.str("replacement")!!)
    }

    fun list(key: String): List<JsonObject> = vectors[key]!!.jsonArray.map { it.jsonObject }
}

fun JsonObject.str(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content
fun JsonObject.num(key: String): Double? = (this[key] as? JsonPrimitive)?.takeIf { !it.isString }?.doubleOrNull
fun JsonObject.bool(key: String): Boolean? = (this[key] as? JsonPrimitive)?.booleanOrNull
fun JsonObject.isNull(key: String): Boolean = this[key] == null || this[key] is JsonNull
fun JsonElement.arr(): JsonArray = jsonArray
fun JsonElement.prim(): JsonPrimitive = jsonPrimitive
