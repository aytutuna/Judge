package com.okjudge.judge.core.display

import androidx.test.core.app.ApplicationProvider
import com.okjudge.judge.Fixtures
import com.okjudge.judge.core.model.VerdictResult
import com.okjudge.judge.i18n.AppLang
import com.okjudge.judge.i18n.LocalizedStrings
import com.okjudge.judge.i18n.Strings
import com.okjudge.judge.bool
import com.okjudge.judge.num
import com.okjudge.judge.str
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.time.ZoneOffset
import java.util.TimeZone

/**
 * Display ports that produce text, checked against the strings the web
 * code produced (display-vectors.json) through the generated resources.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class TextVectorsTest {
    private val strings = LocalizedStrings(ApplicationProvider.getApplicationContext())
    private fun s(lang: String): Strings = strings.of(AppLang.fromTag(lang)!!)

    @Test
    fun verdictLabels_andPartyNames() {
        for (v in Fixtures.list("verdicts")) {
            val sample = v.str("sample")!!
            val lang = v.str("lang")!!
            val outcome = Fixtures.sample(sample)
            val selfLang = ContentLang.verdictLang(outcome.result.result)
            val parties = PartyNames.partyNames(outcome.nameMap, selfLang, s(lang))
            val where = "$sample/$lang"
            assertEquals(where, v.str("nameA"), parties.nameA)
            assertEquals(where, v.str("nameB"), parties.nameB)
            assertEquals(where, v.bool("aIsSelf"), parties.aIsSelf)
            assertEquals(where, v.bool("bIsSelf"), parties.bIsSelf)
            assertEquals(where, v.str("label"), VerdictDisplay.verdictLabel(outcome.result.result, parties, s(lang)))
            assertEquals(where, v.str("confidence"), VerdictDisplay.confidenceLabel(outcome.result.result, s(lang)))
        }
    }

    @Test
    fun pluralWaits_takeEachLanguagesForms() {
        val waits = Fixtures.list("pluralWaits")
        assertEquals(80, waits.size)
        for (w in waits) {
            assertEquals("${w["seconds"]}/${w.str("lang")}", w.str("text"), Errors.formatWait(s(w.str("lang")!!), w.num("seconds")))
        }
    }

    @Test
    fun everyEnabledLanguage_findsItsOwnResources() {
        // Hebrew and Indonesian live under Android's old codes, Chinese by script.
        assertEquals("צד A", s("he").partyA)
        assertEquals("Pihak A", s("id").partyA)
        assertEquals("當事人A", s("zh-Hant").partyA)
        assertEquals("当事人A", s("zh-Hans").partyA)
        assertEquals("Parte A", s("pt-PT").partyA)
        assertEquals("Partei A", s("de").partyA)
        for (lang in AppLang.enabled) {
            if (lang != AppLang.EN) assertNotEquals(lang.tag, s("en").getVerdict, strings.of(lang).getVerdict)
        }
        assertEquals("1 вердикт", s("ru").pricingPack(1))
        assertEquals("3 вердикта", s("ru").pricingPack(3))
        assertEquals("5 вердиктов", s("ru").pricingPack(5))
        assertEquals("21 вердикт", s("ru").pricingPack(21))
        assertEquals("1 verdict left", s("en").appBalanceLeft(1))
        assertEquals("2 verdicts left", s("en").appBalanceLeft(2))
    }

    @Test
    fun confidenceLabel_countsTheJudgesOnThePanelsOwnScale() {
        val en = s("en")
        val tr = s("tr")
        fun result(verdict: String, vararg runs: String) = VerdictResult(verdict = verdict, confidence = 2, runs = runs.toList())
        assertEquals("Confidence 3 of 3", VerdictDisplay.confidenceLabel(result("side_a", "side_a", "side_a", "side_a"), en))
        assertEquals(
            "Confidence 4 of 5",
            VerdictDisplay.confidenceLabel(result("side_b", "side_b", "side_a", "side_b", "side_b", "side_b"), en),
        )
        assertEquals(
            "Confidence 5 of 7",
            VerdictDisplay.confidenceLabel(result("side_a", "side_a", "side_b", "side_a", "side_a", "dissolved", "side_a", "side_a"), en),
        )
        assertEquals("Güven: 5 üzerinden 4", VerdictDisplay.confidenceLabel(result("side_a", "side_a", "side_a", "side_b", "side_a", "side_a"), tr))
        assertEquals(en.verdictNoMajority, VerdictDisplay.confidenceLabel(result("too_close", "side_a", "side_b", "side_a"), en))
        assertNull(VerdictDisplay.confidenceLabel(VerdictResult(verdict = "side_a", confidence = 1, modelRefused = true), en))
    }

    @Test
    fun judgesLabel_andStampLabel() {
        val en = s("en")
        val tr = s("tr")
        val runs = listOf("side_a", "side_a", "side_b")
        assertEquals("The judges", VerdictDisplay.judgesLabel(null, en))
        assertEquals("The judges", VerdictDisplay.judgesLabel(VerdictResult(verdict = "side_a"), en))
        assertEquals("Judges · 2 of 3 agree", VerdictDisplay.judgesLabel(VerdictResult(verdict = "side_a", runs = runs), en))
        assertEquals("Yargıçlar · 2/3 aynı fikirde", VerdictDisplay.judgesLabel(VerdictResult(verdict = "side_a", runs = runs), tr))
        assertEquals("Judges · split", VerdictDisplay.judgesLabel(VerdictResult(verdict = "too_close", runs = runs), en))

        val parties = PartyLabels("Deniz", "Party B", aIsSelf = false, bIsSelf = false)
        assertEquals("Deniz is right", VerdictDisplay.stampLabel(VerdictResult(verdict = "side_a"), parties, en))
        assertEquals("You're right", VerdictDisplay.stampLabel(VerdictResult(verdict = "side_b"), parties.copy(bIsSelf = true), en))
        assertEquals("Split", VerdictDisplay.stampLabel(VerdictResult(verdict = "split"), parties, en))
        assertEquals("Conditional", VerdictDisplay.stampLabel(VerdictResult(verdict = "conditional"), parties, en))
        assertEquals("Dissolved", VerdictDisplay.stampLabel(VerdictResult(verdict = "dissolved"), parties, en))
        assertEquals("Too close", VerdictDisplay.stampLabel(VerdictResult(verdict = "too_close"), parties, en))
        assertEquals("Başa baş", VerdictDisplay.stampLabel(VerdictResult(verdict = "too_close"), parties, tr))
    }

    @Test
    fun nameMapCases() {
        val cases = Fixtures.list("names")
        assertEquals(16, cases.size)
        for (c in cases) {
            val where = "${c.str("case")}/${c.str("lang")}"
            val parties = PartyNames.partyNames(
                Fixtures.nameMap(c["nameMap"]!!),
                AppLang.fromTag(c.str("selfLang"))!!,
                s(c.str("lang")!!),
            )
            assertEquals(where, c.str("nameA"), parties.nameA)
            assertEquals(where, c.str("nameB"), parties.nameB)
            assertEquals(where, c.bool("aIsSelf"), parties.aIsSelf)
            assertEquals(where, c.bool("bIsSelf"), parties.bIsSelf)
        }
    }

    @Test
    fun waits() {
        val waits = Fixtures.list("waits")
        assertEquals(26, waits.size)
        for (w in waits) {
            val seconds = w.num("seconds")
            assertEquals("${w["seconds"]}/${w.str("lang")}", w.str("text"), Errors.formatWait(s(w.str("lang")!!), seconds))
        }
    }

    @Test
    fun errorMessages() {
        val previous = TimeZone.getDefault()
        TimeZone.setDefault(TimeZone.getTimeZone(ZoneOffset.UTC))
        try {
            val errors = Fixtures.list("errors")
            assertEquals(28, errors.size)
            for (e in errors) {
                val lang = AppLang.fromTag(e.str("lang"))!!
                val body = e["body"]?.takeIf { it !is JsonNull }?.jsonObject ?: JsonObject(emptyMap())
                val message = Errors.apiErrorMessage(
                    s(lang.tag), lang,
                    code = body.str("code"),
                    status = e.num("status")?.toInt(),
                    retryAfterSec = body.num("retryAfterSec"),
                    resetsAt = body.str("resetsAt"),
                    serverText = body.str("error"),
                )
                assertEquals("${body.str("code")}/${e.num("status")}/${lang.tag}", e.str("message"), message)
            }
        } finally {
            TimeZone.setDefault(previous)
        }
    }

    @Test
    fun transportErrors_haveAppCopy() {
        val en = s("en")
        assertEquals(en.appErrorOffline, Errors.message(UiError.Offline, en, AppLang.EN))
        assertEquals(en.appErrorTimeout, Errors.message(UiError.Timeout, en, AppLang.EN))
        val tr = s("tr")
        assertEquals(tr.appErrorBadOrigin, Errors.message(UiError.Api("bad_origin", 403), tr, AppLang.TR))
        assertEquals(en.errorFallback, Errors.message(UiError.Unknown, en, AppLang.EN))
        assertEquals(en.errorUnavailable, Errors.message(UiError.Api("unavailable", 502), en, AppLang.EN))
    }

    @Test
    fun failedAsyncVerdicts_useTheExistingCopy() {
        val en = s("en")
        val tr = s("tr")
        val server = "English text from the server"
        assertEquals(en.errorQuota, Errors.message(UiError.Api("quota", 502, serverText = server), en, AppLang.EN))
        assertEquals(tr.errorUnavailable, Errors.message(UiError.Api("unavailable", 502, serverText = server), tr, AppLang.TR))
        assertEquals(tr.refusedNote, Errors.message(UiError.Api("refused", 502, serverText = server), tr, AppLang.TR))
    }

    @Test
    fun pluralWithoutNumber_rendersBothForms() {
        val en = s("en")
        assertEquals("1 independent AI judge voted:", en.judgesVoted(1))
        assertEquals(true, en.judgesVoted(3).startsWith("3 "))
    }

    @Test
    fun panelSummary_countsSeatTiersWithoutModelNames() {
        val en = s("en")
        val text = VerdictDisplay.panelSummary(listOf("claude-sonnet-4", "claude-haiku-4", "claude-sonnet-4", "mystery"), en)
        assertEquals("Judges: 3 strong + 1 quick", text)
        assertEquals("Judges: 1 quick", VerdictDisplay.panelSummary(listOf("claude-haiku-4"), en))
        val tr = s("tr")
        assertEquals("Yargıçlar: 2 güçlü + 3 hızlı", VerdictDisplay.panelSummary(listOf("a-sonnet", "b-sonnet", "x-haiku", "y-haiku", "z-haiku"), tr))
    }
}
