package com.okjudge.judge.core.display

import androidx.test.core.app.ApplicationProvider
import com.okjudge.judge.Fixtures
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
        }
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
    fun confidenceWords() {
        for (c in Fixtures.list("confidence")) {
            val n = c.num("n")!!.toInt()
            assertEquals(c.str("text"), VerdictDisplay.confidenceText(n, s(c.str("lang")!!)))
        }
        assertEquals(VerdictDisplay.confidenceText(5, s("en")), VerdictDisplay.confidenceText(9, s("en")))
    }

    @Test
    fun transportErrors_haveAppCopy() {
        val en = s("en")
        assertEquals(en.appErrorOffline, Errors.message(UiError.Offline, en, AppLang.EN))
        assertEquals(en.appErrorTimeout, Errors.message(UiError.Timeout, en, AppLang.EN))
        assertEquals(en.appTurnstileError, Errors.message(UiError.BotCheck, en, AppLang.EN))
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
