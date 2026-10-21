package com.okjudge.judge.core.display

import com.okjudge.judge.core.display.Thinking.DigState
import com.okjudge.judge.core.display.Thinking.Next
import com.okjudge.judge.core.display.Thinking.Plan
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Port of test/thinking.test.ts. */
class ThinkingTest {
    private fun loop(step: Int, cycle: Int = 0) = DigState.Loop(step, cycle)
    private fun finish(step: Int, from: Int, cycle: Int = 0) = DigState.Finish(step, from, cycle)
    private val loopSteps = Thinking.STEPS.indices

    @Test
    fun tables() {
        assertEquals(9, Thinking.STEPS.size)
        assertTrue(Thinking.FINISH_STEPS.sumOf { it.ms } <= Thinking.MAX_FINISH_MS)
        assertEquals(listOf("settle", "sweep", "crux", "out"), Thinking.FINISH_STEPS.map { it.name })
        for (step in listOf(0, 1, 5, 6, 7)) assertTrue(Thinking.STEPS[step].ms >= 1300)
        val total = Thinking.STEPS.sumOf { it.ms }
        assertTrue(total in 14000..17000)
    }

    @Test
    fun loop_advancesOneStepWithThatStepsDuration() {
        for (step in loopSteps.toList().dropLast(1)) {
            assertEquals(Plan(Next.To(loop(step + 1, 3)), Thinking.STEPS[step].ms), Thinking.plan(loop(step, 3), done = false, skip = false))
        }
    }

    @Test
    fun loop_wrapsTheLastStep() {
        val last = Thinking.STEPS.size - 1
        assertEquals(Plan(Next.To(loop(0, 3)), Thinking.STEPS[last].ms), Thinking.plan(loop(last, 2), false, false))
        assertEquals(Next.To(loop(1, 0)), Thinking.plan(Thinking.INITIAL, false, false).to)
    }

    @Test
    fun doneAndSkip_finishesImmediately() {
        for (step in loopSteps) assertEquals(Plan(Next.Finished, 0), Thinking.plan(loop(step, 1), true, true))
    }

    @Test
    fun done_entersFinishAtFinishEntry() {
        for (step in loopSteps) {
            assertEquals(Plan(Next.To(finish(Thinking.finishEntry(step), step, 4)), 0), Thinking.plan(loop(step, 4), true, false))
        }
        assertEquals(listOf(0, 0, 1, 1, 2, 2, 3, 3, 3), (0..8).map(Thinking::finishEntry))
    }

    @Test
    fun finish_walksToTheEnd() {
        val seq = mutableListOf<Next>()
        var s: DigState = finish(0, 0)
        while (true) {
            val next = Thinking.plan(s, true, false).to
            seq += next
            if (next is Next.To) s = next.state else break
        }
        assertEquals(listOf(Next.To(finish(1, 0)), Next.To(finish(2, 0)), Next.To(finish(3, 0)), Next.Finished), seq)
    }

    @Test
    fun finish_isBounded() {
        val starts = mutableListOf<DigState>()
        for (cycle in listOf(0, 1, 5)) for (step in loopSteps) starts += loop(step, cycle)
        for (from in loopSteps) for (step in Thinking.finishEntry(from) until Thinking.FINISH_STEPS.size) starts += finish(step, from)
        for (start in starts) {
            var s: DigState = start
            var transitions = 0
            var total = 0L
            while (true) {
                val p = Thinking.plan(s, true, false)
                total += p.delayMs
                transitions++
                assertTrue(transitions <= 6)
                val to = p.to
                if (to is Next.To) s = to.state else break
            }
            assertTrue(total <= Thinking.MAX_FINISH_MS)
        }
    }

    @Test
    fun announcement_storyOnceThenStillJudgingThenReady() {
        for (step in loopSteps) {
            assertEquals(Thinking.STEPS[step].key, Thinking.announcementKey(loop(step, 0), false))
            assertEquals(Thinking.STILL_JUDGING_KEY, Thinking.announcementKey(loop(step, 1), false))
            assertEquals(Thinking.READY_KEY, Thinking.announcementKey(loop(step, 0), true))
        }
        assertEquals(Thinking.READY_KEY, Thinking.announcementKey(finish(1, 2), false))
        assertEquals(Thinking.FINISH_KEY, Thinking.captionKey(finish(1, 2), finished = false))
        assertEquals(Thinking.READY_KEY, Thinking.captionKey(finish(3, 2), finished = true))
    }

    @Test
    fun progress_easesTowardButNeverReachesTheEnd() {
        assertEquals(0f, Thinking.progressAt(0, false), 0f)
        assertEquals(0.62f, Thinking.progressAt(10_000, false), 0.01f)
        assertTrue(Thinking.progressAt(600_000, false) < 0.98f)
        // Still moving minutes in, while an async verdict is being polled.
        assertTrue(Thinking.progressAt(60_000, false) + 0.02f < Thinking.progressAt(180_000, false))
        assertTrue(Thinking.progressAt(180_000, false) + 0.005f < Thinking.progressAt(300_000, false))
        assertEquals(1f, Thinking.progressAt(1, true), 0f)
    }
}
