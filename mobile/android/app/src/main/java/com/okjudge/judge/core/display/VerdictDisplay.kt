package com.okjudge.judge.core.display

import com.okjudge.judge.core.model.FinalVerdict
import com.okjudge.judge.core.model.Lean
import com.okjudge.judge.core.model.LeanTally
import com.okjudge.judge.core.model.Side
import com.okjudge.judge.core.model.CruxTrial
import com.okjudge.judge.core.model.VerdictResult
import com.okjudge.judge.i18n.Strings
import java.util.Locale
import kotlin.math.PI

/**
 * Ports of lib/verdict-display.ts and lib/balance.ts. Everything except the
 * functions taking [Strings] is plain Kotlin.
 */
object VerdictDisplay {
    /** Largest verdict tilt in radians (lib/balance.ts MAX_TILT_RAD). */
    const val MAX_TILT_RAD = 0.3

    /** Party A's share of the tug bar in percent (tugFinal). */
    fun tugFinal(result: VerdictResult): Int = if (result.isMany) 50 else when (result.finalVerdict) {
        FinalVerdict.SIDE_A -> 80
        FinalVerdict.SIDE_B -> 20
        else -> result.lean?.let { if (it.party == "a") 62 else 38 } ?: 50
    }

    /** Beam angle for A's share; positive = Party A (left) end down, counter-clockwise. */
    fun tiltFromTug(tugA: Int): Double {
        val l = ((tugA - 50) / 50.0).coerceIn(-1.0, 1.0)
        return l * MAX_TILT_RAD
    }

    /**
     * The tilt as a clockwise-positive rotation in degrees (svgRotateDeg),
     * which is what Compose `rotate()` takes: the winner's end goes down.
     */
    fun svgRotateDeg(tugA: Int): Double {
        val deg = -tiltFromTug(tugA) * 180.0 / PI
        return if (deg == 0.0) 0.0 else deg
    }

    /** What the balance scene settles on (sceneVerdictFrom): a refusal stays level with no votes. */
    fun sceneVerdict(result: VerdictResult): SceneMode.Verdict =
        if (result.refused) SceneMode.Verdict(50, emptyList()) else SceneMode.Verdict(tugFinal(result), votes(result))

    /**
     * Party A's share of the votes for either side, for the lean bar: the
     * middle when it was too close or split (or no vote picked a side), null
     * when there is nothing to show (no votes, a refusal).
     */
    fun leanShare(result: VerdictResult): Float? {
        if (result.refused || result.runs.isEmpty() || result.isMany) return null
        if (result.finalVerdict == FinalVerdict.TOO_CLOSE || result.finalVerdict == FinalVerdict.SPLIT) return 0.5f
        val a = result.runs.count { it == "side_a" }
        val b = result.runs.count { it == "side_b" }
        return if (a + b == 0) 0.5f else a.toFloat() / (a + b)
    }

    /** The "Why" text under the headline; null on a refusal and on verdicts stored before the judges wrote one. */
    fun why(result: VerdictResult): String? = result.why?.takeIf { !result.refused && it.isNotBlank() }

    data class Agreement(val n: Int, val total: Int)

    /** How many runs reached the final verdict; null for too close or no runs (agreement). */
    fun agreement(result: VerdictResult): Agreement? {
        if (result.isMany) {
            val winner = result.winnerSide ?: return null
            if (result.runs.isEmpty()) return null
            return Agreement((result.votes ?: emptyList()).count { it == winner.raw }, result.runs.size)
        }
        if (result.runs.isEmpty() || result.finalVerdict == FinalVerdict.TOO_CLOSE) return null
        return Agreement(result.runs.count { it == result.verdict }, result.runs.size)
    }

    /** "Confidence 3 of 3", the split note without a majority, null for a refusal (confidenceLabel). */
    fun confidenceLabel(result: VerdictResult, s: Strings): String? {
        if (result.runs.isEmpty()) return null
        val a = agreement(result) ?: return s.verdictNoMajority
        return s.confidence(a.n.toString(), a.total.toString())
    }

    /** The judges' name in the thread: plain until there is a verdict, then how far they agreed (judgesLabel). */
    fun judgesLabel(result: VerdictResult?, s: Strings): String {
        if (result == null || result.runs.isEmpty()) return s.threadJudges
        val a = agreement(result) ?: return s.threadJudgesSplit
        return s.threadJudgesAgree(a.n, a.total.toString())
    }

    /** The stamp on the card: the winner as [verdictLabel] says it, otherwise one short word (stampLabel). */
    fun stampLabel(result: VerdictResult, parties: PartyLabels, s: Strings): String = if (result.isMany) {
        if (result.winnerSide != null) verdictLabel(result, parties, s) else s.stampTooClose
    } else when (result.finalVerdict) {
        FinalVerdict.SIDE_A, FinalVerdict.SIDE_B -> verdictLabel(result, parties, s)
        FinalVerdict.SPLIT -> s.stampSplit
        FinalVerdict.CONDITIONAL -> s.stampConditional
        FinalVerdict.DISSOLVED -> s.stampDissolved
        FinalVerdict.TOO_CLOSE, FinalVerdict.UNKNOWN -> s.stampTooClose
    }

    fun leanTally(lean: Lean, runCount: Int): LeanTally = lean.tally ?: LeanTally(runCount - 1, 1)

    fun voteOf(run: String): Vote = when (run) {
        "side_a" -> Vote.A
        "side_b" -> Vote.B
        else -> Vote.OTHER
    }

    /** A vote of a verdict with more than two sides: a side's letter, anything else is "other". */
    fun manyVoteOf(vote: String): Vote = Vote.entries.firstOrNull { it != Vote.OTHER && it.wire == vote } ?: Vote.OTHER

    /** Judge dots after the verdict: one per run; a refusal has none. */
    fun votes(result: VerdictResult): List<Vote> = when {
        result.refused -> emptyList()
        result.isMany -> (result.votes ?: emptyList()).map(::manyVoteOf)
        else -> result.runs.map(::voteOf)
    }

    fun sealOf(result: VerdictResult): SealSide {
        if (result.isMany) return result.winnerSide?.let { SealSide.of(it) } ?: SealSide.NONE
        return when (result.finalVerdict) {
            FinalVerdict.SIDE_A -> SealSide.A
            FinalVerdict.SIDE_B -> SealSide.B
            else -> SealSide.NONE
        }
    }

    /** How a ruling reads from the viewer's side: their own side won, or another did. */
    enum class Outcome { WIN, LOSE }

    /** Null when it was too close or nobody is looking (a share page). */
    fun outcome(result: VerdictResult, viewer: Side?): Outcome? {
        val winner = result.winnerSide ?: return null
        if (viewer == null) return null
        return if (winner == viewer) Outcome.WIN else Outcome.LOSE
    }

    /** Whether there is anything to say about what the sides stand on. */
    fun hasSides(result: VerdictResult): Boolean {
        if (result.isMany) return result.sides.orEmpty().any { it.bedrock.isNotEmpty() || it.claims.isNotEmpty() }
        val map = result.argumentMap
        return !(map.bedrockA.isEmpty() && map.bedrockB.isEmpty() && map.sideA.isEmpty() && map.sideB.isEmpty())
    }

    /** The headline verdict label. Self flags come from [PartyLabels], never a string test. */
    fun verdictLabel(result: VerdictResult, parties: PartyLabels, s: Strings): String {
        if (result.isMany) {
            val winner = result.winnerSide ?: return s.verdictTooClose
            return if (parties.isSelf(winner)) s.verdictWinSelf else s.verdictWin(parties.name(winner))
        }
        return when (result.finalVerdict) {
            FinalVerdict.SIDE_A -> if (parties.aIsSelf) s.verdictWinSelf else s.verdictWin(parties.nameA)
            FinalVerdict.SIDE_B -> if (parties.bIsSelf) s.verdictWinSelf else s.verdictWin(parties.nameB)
            FinalVerdict.SPLIT -> s.verdictSplit
            FinalVerdict.CONDITIONAL -> s.verdictConditional
            FinalVerdict.DISSOLVED -> s.verdictDissolved
            FinalVerdict.TOO_CLOSE, FinalVerdict.UNKNOWN -> s.verdictTooClose
        }
    }

    /** Why a stress test left doubt: the referee's reasoning, else the objection itself. */
    fun trialWhy(trial: CruxTrial): String = trial.reasoning.trim().ifEmpty { trial.attack.trim() }

    /** The evidence footnote line (evidenceNote): per party on two-sided verdicts, a count otherwise. */
    fun evidenceNote(result: VerdictResult, s: Strings): String? {
        val used = result.evidenceUsed ?: return null
        if (used.a + used.b + used.c + used.d == 0) return null
        return if (result.isTwoSided && !result.isMany) s.evidenceUsed(used.a.toString(), used.b.toString())
        else s.evidenceUsedOne((used.a + used.b + used.c + used.d).toString())
    }
}

enum class Vote {
    A, B, C, D, OTHER;

    /** lib/scene-bridge.ts Vote. */
    val wire: String get() = name.lowercase(Locale.ROOT)

    /** The 3D balance knows two sides; the rest read as other. */
    val balance: Vote get() = if (this == C || this == D) OTHER else this
}

enum class SealSide {
    A, B, C, D, NONE;

    companion object {
        fun of(side: Side): SealSide = when (side) {
            Side.A -> A
            Side.B -> B
            Side.C -> C
            Side.D -> D
        }
    }
}
