package com.okjudge.judge.ui

import com.okjudge.judge.core.model.CruxTrial
import com.okjudge.judge.core.model.NameMapping
import com.okjudge.judge.core.model.VerdictResult
import com.okjudge.judge.i18n.AppLang
import com.okjudge.judge.ui.judging.trialLine
import com.okjudge.judge.ui.judging.withNames
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class JudgingTrialLineTest {
    private val trial = CruxTrial(
        attack = "Party B never agreed to this.",
        outcome = "uncertain",
        reasoning = "Party A has no proof.",
    )
    private val result = VerdictResult(lang = "en", headline = "Party A wins", cruxTrial = trial)
    private val names = listOf(NameMapping("Ben", "Party A"), NameMapping("Deniz", "Party B"))

    @Test
    fun logQuotesTheObjectionWithRealNames() {
        val line = trialLine(UiTestSupport.s(AppLang.EN), "trial.uncertain", withNames(result, names))
        assertTrue(line, line.contains("Ben has no proof."))
        assertFalse(line, line.contains("Party A"))
    }

    @Test
    fun minorLogLineSaysWhyButSkipsTheMixedNote() {
        val minor = result.copy(disputeType = "mixed", cruxTrial = trial.copy(outcome = "minor"))
        val s = UiTestSupport.s(AppLang.EN)
        val line = trialLine(s, "trial.minor", withNames(minor, names))
        assertTrue(line, line.contains("Ben has no proof."))
        assertFalse(line, line.contains(s.trialMixedNote))
    }
}
