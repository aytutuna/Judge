package com.okjudge.judge.core.display

import com.okjudge.judge.core.model.FinalVerdict
import com.okjudge.judge.core.model.Lean
import com.okjudge.judge.core.model.LeanTally
import com.okjudge.judge.core.model.VerdictResult
import com.okjudge.judge.i18n.Strings
import kotlin.math.PI

/**
 * Ports of lib/verdict-display.ts and lib/balance.ts. Everything except the
 * functions taking [Strings] is plain Kotlin.
 */
object VerdictDisplay {
    /** Largest verdict tilt in radians (lib/balance.ts MAX_TILT_RAD). */
    const val MAX_TILT_RAD = 0.3

    /** Party A's share of the tug bar in percent (tugFinal). */
    fun tugFinal(result: VerdictResult): Int = when (result.finalVerdict) {
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

    /** Beam angle for a finished verdict: a refusal stays level (sceneVerdictFrom). */
    fun finalBeamDeg(result: VerdictResult): Double =
        if (result.refused) 0.0 else svgRotateDeg(tugFinal(result))

    fun leanTally(lean: Lean, runCount: Int): LeanTally = lean.tally ?: LeanTally(runCount - 1, 1)

    fun voteOf(run: String): Vote = when (run) {
        "side_a" -> Vote.A
        "side_b" -> Vote.B
        else -> Vote.OTHER
    }

    /** Judge dots after the verdict: one per run; a refusal has none. */
    fun votes(result: VerdictResult): List<Vote> =
        if (result.refused) emptyList() else result.runs.map(::voteOf)

    fun sealOf(result: VerdictResult): SealSide = when (result.finalVerdict) {
        FinalVerdict.SIDE_A -> SealSide.A
        FinalVerdict.SIDE_B -> SealSide.B
        else -> SealSide.NONE
    }

    /** The headline verdict label. Self flags come from [PartyLabels], never a string test. */
    fun verdictLabel(result: VerdictResult, parties: PartyLabels, s: Strings): String =
        when (result.finalVerdict) {
            FinalVerdict.SIDE_A -> if (parties.aIsSelf) s.verdictWinSelf else s.verdictWin(parties.nameA)
            FinalVerdict.SIDE_B -> if (parties.bIsSelf) s.verdictWinSelf else s.verdictWin(parties.nameB)
            FinalVerdict.SPLIT -> s.verdictSplit
            FinalVerdict.CONDITIONAL -> s.verdictConditional
            FinalVerdict.DISSOLVED -> s.verdictDissolved
            FinalVerdict.TOO_CLOSE, FinalVerdict.UNKNOWN -> s.verdictTooClose
        }

    private val PANEL_FAMILIES = listOf(
        "Sonnet" to Regex("sonnet", RegexOption.IGNORE_CASE),
        "Haiku" to Regex("haiku", RegexOption.IGNORE_CASE),
        "Opus" to Regex("opus", RegexOption.IGNORE_CASE),
    )

    /** "Judges: 2 Sonnet + 1 Haiku" (panelSummary). */
    fun panelSummary(models: List<String>, s: Strings): String {
        val counts = LinkedHashMap<String, Int>()
        for (m in models) {
            val name = PANEL_FAMILIES.firstOrNull { it.second.containsMatchIn(m) }?.first ?: "Claude"
            counts[name] = (counts[name] ?: 0) + 1
        }
        val order = PANEL_FAMILIES.map { it.first } + "Claude"
        val list = order.filter { it in counts }.joinToString(" + ") { "${counts[it]} $it" }
        return s.panelModels(list)
    }

    /** Clamped confidence 1..5 (ConfidenceMeter). */
    fun confidenceLevel(value: Int): Int = value.coerceIn(1, 5)

    fun confidenceWordKey(value: Int): String = "confidence.${confidenceLevel(value)}"

    /** "High confidence · 4/5". */
    fun confidenceText(value: Int, s: Strings): String {
        val n = confidenceLevel(value)
        return s.confidenceWord(s.text(confidenceWordKey(value)) ?: "", n.toString())
    }

    /** Labels longer than this stack the seal above them (VerdictMain STACK_LABEL). */
    const val STACK_LABEL = 12

    /** Labels longer than this use the smaller display size (LONG_LABEL). */
    const val LONG_LABEL = 18

    fun codePointLength(text: String): Int = text.codePointCount(0, text.length)
}

enum class Vote { A, B, OTHER }

enum class SealSide { A, B, NONE }
