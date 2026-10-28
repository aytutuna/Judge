package com.okjudge.judge.core.model

import com.okjudge.judge.Fixtures
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WireJsonTest {
    @Test
    fun everySample_decodes_andKeepsItsRawJson() {
        assertEquals(9, Fixtures.sampleNames.size)
        for (name in Fixtures.sampleNames) {
            val outcome = Fixtures.sample(name)
            val raw = Fixtures.verdicts["verdictResponses"]!!.jsonObject[name]!!.jsonObject
            assertEquals(name, raw["id"]!!.let { (it as JsonPrimitive).content }, outcome.id)
            assertEquals(name, raw["result"], WireJson.json.parseToJsonElement(outcome.result.rawJson))
            assertTrue(name, VerdictShape.looksLikeVerdict(raw["result"]))
            assertTrue(name, outcome.result.result.finalVerdict != FinalVerdict.UNKNOWN)
            assertTrue(name, outcome.result.result.dispute != DisputeType.UNKNOWN)
        }
    }

    @Test
    fun lean_absentNullAndPresent_areThreeStates() {
        assertEquals(LeanState.None, Fixtures.sample("win_a_self").result.result.leanState)
        assertEquals(LeanState.Tie, Fixtures.sample("lean_tie").result.result.leanState)
        val leans = Fixtures.sample("lean_b_majority_escalated").result.result.leanState
        assertTrue(leans is LeanState.Leans && leans.lean.party == "b")
        // The raw JSON keeps the null, so a history round trip keeps the tie.
        val again = WireJson.decodeResult(Fixtures.sample("lean_tie").result.rawJson).result
        assertEquals(LeanState.Tie, again.leanState)
    }

    @Test
    fun unknownEnumsAndFields_doNotFailTheVerdict() {
        val body = """
            {"id":"x1","name_map":[],"future_field":1,"result":{
              "verdict":"hung_jury","dispute_type":"cosmic","headline":"h","crux":"c",
              "split_points":null,"conditional":null,
              "argument_map":{"side_a":[{"claim":"a","kind":"vibe"}],"side_b":[{"claim":"b","kind":"fact"}],"bedrock_a":"x","bedrock_b":"y"},
              "facts_relied_on":[],"losing_side_best_point":"p","confidence":9,"runs":["side_a","abstain"],
              "demo":false,"new_thing":{"a":1}}}
        """.trimIndent()
        val out = WireJson.decodeVerdictResponse(body)
        val r = out.result.result
        assertEquals(FinalVerdict.UNKNOWN, r.finalVerdict)
        assertEquals(DisputeType.UNKNOWN, r.dispute)
        assertEquals(ClaimKind.UNKNOWN, r.argumentMap.sideA[0].claimKind)
        assertEquals(9, r.confidence)
        assertTrue(out.result.rawJson.contains("new_thing"))
        assertFalse(VerdictShape.looksLikeVerdict(WireJson.json.parseToJsonElement(out.result.rawJson)))
    }

    @Test
    fun translateAndStoredBodies_decode() {
        val t = WireJson.decodeTranslateResponse(Fixtures.verdicts["translateResponse"].toString())
        assertEquals("tr", t.lang)
        assertTrue(t.translated)
        assertTrue(VerdictShape.looksLikeVerdict(WireJson.json.parseToJsonElement(t.result.rawJson)))
        val stored = WireJson.decodeStoredVerdict(Fixtures.verdicts["storedVerdictResponse"].toString())
        assertTrue(stored.createdAt.isNotEmpty())
    }

    @Test
    fun errorBodies_decode() {
        for (e in Fixtures.verdicts["errorBodies"]!!.let { it as kotlinx.serialization.json.JsonArray }) {
            val body = (e.jsonObject["body"] as? JsonObject)?.toString()
            val parsed = WireJson.decodeErrorBody(body)
            if (body == null) assertEquals(null, parsed) else assertEquals(e.jsonObject["body"]!!.jsonObject["code"]?.let { (it as JsonPrimitive).content }, parsed?.code)
        }
        assertEquals(null, WireJson.decodeErrorBody("<html>502 Bad Gateway</html>"))
        assertEquals(30.0, WireJson.decodeErrorBody("""{"code":"rate_limited","retryAfterSec":30}""")!!.retryAfterSec!!, 0.0)
    }

    @Test
    fun request_encodesTheWireShape() {
        val json = WireJson.json.encodeToString(
            VerdictRequest.serializer(),
            VerdictRequest(argument = "abc", lang = "tr"),
        )
        assertEquals("""{"argument":"abc","lang":"tr","tier":"premium"}""", json)
    }

    @Test
    fun shapeCheck_rejectsMissingPieces() {
        val good = Fixtures.verdicts["verdictResponses"]!!.jsonObject["split"]!!.jsonObject["result"]!!.jsonObject
        assertTrue(VerdictShape.looksLikeVerdict(good))
        for (key in listOf("verdict", "headline", "split_points", "demo", "argument_map", "runs")) {
            assertFalse(key, VerdictShape.looksLikeVerdict(JsonObject(good - key)))
        }
        assertFalse(VerdictShape.looksLikeVerdict(JsonObject(good + ("confidence" to JsonPrimitive(6)))))
        assertFalse(VerdictShape.looksLikeVerdict(JsonObject(good + ("confidence" to JsonPrimitive(2.5)))))
    }

    @Test
    fun why_isOptional() {
        val withWhy = Fixtures.sample("win_a_self").result.result
        assertTrue(withWhy.why!!.startsWith("Party B's case rests on shape alone."))
        assertEquals(null, Fixtures.sample("win_b_named").result.result.why)
        val t = WireJson.decodeTranslateResponse(Fixtures.verdicts["translateResponse"].toString())
        assertTrue(t.result.result.why!!.startsWith("Taraf B'nin dayanağı sadece şekil."))

        val raw = Fixtures.verdicts["verdictResponses"]!!.jsonObject["win_a_self"]!!.jsonObject["result"]!!.jsonObject
        assertTrue(VerdictShape.looksLikeVerdict(JsonObject(raw - "why")))
        assertFalse(VerdictShape.looksLikeVerdict(JsonObject(raw + ("why" to JsonPrimitive(3)))))
    }
}
