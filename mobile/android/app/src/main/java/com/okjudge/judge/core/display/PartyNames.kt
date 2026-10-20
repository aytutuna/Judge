package com.okjudge.judge.core.display

import com.okjudge.judge.core.model.NameMapping
import com.okjudge.judge.i18n.AppLang
import com.okjudge.judge.i18n.Strings
import java.util.Locale
import java.util.regex.Pattern

/** Display names for the two parties, plus the structural self flags. */
data class PartyLabels(val nameA: String, val nameB: String, val aIsSelf: Boolean, val bIsSelf: Boolean)

/** Who a label letter stands for (lib/names.ts `Party`). */
data class Party(val name: String, val self: Boolean)

/**
 * Port of the label half of lib/names.ts: `canonicalLabel`, `bareName`,
 * `resolveParties` and `partyNames`. Putting real names back into the
 * verdict text (`restoreNames`) is phase 1.5.
 */
object PartyNames {
    private val TR = Locale.forLanguageTag("tr")

    val TR_SELF: Set<String> = setOf(
        "ben", "bence", "benim", "bana", "beni", "bende", "benden", "benimle", "bendeki",
        "benimki", "kendim", "kendime", "kendimi", "kendimden",
    )

    /** /^(i|me|my|mine|myself)$/i: ASCII case folding only, like the JS regex without `u`. */
    private val EN_SELF: Pattern = Pattern.compile("^(i|me|my|mine|myself)$", Pattern.CASE_INSENSITIVE)

    private val LABEL: Pattern = Pattern.compile(
        "^(?:(?:party|taraf)\\s+([ab])|(?:person|kişi)\\s+([c-z]))(?:['’]\\p{L}*)?$",
        Pattern.CASE_INSENSITIVE or Pattern.UNICODE_CASE,
    )

    private val QUOTES_EDGE = Regex("^[\"“”«»]+|[\"“”«»]+$")
    private val SUFFIXED: Pattern = Pattern.compile("^(.*\\p{L}.*\\p{L}|\\p{L}{2,})['’]\\p{Ll}{1,10}$")
    private val STARTS_UPPER: Pattern = Pattern.compile("^\\p{Lu}")

    /** "taraf b'ye" -> "Party B", "Kişi C" -> "Person C", null when not a person label. */
    fun canonicalLabel(replacement: String): String? {
        val m = LABEL.matcher(replacement.jsTrim())
        if (!m.matches()) return null
        val a = m.group(1)
        return if (a != null) "Party ${a.uppercase(Locale.ROOT)}" else "Person ${m.group(2)!!.uppercase(Locale.ROOT)}"
    }

    private fun labelLetter(replacement: String): String? = canonicalLabel(replacement)?.takeLast(1)

    /** A reported name minus a Turkish case suffix or an English possessive ("Deniz'in" -> "Deniz"). */
    fun bareName(original: String): String {
        val s = original.jsTrim().replace(QUOTES_EDGE, "").jsTrim()
        val m = SUFFIXED.matcher(s)
        return if (m.matches()) m.group(1)!! else s
    }

    private fun isSelfOriginal(original: String, selfLang: AppLang): Boolean =
        EN_SELF.matcher(original).matches() ||
            (selfLang == AppLang.TR && original.lowercase(TR) in TR_SELF)

    private fun startsUpper(s: String): Boolean = STARTS_UPPER.matcher(s).find()

    /** Label letter ("A", "B", "C"...) -> who it stands for (resolveParties). */
    fun resolveParties(nameMap: List<NameMapping>?, selfLang: AppLang): Map<String, Party> {
        val parties = LinkedHashMap<String, Party>()
        for (m in nameMap.orEmpty()) {
            val letter = labelLetter(m.replacement) ?: continue
            val name = bareName(m.original)
            if (name.isEmpty()) continue
            val current = parties[letter]
            if (letter == "A" && isSelfOriginal(name, selfLang)) {
                parties["A"] = Party(name, self = true)
            } else if (current == null || (!current.self && !startsUpper(current.name) && startsUpper(name))) {
                parties[letter] = Party(name, self = false)
            }
        }
        return parties
    }

    /**
     * Display names. `you`, `partyA` and `partyB` are the UI-language labels;
     * narrator detection follows `selfLang`, the language the argument was judged in.
     */
    fun partyNames(
        nameMap: List<NameMapping>?,
        selfLang: AppLang,
        you: String,
        partyA: String,
        partyB: String,
    ): PartyLabels {
        val parties = resolveParties(nameMap, selfLang)
        val a = parties["A"]
        val b = parties["B"]
        return PartyLabels(
            nameA = if (a != null) (if (a.self) you else a.name) else partyA,
            nameB = b?.name ?: partyB,
            aIsSelf = a?.self == true,
            bIsSelf = false,
        )
    }

    fun partyNames(nameMap: List<NameMapping>?, selfLang: AppLang, s: Strings): PartyLabels =
        partyNames(nameMap, selfLang, s.you, s.partyA, s.partyB)

    /** Real names that may open a conditional clause (never the narrator). */
    fun restoredNames(nameMap: List<NameMapping>?, selfLang: AppLang): List<String> =
        resolveParties(nameMap, selfLang).values.filter { !it.self }.map { it.name }
}

/** String.prototype.trim(): strips whitespace and line terminators, including NBSP and BOM. */
internal fun String.jsTrim(): String = trim { it.isWhitespace() || it == '\u00A0' || it == '\uFEFF' }
