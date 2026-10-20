package com.okjudge.judge.core.display

import com.okjudge.judge.i18n.AppLang
import java.util.Locale

/**
 * Port of `conditionalClause` (components/VerdictReveal.tsx): the clause
 * after the "If"/"Eğer" prefix. Both markers are stripped in both languages;
 * Turkish lowercases with the Turkish locale and keeps the capital for
 * "Taraf" or a real name in `keep`.
 */
object ConditionalClause {
    private val MARKER = Regex("^(eğer|if)\\s+", RegexOption.IGNORE_CASE)
    private val YOU = Regex("^(You|Your)\\b")
    private val TR = Locale.forLanguageTag("tr")

    fun clause(raw: String, lang: AppLang, keep: List<String> = emptyList()): String {
        val s = raw.replaceFirst(MARKER, "")
        if (s.isEmpty()) return s
        if (lang == AppLang.TR) {
            if (s.startsWith("Taraf") || keep.any { it.isNotEmpty() && s.startsWith(it) }) return s
            return s.substring(0, 1).lowercase(TR) + s.substring(1)
        }
        return if (YOU.containsMatchIn(s)) s.substring(0, 1).lowercase(Locale.ROOT) + s.substring(1) else s
    }
}
