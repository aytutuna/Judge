package com.okjudge.judge.i18n

import com.okjudge.judge.Fixtures
import com.okjudge.judge.core.display.ContentLang
import com.okjudge.judge.core.model.WireJson
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class LanguageTest {
    @Test
    fun tags_matchLikeTheWebsite() {
        assertEquals(AppLang.DE, langOfTag("de-AT"))
        assertEquals(AppLang.ZH_HANS, langOfTag("zh"))
        assertEquals(AppLang.ZH_HANS, langOfTag("zh-Hans-CN"))
        assertEquals(AppLang.ZH_HANT, langOfTag("zh-Hant-TW"))
        assertEquals(AppLang.ZH_HANT, langOfTag("zh-HK"))
        assertEquals(AppLang.ZH_HANT, langOfTag("zh_TW"))
        assertEquals(AppLang.PT_BR, langOfTag("pt"))
        assertEquals(AppLang.PT_BR, langOfTag("pt-BR"))
        assertEquals(AppLang.PT_PT, langOfTag("pt-PT"))
        assertEquals(AppLang.PT_PT, langOfTag("pt-AO"))
        assertEquals(AppLang.NB, langOfTag("nn-NO"))
        assertEquals(AppLang.NB, langOfTag("no"))
        // Android's own codes for Hebrew and Indonesian.
        assertEquals(AppLang.HE, langOfTag("iw-IL"))
        assertEquals(AppLang.ID, langOfTag("in"))
        assertNull(langOfTag("fa-IR"))
        assertNull(langOfTag(""))
    }

    @Test
    fun theFirstSpokenPreferenceWins() {
        assertEquals(AppLang.FR, matchLang(listOf("fa-IR", "fr-CA", "de")))
        assertEquals(AppLang.AR, matchLang(listOf("ar-EG")))
        assertEquals(AppLang.EN, matchLang(listOf("fa", "sw")))
        assertEquals(AppLang.EN, matchLang(emptyList()))
        assertEquals(AppLang.JA, LangPref.SYSTEM.resolve(listOf("ja-JP", "en-US")))
        assertEquals(AppLang.TR, LangPref(AppLang.TR).resolve(listOf("en-US")))
    }

    @Test
    fun storedPreference_keepsOldValuesWorking() {
        assertEquals(LangPref(AppLang.EN), LangPref.fromStored("en"))
        assertEquals(LangPref(AppLang.TR), LangPref.fromStored("tr"))
        assertEquals(LangPref.SYSTEM, LangPref.fromStored("system"))
        assertEquals(LangPref.SYSTEM, LangPref.fromStored(null))
        assertEquals(LangPref(AppLang.ZH_HANT), LangPref.fromStored("zh-Hant"))
        assertEquals(LangPref.SYSTEM, LangPref.fromStored("klingon"))
        for (lang in AppLang.enabled) assertEquals(lang.tag, LangPref(lang), LangPref.fromStored(LangPref(lang).stored))
        assertEquals("system", LangPref.SYSTEM.stored)
    }

    @Test
    fun everyCode_decodes() {
        for (lang in AppLang.entries) assertEquals(lang, AppLang.fromTag(lang.tag))
        val raw = Fixtures.verdicts["verdictResponses"]!!.jsonObject["win_a_self"]!!.jsonObject["result"]!!.jsonObject
        val json = JsonObject(raw + ("lang" to JsonPrimitive("zh-Hant"))).toString()
        val result = WireJson.decodeResult(json).result
        assertEquals("zh-Hant", result.lang)
        assertEquals(AppLang.ZH_HANT, ContentLang.verdictLang(result))
    }
}
