package com.okjudge.judge.core.display

import com.okjudge.judge.Fixtures
import com.okjudge.judge.core.model.VerdictResult
import com.okjudge.judge.i18n.AppLang
import com.okjudge.judge.isNull
import com.okjudge.judge.num
import com.okjudge.judge.str
import com.okjudge.judge.ui.theme.Palette
import com.okjudge.judge.ui.verdict.shareUrl
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import kotlin.math.round

/** Text-free display ports against the web's golden vectors. */
class DisplayPureTest {
    private fun round3(d: Double) = round(d * 1000) / 1000

    @Test
    fun tug_tilt_cruxStyle_leanTally_selfLang_shareUrl_matchTheWeb() {
        val vectors = Fixtures.list("verdicts")
        assertEquals(18, vectors.size)
        for (v in vectors) {
            val sample = v.str("sample")!!
            val outcome = Fixtures.sample(sample)
            val r = outcome.result.result
            val where = "$sample/${v.str("lang")}"
            assertEquals(where, v.num("tugA")!!.toInt(), VerdictDisplay.tugFinal(r))
            assertEquals(where, v.num("svgRotateDeg")!!, round3(VerdictDisplay.svgRotateDeg(VerdictDisplay.tugFinal(r))), 1e-9)
            assertEquals(where, v.str("cruxStyle"), CruxStyle.cruxStyle(r.crux).name.lowercase())
            assertEquals(where, v.str("selfLang"), ContentLang.verdictLang(r).tag)
            assertEquals(where, v.str("shareUrl"), shareUrl("https://okjudge.com", outcome.id))
            if (v.isNull("leanTally")) {
                assertNull(where, r.lean)
            } else {
                val expected = v["leanTally"]!!.jsonObject
                val tally = VerdictDisplay.leanTally(r.lean!!, r.runs.size)
                assertEquals(where, expected.num("for")!!.toInt(), tally.forVotes)
                assertEquals(where, expected.num("against")!!.toInt(), tally.against)
            }
        }
    }

    @Test
    fun beamAngles_followTheDesign() {
        assertEquals(-10.313, round3(VerdictDisplay.svgRotateDeg(80)), 1e-9)
        assertEquals(10.313, round3(VerdictDisplay.svgRotateDeg(20)), 1e-9)
        assertEquals(-4.125, round3(VerdictDisplay.svgRotateDeg(62)), 1e-9)
        assertEquals(4.125, round3(VerdictDisplay.svgRotateDeg(38)), 1e-9)
        assertEquals(0.0, VerdictDisplay.svgRotateDeg(50), 0.0)
        // A refusal stays level even if a verdict field says otherwise.
        val refused = VerdictResult(verdict = "side_a", modelRefused = true)
        assertEquals(0.0, VerdictDisplay.finalBeamDeg(refused), 0.0)
        assertEquals(emptyList<Vote>(), VerdictDisplay.votes(refused.copy(runs = listOf("side_a"))))
    }

    @Test
    fun unknownVerdict_isNeutral() {
        val r = VerdictResult(verdict = "brand_new", lean = null)
        assertEquals(50, VerdictDisplay.tugFinal(r))
        assertEquals(SealSide.NONE, VerdictDisplay.sealOf(r))
    }

    @Test
    fun presetEmoji_matchLibFrameworks() {
        val presets = Fixtures.list("presets")
        assertEquals(presets.map { it.str("id") }, Preset.entries.map { it.id })
        for (p in presets) assertEquals(p.str("id"), p.str("emoji"), Preset.of(p.str("id")).emoji)
    }

    @Test
    fun palette_matchesLibPalette() {
        val palette = Fixtures.vectors["palette"]!!.jsonObject
        assertEquals(palette.keys, Palette.byKey.keys)
        for ((key, value) in palette) {
            val hex = value.toString().trim('"')
            val c = Palette.byKey.getValue(key)
            val actual = "#%02X%02X%02X".format((c.red * 255).toInt(), (c.green * 255).toInt(), (c.blue * 255).toInt())
            assertEquals(key, hex.uppercase(), actual)
        }
        val alpha = Fixtures.vectors["paletteAlpha"]!!.jsonObject
        assertEquals(alpha.keys, Palette.alphaByKey.keys)
        val rgba = Regex("""rgba\((\d+), (\d+), (\d+), ([\d.]+)\)""")
        for ((key, value) in alpha) {
            val m = rgba.matchEntire(value.toString().trim('"'))!!
            val c = Palette.alphaByKey.getValue(key)
            assertEquals(key, m.groupValues[1].toInt(), Math.round(c.red * 255))
            assertEquals(key, m.groupValues[2].toInt(), Math.round(c.green * 255))
            assertEquals(key, m.groupValues[3].toInt(), Math.round(c.blue * 255))
            assertEquals(key, m.groupValues[4].toFloat(), c.alpha, 0.003f)
        }
    }

    @Test
    fun thinkingConstants_matchLibThinking() {
        val t = Fixtures.vectors["thinking"]!!.jsonObject
        val steps = t["steps"]!!.let { it as kotlinx.serialization.json.JsonArray }.map { it.jsonObject }
        assertEquals(steps.map { it.str("key") to it.num("ms")!!.toLong() }, Thinking.STEPS.map { it.key to it.ms })
        val finish = t["finishSteps"]!!.let { it as kotlinx.serialization.json.JsonArray }.map { it.jsonObject }
        assertEquals(finish.map { it.str("name") to it.num("ms")!!.toLong() }, Thinking.FINISH_STEPS.map { it.name to it.ms })
        assertEquals(t.num("maxFinishMs")!!.toLong(), Thinking.MAX_FINISH_MS)
        assertEquals(t.str("finishKey"), Thinking.FINISH_KEY)
        assertEquals(t.str("stillJudgingKey"), Thinking.STILL_JUDGING_KEY)
        assertEquals(t.str("readyKey"), Thinking.READY_KEY)
    }

    @Test
    fun contentLang_heuristic() {
        assertEquals(AppLang.TR, ContentLang.contentLang("Taraf A haklı"))
        assertEquals(AppLang.TR, ContentLang.contentLang("şüphe"))
        assertEquals(AppLang.EN, ContentLang.contentLang("Party A is right"))
        assertEquals(AppLang.EN, ContentLang.contentLang("ATaraf A, Taraf AB"))
    }

    @Test
    fun cruxStyle_countsCollapsedCodePoints() {
        assertEquals(CruxFace.SERIF, CruxStyle.cruxStyle("a".repeat(180)))
        assertEquals(CruxFace.SANS, CruxStyle.cruxStyle("a".repeat(181)))
        assertEquals(CruxFace.SERIF, CruxStyle.cruxStyle("  " + "a ".repeat(90) + "\n\n"))
        // Astral characters count once.
        assertEquals(CruxFace.SERIF, CruxStyle.cruxStyle("😀".repeat(180)))
    }

    @Test
    fun conditionalClause_portsTheWebRules() {
        assertEquals("you value honesty", ConditionalClause.clause("If You value honesty", AppLang.EN))
        assertEquals("Party A values honesty", ConditionalClause.clause("if Party A values honesty", AppLang.EN))
        assertEquals("dürüstlüğe önem veriyorsan", ConditionalClause.clause("Eğer Dürüstlüğe önem veriyorsan", AppLang.TR))
        assertEquals("ıslak kek seviyorsan", ConditionalClause.clause("Islak kek seviyorsan", AppLang.TR))
        assertEquals("Taraf A haklıysa", ConditionalClause.clause("eğer Taraf A haklıysa", AppLang.TR))
        assertEquals("Deniz haklıysa", ConditionalClause.clause("Deniz haklıysa", AppLang.TR, listOf("", "Deniz")))
        // Both markers are stripped in both languages: no "Eğer If".
        assertEquals("you agree", ConditionalClause.clause("If you agree", AppLang.TR))
    }

    @Test
    fun argumentRules() {
        assertEquals(false, ArgumentRules.canSubmit("   short    "))
        assertEquals(false, ArgumentRules.canSubmit(" ".repeat(30) + "nineteen characters"))
        assertEquals(true, ArgumentRules.canSubmit("exactly twenty chars"))
    }
}
