package com.okjudge.judge.core.display

import com.okjudge.judge.core.model.NameMapping
import com.okjudge.judge.core.model.Side
import com.okjudge.judge.i18n.AppLang
import com.okjudge.judge.i18n.Strings
import java.util.Locale
import java.util.regex.Pattern

/** Display names for the parties, plus the structural self flags. C and D are only read on verdicts with more than two sides. */
data class PartyLabels(
    val nameA: String,
    val nameB: String,
    val aIsSelf: Boolean,
    val bIsSelf: Boolean,
    val nameC: String = "",
    val nameD: String = "",
    val cIsSelf: Boolean = false,
    val dIsSelf: Boolean = false,
) {
    fun name(side: Side): String = when (side) {
        Side.A -> nameA
        Side.B -> nameB
        Side.C -> nameC
        Side.D -> nameD
    }

    fun isSelf(side: Side): Boolean = when (side) {
        Side.A -> aIsSelf
        Side.B -> bIsSelf
        Side.C -> cIsSelf
        Side.D -> dIsSelf
    }
}

/** Who a label letter stands for (lib/names.ts `Party`). */
data class Party(val name: String, val self: Boolean)

/**
 * Port of the label half of lib/names.ts: `canonicalLabel`, `bareName`,
 * `resolveParties` and `partyNames`. Putting real names back into the
 * verdict text (`restoreNames`, `personalizeResult`) is in RestoreNames.kt.
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

    /** With more than two sides the sides take A to D and other people start at E. */
    private val LABEL_MANY: Pattern = Pattern.compile(
        "^(?:(?:party|taraf)\\s+([a-d])|(?:person|kişi)\\s+([e-z]))(?:['’]\\p{L}*)?$",
        Pattern.CASE_INSENSITIVE or Pattern.UNICODE_CASE,
    )

    private val QUOTES_EDGE = Regex("^[\"“”«»]+|[\"“”«»]+$")
    private val SUFFIXED: Pattern = Pattern.compile("^(.*\\p{L}.*\\p{L}|\\p{L}{2,})['’]\\p{Ll}{1,10}$")
    private val STARTS_UPPER: Pattern = Pattern.compile("^\\p{Lu}")

    /**
     * "taraf b'ye" -> "Party B", "Kişi C" -> "Person C", null when not a person label. [sides] is how many
     * sides the document has: only one with more than two reads "Party C" and "Party D" as sides.
     */
    fun canonicalLabel(replacement: String, sides: Int = 2): String? {
        val m = (if (sides > 2) LABEL_MANY else LABEL).matcher(replacement.jsTrim())
        if (!m.matches()) return null
        val a = m.group(1)
        if (a == null) return "Person ${m.group(2)!!.uppercase(Locale.ROOT)}"
        val letter = a.uppercase(Locale.ROOT)
        return if (sides > 2 && letter > lastSide(sides)) null else "Party $letter"
    }

    /** The letter of the last side of a document: "B", "C" or "D". */
    fun lastSide(sides: Int): String = ('A' + (sides.coerceIn(2, 4) - 1)).toString()

    /** Whether a label's word and letter go together: sides take the first letters, other people the rest. */
    fun labelFits(word: String, letter: String, sides: Int = 2): Boolean {
        val isParty = word == "Party" || word == "Taraf"
        if (sides > 2) return if (isParty) letter <= lastSide(sides) else letter >= "E"
        return isParty == (letter == "A" || letter == "B")
    }

    private fun labelLetter(replacement: String, sides: Int = 2): String? = canonicalLabel(replacement, sides)?.takeLast(1)

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

    /**
     * Label letter ("A", "B", "C"...) -> who it stands for (resolveParties).
     * [selfParty] is the narrator's slot: "B" for the side that answered a case.
     */
    fun resolveParties(nameMap: List<NameMapping>?, selfLang: AppLang, selfParty: String = "A", sides: Int = 2): Map<String, Party> {
        val parties = LinkedHashMap<String, Party>()
        val last = lastSide(sides)
        for (m in nameMap.orEmpty()) {
            val letter = labelLetter(m.replacement, sides) ?: continue
            val name = bareName(m.original)
            if (name.isEmpty()) continue
            val current = parties[letter]
            if (letter == selfParty && isSelfOriginal(name, selfLang)) {
                parties[letter] = Party(name, self = true)
            } else if (letter > last && isSelfOriginal(name, selfLang)) {
                // A first-person word never names someone who is not a side.
                continue
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

    fun partyNames(nameMap: List<NameMapping>?, selfLang: AppLang, s: Strings, sides: Int = 2): PartyLabels =
        if (sides > 2) partyNamesFor(Side.first(sides), nameMap, selfLang, s) else partyNames(nameMap, selfLang, s.you, s.partyA, s.partyB)

    /** "Party C" in the app's language. */
    fun label(side: Side, s: Strings): String = when (side) {
        Side.A -> s.partyA
        Side.B -> s.partyB
        Side.C -> s.partyC
        Side.D -> s.partyD
    }

    /**
     * Display names for a verdict with three or four sides (partyNamesFor in lib/names.ts). The narrator's
     * entry makes [selfParty] "you"; a side the map says nothing about shows its label, and with
     * [viewerKnown] the viewer's own reads "Party C (you)".
     */
    fun partyNamesFor(
        sides: List<Side>,
        nameMap: List<NameMapping>?,
        selfLang: AppLang,
        s: Strings,
        selfParty: String = "A",
        viewerKnown: Boolean = false,
    ): PartyLabels {
        val resolved = resolveParties(nameMap, selfLang, selfParty, sides.size)
        fun entry(side: Side): Pair<String, Boolean> {
            if (side !in sides) return "" to false
            val found = resolved[side.letter]
            val label = label(side, s)
            return when {
                found != null -> (if (found.self) s.you else found.name) to found.self
                viewerKnown && selfParty == side.letter -> s.partyYouLabel(label) to true
                else -> label to false
            }
        }
        val a = entry(Side.A)
        val b = entry(Side.B)
        val c = entry(Side.C)
        val d = entry(Side.D)
        return PartyLabels(a.first, b.first, a.second, b.second, c.first, d.first, c.second, d.second)
    }

    /** Real names that may open a conditional clause (never the narrator). */
    fun restoredNames(nameMap: List<NameMapping>?, selfLang: AppLang, sides: Int = 2): List<String> =
        resolveParties(nameMap, selfLang, sides = sides).values.filter { !it.self }.map { it.name }
}

/** String.prototype.trim(): strips whitespace and line terminators, including NBSP and BOM. */
internal fun String.jsTrim(): String = trim { it.isWhitespace() || it == '\u00A0' || it == '\uFEFF' }
