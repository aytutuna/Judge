package com.okjudge.judge.core.display

import com.okjudge.judge.core.model.VerdictResult
import com.okjudge.judge.i18n.AppLang

/** Ports of `contentLang` (lib/i18n.ts) and `verdictLang` (lib/content-lang.ts). */
object ContentLang {
    private val TURKISH = Regex("[ğıİşĞŞ]|\\bTaraf [AB]\\b")

    /** Best-effort language of verdict text from the text alone. */
    fun contentLang(text: String): AppLang = if (TURKISH.containsMatchIn(text)) AppLang.TR else AppLang.EN

    /** The language a verdict's free text is written in. */
    fun verdictLang(result: VerdictResult): AppLang {
        AppLang.fromTag(result.lang)?.let { return it }
        val map = result.argumentMap
        val text = buildList {
            add(result.headline)
            add(result.crux)
            add(result.losingSideBestPoint)
            add(map.bedrockA)
            add(map.bedrockB)
            map.sideA.forEach { add(it.claim) }
            map.sideB.forEach { add(it.claim) }
        }.joinToString(" ")
        return contentLang(text)
    }
}
