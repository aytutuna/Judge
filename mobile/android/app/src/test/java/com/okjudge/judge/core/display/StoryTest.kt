package com.okjudge.judge.core.display

import com.okjudge.judge.Fixtures
import com.okjudge.judge.core.model.TrialOutcome
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Port of components/court/story.ts against mobile/shared/fixtures/story-vectors.json. */
class StoryTest {
    private val vectors: JsonObject by lazy {
        val stream = StoryTest::class.java.classLoader!!.getResourceAsStream("story-vectors.json")
            ?: error("story-vectors.json not on the test classpath (mobile/shared/fixtures)")
        kotlinx.serialization.json.Json.parseToJsonElement(stream.bufferedReader(Charsets.UTF_8).readText()).jsonObject
    }

    private fun vote(wire: String) = Vote.entries.first { it.wire == wire }

    private fun summaryOf(o: JsonObject) = Story.Summary(
        votes = o["votes"]!!.jsonArray.map { vote(it.jsonPrimitive.content) },
        escalated = o["escalated"]!!.jsonPrimitive.content.toBoolean(),
        extra = o["extra"]!!.jsonPrimitive.int,
        winner = o["winner"].orNull()?.let { vote(it.jsonPrimitive.content) },
        trial = o["trial"].orNull()?.let { TrialOutcome.of(it.jsonPrimitive.content) },
    )

    private fun JsonElement?.orNull(): JsonElement? = this?.takeIf { it !is JsonNull }

    @Test
    fun waitingAt_matchesTheWeb() {
        for (v in vectors["waiting"]!!.jsonArray.map { it.jsonObject }) {
            val accepted = v["acceptedAt"].orNull()?.jsonPrimitive?.long
            assertEquals("$v", v["index"]!!.jsonPrimitive.int, Story.waitingAt(v["elapsed"]!!.jsonPrimitive.long, accepted))
        }
    }

    @Test
    fun ending_matchesTheWeb() {
        val cases = vectors["endings"]!!.jsonArray.map { it.jsonObject }
        assertEquals(19, cases.size)
        for (c in cases) {
            val name = c["name"]!!.jsonPrimitive.content
            val summary = c["summary"].orNull()?.let { summaryOf(it.jsonObject) }
            val got = Story.ending(c["fromWaiting"]!!.jsonPrimitive.int, summary, c["reduced"]!!.jsonPrimitive.content.toBoolean())
            val steps = c["steps"]!!.jsonArray.map { it.jsonObject }
            assertEquals(name, steps.size, got.steps.size)
            steps.zip(got.steps).forEachIndexed { i, (want, step) ->
                assertEquals("$name step $i at", want["at"]!!.jsonPrimitive.long, step.at)
                assertEquals("$name step $i beat", want["beat"]!!.jsonPrimitive.content, step.beat.wire)
                val line = want["line"].orNull()?.jsonObject
                assertEquals("$name step $i line", line?.get("key")?.jsonPrimitive?.content, step.line?.key)
                val vars = line?.get("vars")?.jsonObject
                assertEquals("$name step $i n", vars?.get("n")?.jsonPrimitive?.int, step.line?.n)
                assertEquals("$name step $i total", vars?.get("total")?.jsonPrimitive?.int, step.line?.total)
            }
            assertEquals("$name finishAt", c["finishAt"]!!.jsonPrimitive.long, got.finishAt)
        }
    }

    @Test
    fun endingFitsTheLongestWait() {
        val longest = vectors["endings"]!!.jsonArray.maxOf { it.jsonObject["finishAt"]!!.jsonPrimitive.long }
        assert(longest <= 16000)
    }

    @Test
    fun agreement_needsMoreThanHalf() {
        assertEquals(Vote.A to 3, Story.agreement(listOf(Vote.A, Vote.A, Vote.A)))
        assertEquals(Vote.A to 2, Story.agreement(listOf(Vote.A, Vote.B, Vote.A)))
        assertNull(Story.agreement(listOf(Vote.A, Vote.B)).first)
        assertNull(Story.agreement(emptyList()).first)
    }

    @Test
    fun scene_json() {
        assertEquals("""{"kind":"home","busy":true}""", CourtScene.Home(true).json())
        val summary = Story.Summary(listOf(Vote.A, Vote.OTHER), true, 0, Vote.A, TrialOutcome.SURVIVED)
        assertEquals(
            """{"kind":"judging","beat":"vote1","votes":["a","other"],"extra":0,"winner":"a","trial":"survived"}""",
            CourtScene.Judging(Story.Beat.VOTE1, summary).json(),
        )
        assertEquals(
            """{"kind":"judging","beat":"bothSides","votes":[],"extra":0,"winner":null,"trial":null}""",
            CourtScene.Judging(Story.Beat.BOTH_SIDES, null).json(),
        )
    }

    @Test
    fun vote2_holdsForTwoExtraJudgesAtMost() {
        fun finishFor(extra: Int) = Story.ending(5, Story.Summary(List(3 + extra) { Vote.A }, true, extra, Vote.A, null), false).finishAt
        assertEquals(finishFor(2), finishFor(5))
    }

    @Test
    fun summarize_readsTheResult() {
        val win = Story.summarize(Fixtures.sample("win_b_named").result.result)
        assertEquals(Vote.B, win.winner)
        assertEquals(false, win.escalated)
        assertEquals(0, win.extra)
        val refused = Story.summarize(Fixtures.sample("refused").result.result)
        assertEquals(emptyList<Vote>(), refused.votes)
        assertNull(refused.winner)
        assertEquals(TrialOutcome.OVERTURNED, Story.summarize(Fixtures.sample("overturned_tr").result.result).trial)
    }
}
