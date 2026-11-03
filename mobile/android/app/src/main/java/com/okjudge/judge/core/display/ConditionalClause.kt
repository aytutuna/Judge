package com.okjudge.judge.core.display

import com.okjudge.judge.i18n.AppLang
import java.util.Locale

/**
 * Port of `conditionalClause` (components/VerdictReveal.tsx): the clause
 * after the "If" prefix. "If" and "Eğer" are stripped in every language, and
 * the language's own [prefix] in the others. Turkish lowercases with the
 * Turkish locale and keeps the capital for "Taraf" or a real name in `keep`.
 */
object ConditionalClause {
    private val MARKER = Regex("^(eğer|if)\\s+", RegexOption.IGNORE_CASE)
    private val YOU = Regex("^(You|Your)\\b")
    private val TR = Locale.forLanguageTag("tr")

    /** Scripts that write the prefix straight into the clause. */
    private val UNSPACED = setOf(AppLang.JA, AppLang.ZH_HANS, AppLang.ZH_HANT, AppLang.TH)

    fun clause(raw: String, lang: AppLang, prefix: String, keep: List<String> = emptyList()): String {
        var s = raw.replaceFirst(MARKER, "")
        if (lang != AppLang.EN && lang != AppLang.TR) {
            val end = if (lang in UNSPACED) "" else "(?![\\p{L}\\p{N}])"
            s = s.replaceFirst(Regex("^${Regex.escape(prefix)}$end\\s*", RegexOption.IGNORE_CASE), "")
        }
        if (s.isEmpty()) return s
        if (lang == AppLang.TR) {
            if (s.startsWith("Taraf") || keep.any { it.isNotEmpty() && s.startsWith(it) }) return s
            return s.substring(0, 1).lowercase(TR) + s.substring(1)
        }
        return if (YOU.containsMatchIn(s)) s.substring(0, 1).lowercase(Locale.ROOT) + s.substring(1) else s
    }

    /** The prefix and the clause, as the branch's lead. */
    fun lead(raw: String, lang: AppLang, prefix: String, keep: List<String> = emptyList()): String =
        prefix + (if (lang in UNSPACED) "" else " ") + clause(raw, lang, prefix, keep)

    /** Points from the condition to its outcome, so leftwards in right-to-left languages. */
    fun arrow(lang: AppLang): String = if (lang.rtl) "←" else "→"
}
