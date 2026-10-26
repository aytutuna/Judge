package com.okjudge.judge.core.display

import kotlin.math.exp

/**
 * Port of lib/thinking.ts (timeline of the judging screen) with the caption
 * keys of lib/thinking-keys.ts. Pure: the screen runs [plan] in a loop.
 */
object Thinking {
    data class Step(val key: String, val ms: Long)
    data class FinishStep(val name: String, val ms: Long)

    val STEPS: List<Step> = listOf(
        Step("thinking.read", 2400),
        Step("thinking.label", 2400),
        Step("thinking.dig", 1100),
        Step("thinking.dig", 1100),
        Step("thinking.dig", 1100),
        Step("thinking.reach", 1300),
        Step("thinking.crux", 2400),
        Step("thinking.judges", 2400),
        Step("thinking.votes", 1200),
    )

    val FINISH_STEPS: List<FinishStep> = listOf(
        FinishStep("settle", 600),
        FinishStep("sweep", 900),
        FinishStep("crux", 700),
        FinishStep("out", 250),
    )

    const val MAX_FINISH_MS = 3000L
    const val FINISH_KEY = "thinking.finish"
    const val STILL_JUDGING_KEY = "thinking.stillJudging"
    const val READY_KEY = "thinking.ready"

    /** Hold after the finish sequence so the tilt reads (lib/judging-ui.ts REVEAL_HOLD_MS). */
    const val REVEAL_HOLD_MS = 900L

    sealed interface DigState {
        val step: Int
        val cycle: Int

        data class Loop(override val step: Int, override val cycle: Int) : DigState
        data class Finish(override val step: Int, val from: Int, override val cycle: Int) : DigState
    }

    sealed interface Next {
        data class To(val state: DigState) : Next
        data object Finished : Next
    }

    data class Plan(val to: Next, val delayMs: Long)

    val INITIAL: DigState = DigState.Loop(0, 0)

    fun finishEntry(fromLoopStep: Int): Int = when {
        fromLoopStep <= 1 -> 0
        fromLoopStep <= 3 -> 1
        fromLoopStep <= 5 -> 2
        else -> 3
    }

    /** The transition function. `skip` = reduced motion. */
    fun plan(state: DigState, done: Boolean, skip: Boolean): Plan = when (state) {
        is DigState.Loop -> {
            if (done) {
                if (skip) {
                    Plan(Next.Finished, 0)
                } else {
                    Plan(Next.To(DigState.Finish(finishEntry(state.step), state.step, state.cycle)), 0)
                }
            } else {
                val last = state.step >= STEPS.size - 1
                Plan(
                    Next.To(if (last) DigState.Loop(0, state.cycle + 1) else DigState.Loop(state.step + 1, state.cycle)),
                    STEPS[state.step].ms,
                )
            }
        }
        is DigState.Finish -> {
            val delay = FINISH_STEPS[state.step].ms
            if (state.step >= FINISH_STEPS.size - 1) {
                Plan(Next.Finished, delay)
            } else {
                Plan(Next.To(state.copy(step = state.step + 1)), delay)
            }
        }
    }

    /** The 3D beat for a state (lib/judging-ui.ts judgingBeatFor): later cycles deliberate. */
    fun beatFor(state: DigState): SceneBeat = when {
        state is DigState.Finish -> SceneBeat.ORBS
        state.cycle >= 1 -> SceneBeat.DELIBERATE
        state.step <= 0 -> SceneBeat.LIFT
        state.step == 1 -> SceneBeat.SORT
        state.step <= 5 -> SceneBeat.DIG
        state.step == 6 -> SceneBeat.CRUX
        else -> SceneBeat.ORBS
    }

    /** Key of the polite live-region text (announcement()). */
    fun announcementKey(state: DigState, done: Boolean): String = when {
        done || state is DigState.Finish -> READY_KEY
        state.cycle == 0 -> STEPS[state.step].key
        else -> STILL_JUDGING_KEY
    }

    /** Key of the visible caption: the story once, then "still judging", then the finish line. */
    fun captionKey(state: DigState, finished: Boolean): String = when {
        finished -> READY_KEY
        state is DigState.Finish -> FINISH_KEY
        state.cycle == 0 -> STEPS[state.step].key
        else -> STILL_JUDGING_KEY
    }

    /**
     * Progress bar fill: the curve of lib/judging-ui.ts progressAt (about .62
     * at 10 s, .89 at 30 s) plus a slow tail toward 98%, so the bar keeps
     * creeping through a verdict that takes minutes. 1 once the answer is in.
     */
    fun progressAt(elapsedMs: Long, done: Boolean): Float {
        if (done) return 1f
        val t = maxOf(0L, elapsedMs).toDouble()
        return (0.92 * (1 - exp(-t / 9000.0)) + 0.06 * (1 - exp(-t / 150_000.0))).toFloat()
    }
}
