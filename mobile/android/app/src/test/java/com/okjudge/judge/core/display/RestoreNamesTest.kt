package com.okjudge.judge.core.display

import com.okjudge.judge.Fixtures
import com.okjudge.judge.core.model.VerdictResult
import com.okjudge.judge.i18n.AppLang
import com.okjudge.judge.str
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertSame
import org.junit.Test

/** restoreNames and personalizeResult against the strings the web code produced. */
class RestoreNamesTest {
    private val fields = listOf(
        "headline", "crux", "losing_side_best_point", "side_a", "side_b", "bedrock_a", "bedrock_b",
        "facts_relied_on", "split_points", "conditional_if_value", "conditional_then", "lean_reason",
        "crux_trial_attack", "crux_trial_reasoning", "fact_check_claims", "fact_check_summaries",
    )

    /** The flat field set of export-fixtures.ts `personalizedFields`. */
    private fun flat(p: VerdictResult): Map<String, Any?> = mapOf(
        "headline" to p.headline,
        "crux" to p.crux,
        "losing_side_best_point" to p.losingSideBestPoint,
        "side_a" to p.argumentMap.sideA.map { it.claim },
        "side_b" to p.argumentMap.sideB.map { it.claim },
        "bedrock_a" to p.argumentMap.bedrockA,
        "bedrock_b" to p.argumentMap.bedrockB,
        "facts_relied_on" to p.factsReliedOn,
        "split_points" to p.splitPoints?.map { it.point },
        "conditional_if_value" to p.conditional?.map { it.ifValue },
        "conditional_then" to p.conditional?.map { it.then },
        "lean_reason" to p.lean?.reason,
        "crux_trial_attack" to p.cruxTrial?.attack,
        "crux_trial_reasoning" to p.cruxTrial?.reasoning,
        "fact_check_claims" to p.factCheck?.claims?.map { it.claim },
        "fact_check_summaries" to p.factCheck?.claims?.map { it.summary },
    )

    private fun plain(e: JsonElement?): Any? = when (e) {
        null, JsonNull -> null
        is JsonArray -> e.map { it.jsonPrimitive.content }
        else -> e.jsonPrimitive.content
    }

    private fun assertFields(where: String, expected: JsonObject, actual: VerdictResult) {
        val got = flat(actual)
        for (key in fields) {
            assertEquals("$where/$key", plain(expected[key]), got[key])
        }
    }

    @Test
    fun restoreCases_matchTheWeb() {
        val cases = Fixtures.list("restore")
        assertEquals(46, cases.size)
        for (c in cases) {
            val text = c.str("text")!!
            val parties = PartyNames.resolveParties(Fixtures.nameMap(c["nameMap"]!!), AppLang.fromTag(c.str("selfLang"))!!)
            val actual = RestoreNames.restoreNames(text, parties, AppLang.fromTag(c.str("textLang"))!!)
            assertEquals(text, c.str("expected"), actual)
        }
    }

    @Test
    fun personalizedVerdicts_matchTheWeb() {
        val vectors = Fixtures.list("verdicts")
        assertEquals(18, vectors.size)
        for (v in vectors) {
            val sample = v.str("sample")!!
            val outcome = Fixtures.sample(sample)
            val r = outcome.result.result
            val selfLang = AppLang.fromTag(v.str("selfLang"))!!
            val p = RestoreNames.personalizeResult(r, outcome.nameMap, selfLang)
            assertFields("$sample/${v.str("lang")}", v["personalized"]!!.jsonObject, p)
            // Display-only rewrite: the lean's three states survive the copy.
            assertEquals(sample, r.leanState::class, p.leanState::class)
            assertEquals(sample, r.leanPresent, p.leanPresent)
            assertEquals(sample, RestoreNames.headline(r, outcome.nameMap, selfLang), p.headline)
        }
    }

    @Test
    fun personalizedTranslation_followsTheTextLanguage_andTheOriginalsNarrator() {
        val cases = Fixtures.list("personalizedTranslations")
        assertEquals(1, cases.size)
        for (c in cases) {
            val sample = c.str("sample")!!
            val outcome = Fixtures.sample(sample)
            val lang = AppLang.fromTag(c.str("lang"))!!
            val selfLang = AppLang.fromTag(c.str("selfLang"))!!
            assertEquals(selfLang, ContentLang.verdictLang(outcome.result.result))
            val translated = Fixtures.translationOf(outcome.id, lang)
            assertNotNull("$sample/${lang.tag}", translated)
            assertEquals(lang, ContentLang.verdictLang(translated!!))
            val p = RestoreNames.personalizeResult(translated, outcome.nameMap, selfLang)
            assertFields("$sample/${lang.tag}", c, p)
            assertEquals(sample, RestoreNames.headline(translated, outcome.nameMap, selfLang), p.headline)
        }
    }

    @Test
    fun noNames_returnsTheSameResult() {
        val r = Fixtures.sample("win_a_self").result.result
        assertSame(r, RestoreNames.personalizeResult(r, emptyList(), AppLang.EN))
        assertSame(r, RestoreNames.personalizeResult(r, null, AppLang.TR))
        assertEquals(r.headline, RestoreNames.headline(r, emptyList(), AppLang.EN))
    }
}
