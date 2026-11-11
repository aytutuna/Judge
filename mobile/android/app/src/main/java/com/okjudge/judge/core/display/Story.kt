package com.okjudge.judge.core.display

import com.okjudge.judge.core.model.FinalVerdict
import com.okjudge.judge.core.model.TrialOutcome
import com.okjudge.judge.core.model.VerdictResult

/**
 * Port of components/court/story.ts: what the judging card says and shows
 * while it waits, checked against mobile/shared/fixtures/story-vectors.json.
 */
object Story {
    enum class Beat(val wire: String) {
        NAMES("names"), FACTS("facts"), JUDGES("judges"), BOTH_SIDES("bothSides"), CRUX("crux"), RULING("ruling"),
        VOTE1("vote1"), MORE("more"), VOTE2("vote2"), TRIAL("trial"), FINAL("final"),
    }

    val WAITING: List<Beat> = listOf(Beat.NAMES, Beat.FACTS, Beat.JUDGES, Beat.BOTH_SIDES, Beat.CRUX, Beat.RULING)

    private val HOLD: Map<Beat, Long> = mapOf(
        Beat.FACTS to 9000,
        Beat.JUDGES to 6000,
        Beat.BOTH_SIDES to 7000,
        Beat.CRUX to 7000,
    )

    const val NAMES_MIN_MS = 2500L
    const val CATCH_UP_MS = 450L
    const val VOTE_MS = 420L
    const val TRIAL_MS = 4200L

    /** A log line: a string key, and the counts of the "N of M judges agree" line. */
    data class Line(val key: String, val n: Int? = null, val total: Int? = null)

    /** At [at] ms after the verdict lands, the court moves to [beat] and the log gains [line] (if any). */
    data class Step(val at: Long, val beat: Beat, val line: Line?)

    data class Ending(val steps: List<Step>, val finishAt: Long)

    data class Summary(
        val votes: List<Vote>,
        val escalated: Boolean,
        val extra: Int,
        val winner: Vote?,
        val trial: TrialOutcome?,
        /** How many sides stand at centre court. */
        val sides: Int = 2,
    )

    /** Index in [WAITING] of the line being worked on [elapsed] ms in, given when the names went out (null: not yet). */
    fun waitingAt(elapsed: Long, acceptedAt: Long?): Int {
        if (acceptedAt == null) return 0
        var t = maxOf(NAMES_MIN_MS, acceptedAt)
        if (elapsed < t) return 0
        for (i in 1 until WAITING.size - 1) {
            t += HOLD.getValue(WAITING[i])
            if (elapsed < t) return i
        }
        return WAITING.size - 1
    }

    /** The most common vote and how many judges gave it; no side unless it is more than half. */
    fun agreement(votes: List<Vote>): Pair<Vote?, Int> {
        val counts = LinkedHashMap<Vote, Int>()
        for (v in votes) counts[v] = (counts[v] ?: 0) + 1
        var side: Vote? = null
        var n = 0
        for ((v, c) in counts) {
            if (c > n) {
                side = v
                n = c
            } else if (c == n) {
                side = null
            }
        }
        return (if (n * 2 > votes.size) side else null) to n
    }

    fun summarize(result: VerdictResult): Summary {
        val votes = VerdictDisplay.votes(result)
        val escalated = result.escalated == true
        val winner = if (result.isMany) {
            result.winnerSide?.let { VerdictDisplay.manyVoteOf(it.raw) }
        } else when (result.finalVerdict) {
            FinalVerdict.SIDE_A -> Vote.A
            FinalVerdict.SIDE_B -> Vote.B
            else -> null
        }
        val trial = result.cruxTrial?.trialOutcome?.takeIf { it != TrialOutcome.UNKNOWN }
        return Summary(votes, escalated, if (escalated) maxOf(0, votes.size - 3) else 0, winner, trial, result.sideCount)
    }

    /** Everything that happens once the verdict lands, given the waiting line the story was on. */
    fun ending(fromWaiting: Int, summary: Summary?, reduced: Boolean): Ending {
        if (reduced || summary == null) return Ending(emptyList(), if (reduced) 600 else 0)
        val (votes, escalated, extra, _, trial, _) = summary
        val steps = mutableListOf<Step>()
        var at = 0L
        fun later(ms: Long, beat: Beat, line: Line?) {
            at += ms
            steps += Step(at, beat, line)
        }
        for (i in fromWaiting + 1 until WAITING.size) {
            later(if (i == fromWaiting + 1) 0 else CATCH_UP_MS, WAITING[i], Line("story.${WAITING[i].wire}"))
        }
        if (votes.isNotEmpty()) {
            later(CATCH_UP_MS, Beat.VOTE1, Line("story.count"))
            at += 1200 + minOf(3, votes.size) * VOTE_MS
        }
        if (escalated) {
            later(400, Beat.MORE, Line("story.closeCall"))
            if (extra > 0) {
                later(2600, Beat.VOTE2, null)
                at += minOf(2, extra) * VOTE_MS
            }
        }
        if (votes.isNotEmpty() && trial != null) {
            later(600, Beat.TRIAL, Line("trial.${trial.raw}"))
            at += TRIAL_MS
        }
        val (side, n) = agreement(votes)
        at += 600
        if (votes.isNotEmpty()) {
            steps += Step(at, Beat.FINAL, if (side != null) Line("story.agree", n, votes.size) else Line("story.split"))
        }
        steps += Step(at, Beat.FINAL, Line("thinking.ready"))
        return Ending(steps, at + 1900)
    }
}
