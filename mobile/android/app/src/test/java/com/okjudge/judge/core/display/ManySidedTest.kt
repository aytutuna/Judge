package com.okjudge.judge.core.display

import androidx.test.core.app.ApplicationProvider
import com.okjudge.judge.Fixtures
import com.okjudge.judge.arr
import com.okjudge.judge.bool
import com.okjudge.judge.core.cases.CaseLogic
import com.okjudge.judge.core.model.Side
import com.okjudge.judge.core.model.TrialOutcome
import com.okjudge.judge.core.model.VerdictResult
import com.okjudge.judge.core.model.WireJson
import com.okjudge.judge.i18n.AppLang
import com.okjudge.judge.i18n.LocalizedStrings
import com.okjudge.judge.i18n.Strings
import com.okjudge.judge.num
import com.okjudge.judge.prim
import com.okjudge.judge.str
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Verdicts with three or four sides against the website's own output (verdicts.json manySidedResponses,
 * display-vectors.json manySided and story-vectors.json summaries).
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class ManySidedTest {
    private val strings = LocalizedStrings(ApplicationProvider.getApplicationContext())
    private fun s(lang: String): Strings = strings.of(AppLang.fromTag(lang)!!)

    private fun letters(element: JsonElement?): List<String>? =
        (element as? JsonArray)?.map { it.jsonPrimitive.content }

    @Test
    fun theNewFieldsDecode() {
        val win = Fixtures.manySample("three_win_c").result.result
        assertEquals(listOf("a", "b", "c"), win.parties)
        assertEquals(Side.C, win.winnerSide)
        assertEquals(listOf(Vote.C, Vote.C, Vote.A), VerdictDisplay.votes(win))
        assertEquals(listOf("a", "b", "c"), win.sides?.map { it.party })
        assertEquals(listOf("a", "b"), win.others?.map { it.party })
        assertEquals(3, win.sideCount)
        assertEquals("the older projection stays valid for old readers", "too_close", win.verdict)

        val four = Fixtures.manySample("four_win_d_separate_accounts").result.result
        assertEquals(Side.D, four.winnerSide)
        assertEquals(1, four.evidenceUsed?.c)
        assertEquals("d", four.disputes?.first()?.finding)
        assertEquals(listOf("a", "c", "d"), four.disputes?.first()?.positions?.map { it.party })
        assertEquals("unsettled", four.disputes?.last()?.finding)
        assertTrue(four.disputes!!.first().decisive)

        val tie = Fixtures.manySample("three_too_close").result.result
        assertNull(tie.winnerSide)
        assertEquals(listOf(Vote.A, Vote.OTHER, Vote.C), VerdictDisplay.votes(tie))
    }

    @Test
    fun twoSidedVerdictsCarryNoManySidedFields() {
        for (name in Fixtures.sampleNames) {
            val result = Fixtures.sample(name).result.result
            assertNull(name, result.parties)
            assertNull(name, result.winner)
            assertNull(name, result.votes)
            assertEquals(name, 2, result.sideCount)
        }
    }

    @Test
    fun anUnknownPartyListLeavesTheOlderProjection() {
        val body = """{"verdict":"too_close","headline":"h","parties":["a","b","q"],"winner":"q","votes":["q"]}"""
        val result = WireJson.decodeResult(body).result
        assertFalse("two known sides is not a many-sided verdict", result.isMany)
        assertNull(result.winnerSide)
        assertEquals(2, result.sideCount)
        // An unknown party is never drawn as Party A.
        assertNull(Side.of("q"))
        assertEquals(Vote.OTHER, VerdictDisplay.manyVoteOf("q"))
    }

    @Test
    fun manySidedVectors() {
        val vectors = Fixtures.list("manySided")
        assertTrue(vectors.isNotEmpty())
        for (v in vectors) {
            val name = v.str("sample")!!
            val lang = v.str("lang")!!
            val where = "$name/$lang"
            val outcome = Fixtures.manySample(name)
            val result = outcome.result.result
            val selfLang = ContentLang.verdictLang(result)
            assertEquals(where, AppLang.fromTag(v.str("selfLang")!!), selfLang)
            val sides = result.manySides!!
            assertEquals(where, letters(v["parties"]), sides.map { it.raw })
            assertEquals(where, v["winner"].takeIf { it !is JsonNull }?.jsonPrimitive?.content, result.winnerSide?.raw)

            val strings = s(lang)
            val names = PartyNames.partyNames(outcome.nameMap, selfLang, strings, result.sideCount)
            val expected = v["names"]!!.jsonObject
            assertEquals(where, expected.keys, sides.map { it.raw }.toSet())
            for (side in sides) {
                val want = expected[side.raw]!!.jsonObject
                assertEquals("$where/${side.raw}", want.str("name"), names.name(side))
                assertEquals("$where/${side.raw}", want.bool("self"), names.isSelf(side))
            }

            val asViewer = v["namesAsViewer"]!!.jsonObject
            for (viewer in sides) {
                val viewerNames = PartyNames.partyNamesFor(sides, emptyList(), selfLang, strings, viewer.letter, viewerKnown = true)
                for (side in sides) {
                    val want = asViewer[viewer.raw]!!.jsonObject[side.raw]!!.jsonObject
                    assertEquals("$where/${viewer.raw}/${side.raw}", want.str("name"), viewerNames.name(side))
                    assertEquals("$where/${viewer.raw}/${side.raw}", want.bool("self"), viewerNames.isSelf(side))
                }
            }

            assertEquals(where, v.str("label"), VerdictDisplay.verdictLabel(result, names, strings))
            assertEquals(where, v.str("confidence"), VerdictDisplay.confidenceLabel(result, strings))
            assertEquals(where, v.num("tugA")!!.toInt(), VerdictDisplay.tugFinal(result))
            assertNull(where, VerdictDisplay.leanShare(result))

            val outcomes = v["outcomes"]!!.jsonObject
            for (side in sides) {
                val want = outcomes[side.raw]!!.takeIf { it !is JsonNull }?.jsonPrimitive?.content
                assertEquals("$where/${side.raw}", want, VerdictDisplay.outcome(result, side)?.name?.lowercase())
            }
            assertNull(where, VerdictDisplay.outcome(result, null))
            assertTrue(where, v["outcomeWithoutViewer"] is JsonNull)

            checkRestored(result, outcome.nameMap, selfLang, v["personalized"]!!.jsonObject, where)
        }
    }

    private fun checkRestored(result: VerdictResult, nameMap: List<com.okjudge.judge.core.model.NameMapping>, selfLang: AppLang, want: JsonObject, where: String) {
        val restored = RestoreNames.personalizeResult(result, nameMap, selfLang)
        assertEquals(where, want.str("headline"), restored.headline)
        assertEquals(where, want.str("why"), restored.why)
        assertEquals(where, want.str("crux"), restored.crux)
        assertEquals(where, letters(want["facts_relied_on"]), restored.factsReliedOn)
        assertEquals(where, letters(want["agreed_facts"]), restored.agreedFacts)
        assertEquals(where, letters(want["would_change"]), restored.wouldChange)

        val sides = want["sides"]!!.arr().map { it.jsonObject }
        assertEquals(where, sides.size, restored.sides.orEmpty().size)
        restored.sides.orEmpty().zip(sides).forEach { (got, w) ->
            assertEquals(where, w.str("party"), got.party)
            assertEquals(where, letters(w["claims"]), got.claims.map { it.claim })
            assertEquals(where, w.str("bedrock"), got.bedrock)
        }
        val others = want["others"]!!.arr().map { it.jsonObject }
        assertEquals(where, others.size, restored.others.orEmpty().size)
        restored.others.orEmpty().zip(others).forEach { (got, w) ->
            assertEquals(where, w.str("party"), got.party)
            assertEquals(where, w.str("line"), got.line)
        }
        val disputes = want["disputes"]!!.arr().map { it.jsonObject }
        assertEquals(where, disputes.size, restored.disputes.orEmpty().size)
        restored.disputes.orEmpty().zip(disputes).forEach { (got, w) ->
            assertEquals(where, w.str("fact"), got.fact)
            val positions = w["positions"]!!.arr().map { it.jsonObject }
            assertEquals(where, positions.map { it.str("party") }, got.positions.map { it.party })
            assertEquals(where, positions.map { it.str("says") }, got.positions.map { it.says })
        }
    }

    @Test
    fun storySummaries() {
        val summaries = storyVectors()["summaries"]!!.arr().map { it.jsonObject }
        assertTrue(summaries.size > 4)
        for (entry in summaries) {
            val name = entry.str("sample")!!
            val want = entry["summary"]!!.jsonObject
            val got = Story.summarize(Fixtures.anySample(name).result.result)
            assertEquals(name, letters(want["votes"]), got.votes.map { it.wire })
            assertEquals(name, want.bool("escalated"), got.escalated)
            assertEquals(name, want.num("extra")!!.toInt(), got.extra)
            assertEquals(name, want["winner"].takeIf { it !is JsonNull }?.prim()?.content, got.winner?.wire)
            assertEquals(name, want["trial"].takeIf { it !is JsonNull }?.prim()?.content, got.trial?.raw)
            assertEquals(name, entry.num("sides")!!.toInt(), got.sides)
        }
    }

    private fun storyVectors(): JsonObject {
        val stream = ManySidedTest::class.java.classLoader!!.getResourceAsStream("story-vectors.json")!!
        return kotlinx.serialization.json.Json.parseToJsonElement(stream.bufferedReader(Charsets.UTF_8).readText()).jsonObject
    }

    @Test
    fun theCourtGetsTheSideCountOnlyBeyondTwo() {
        val three = Fixtures.manySample("three_win_c").result.result
        assertEquals(
            """{"kind":"judging","beat":"final","votes":["c","c","a"],"extra":0,"winner":"c","trial":null,"sides":3}""",
            CourtScene.Judging(Story.Beat.FINAL, Story.summarize(three)).json(),
        )
        assertTrue(CourtScene.Judging(Story.Beat.CRUX, null, sides = 4).json().endsWith(""","sides":4}"""))
        assertFalse(CourtScene.Judging(Story.Beat.CRUX, null).json().contains("sides"))
    }

    @Test
    fun theBalanceStaysLevelAndKnowsOnlyTwoSides() {
        val win = Fixtures.manySample("three_win_c").result.result
        assertEquals(SceneMode.Verdict(50, listOf(Vote.C, Vote.C, Vote.A)), VerdictDisplay.sceneVerdict(win))
        assertEquals(
            """{"kind":"verdict","verdict":{"tugA":50,"votes":["other","other","a","b","other"]}}""",
            SceneMode.Verdict(50, listOf(Vote.C, Vote.D, Vote.A, Vote.B, Vote.OTHER)).json(),
        )
    }

    @Test
    fun partyLabelsNeedMoreThanTwoSidesToBeSides() {
        assertNull(PartyNames.canonicalLabel("Party C"))
        assertEquals("Party C", PartyNames.canonicalLabel("Party C", sides = 3))
        assertEquals("Party D", PartyNames.canonicalLabel("Taraf D'nin", sides = 4))
        assertNull(PartyNames.canonicalLabel("Party D", sides = 3))
        assertNull("other people start at E", PartyNames.canonicalLabel("Person C", sides = 3))
        assertEquals("Person E", PartyNames.canonicalLabel("Person E", sides = 3))
        assertEquals("Person C", PartyNames.canonicalLabel("Person C"))
        assertEquals("Party C", CaseLogic.localizeLabels("Party C", AppLang.EN, sides = 3))
        assertEquals("Taraf C", CaseLogic.localizeLabels("Party C", AppLang.TR, sides = 3))
        assertEquals("Person C", CaseLogic.localizeLabels("Person C", AppLang.EN))
    }
}
