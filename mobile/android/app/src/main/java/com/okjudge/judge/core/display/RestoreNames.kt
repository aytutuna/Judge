package com.okjudge.judge.core.display

import com.okjudge.judge.core.model.NameMapping
import com.okjudge.judge.core.model.VerdictResult
import com.okjudge.judge.i18n.AppLang
import java.util.Locale

/** A suffix after a label's apostrophe, read back as a grammatical case (lib/names.ts `TrCase`). */
enum class TrCase { GEN, GENKI, ACC, DAT, LOC, LOCKI, ABL, INS, COP, PAST, KEN, EVID }

/**
 * Port of the text half of lib/names.ts: `trSuffix`, `restoreNames` and
 * `personalizeResult`, in the same order and with the same rules. Display
 * only: shared text, stored history and cached translations stay anonymized.
 *
 * JS `\s`, `trim` and `$` differ from java.util.regex, so patterns use [WS]
 * and `\z`, and trimming goes through [isJsSpace].
 */
object RestoreNames {
    private val TR = Locale.forLanguageTag("tr")

    /** JS `\s`: WhiteSpace plus LineTerminator. */
    private const val WS = "[\\t\\n\\x0B\\f\\r\\uFEFF\\u2028\\u2029\\p{Zs}]"

    private fun isJsSpace(c: Char): Boolean =
        c == '\t' || c == '\n' || c == '\u000B' || c == '\u000C' || c == '\r' || c == '﻿' ||
            c == ' ' || c == ' ' || Character.getType(c) == Character.SPACE_SEPARATOR.toInt()

    // --- Turkish suffixes on a name -------------------------------------------------

    /** As the judge wrote it for the letter name ("A'nın", "B'ye"); matched whole. */
    private val TR_CASES: List<Pair<Regex, TrCase>> = listOf(
        Regex("n?[ıiuü]nki") to TrCase.GENKI,
        Regex("n?[ıiuü]n") to TrCase.GEN,
        Regex("y?[ıiuü]") to TrCase.ACC,
        Regex("y?[ae]") to TrCase.DAT,
        Regex("[dt][ae]ki") to TrCase.LOCKI,
        Regex("[dt][ae]n") to TrCase.ABL,
        Regex("[dt][ae]") to TrCase.LOC,
        Regex("y?l[ae]") to TrCase.INS,
        Regex("[dt][ıiuü]r") to TrCase.COP,
        Regex("y?[dt][ıiuü]") to TrCase.PAST,
        Regex("y?ken") to TrCase.KEN,
        Regex("y?m[ıiuü]ş") to TrCase.EVID,
    )

    private fun classifyTr(suffix: String): TrCase? {
        val s = suffix.lowercase(TR)
        return TR_CASES.firstOrNull { it.first.matches(s) }?.second
    }

    private const val VOWELS = "aeıioöuüâîû"
    private fun isVowel(ch: String): Boolean = VOWELS.contains(ch)

    /** Voiceless consonants: a following d of the locative/ablative/copula turns t. */
    private const val VOICELESS = "fstkçşhp"

    /** Names whose final "l" is palatal ("Kemal'in", not "Kemal'ın"). */
    private val PALATAL_L = setOf("kemal", "cemal", "celal", "hilal", "bilal", "nihal", "meral", "hayal", "celâl", "kemâl")

    private val WS_RUN = Regex("$WS+")

    /** The string's code points, one string each (`[...s]`). */
    private fun codePoints(s: String): List<String> = buildList {
        var i = 0
        while (i < s.length) {
            val cp = s.codePointAt(i)
            add(String(Character.toChars(cp)))
            i += Character.charCount(cp)
        }
    }

    /**
     * The Turkish suffix for `name` in case `c`: vowel harmony on the last
     * vowel, a buffer consonant after a final vowel, d->t after a voiceless
     * consonant. Null when the name has no vowel to harmonise with ("JJ").
     */
    fun trSuffix(name: String, c: TrCase): String? {
        val lower = name.trim(::isJsSpace).lowercase(TR)
        val letters = codePoints(lower).filter { Character.isLetter(it.codePointAt(0)) }
        val last = letters.lastOrNull() ?: return null
        var v = letters.lastOrNull(::isVowel) ?: return null
        val lastWord = lower.split(WS_RUN).last()
        if (lastWord in PALATAL_L) v = "e"
        val back = "aıouâû".contains(v)
        val a2 = if (back) "a" else "e"
        val i4 = when {
            "aıâ".contains(v) -> "ı"
            "eiî".contains(v) -> "i"
            "ouû".contains(v) -> "u"
            else -> "ü"
        }
        val endV = isVowel(last)
        val d = if (VOICELESS.contains(last)) "t" else "d"
        val y = if (endV) "y" else ""
        return when (c) {
            TrCase.GEN -> (if (endV) "n" else "") + i4 + "n"
            TrCase.GENKI -> (if (endV) "n" else "") + i4 + "nki"
            TrCase.ACC -> y + i4
            TrCase.DAT -> y + a2
            TrCase.LOC -> d + a2
            TrCase.LOCKI -> d + a2 + "ki"
            TrCase.ABL -> d + a2 + "n"
            TrCase.INS -> y + "l" + a2
            TrCase.COP -> d + i4 + "r"
            TrCase.PAST -> if (endV) "yd$i4" else d + i4
            TrCase.KEN -> y + "ken"
            TrCase.EVID -> y + "m" + i4 + "ş"
        }
    }

    // --- Restoring names in verdict text ---------------------------------------------

    /** A label in running text, with an optional suffix after an apostrophe, in either language. */
    private val LABEL_IN_TEXT =
        Regex("(?<![\\p{L}\\p{N}])(Party|Taraf|Person|Kişi) ([A-Z])(?:(['’])(\\p{Ll}+))?(?![\\p{L}\\p{N}])")

    private val OPENERS_END = Regex("[\"“”‘'«(\\[]+\\z")
    private val SENTENCE_END = Regex("[.!?…][\"”’»)]*\\z")

    /** Whether the text before a position ends a sentence (or is empty). */
    private fun atSentenceStart(before: String): Boolean {
        val b = before.replaceFirst(OPENERS_END, "").trimEnd(::isJsSpace)
        return b.isEmpty() || SENTENCE_END.containsMatchIn(b)
    }

    private fun capitalize(s: String, lang: AppLang): String {
        if (s.isEmpty()) return s
        return s.substring(0, 1).uppercase(if (lang == AppLang.TR) TR else Locale.ENGLISH) + s.substring(1)
    }

    // English narrator: "you", with the verb right after it agreeing.

    private val EN_BE_HAVE: Map<String, String> = mapOf("is" to "are", "was" to "were", "has" to "have", "does" to "do")

    /** Words right after a subject that need no agreement: modals and pasts. */
    private val EN_NEUTRAL_NEXT = setOf(
        "can", "cannot", "could", "will", "would", "should", "might", "must", "may", "shall",
        "did", "had", "said", "told", "made", "took", "got", "saw", "knew", "thought", "felt", "left",
        "paid", "spent", "kept", "held", "went", "came", "gave", "put", "ran", "won", "lost", "meant",
        "chose", "forgot", "understood", "bought", "brought", "sent", "wrote", "began", "let", "set",
        // Already plural: only reachable when the label is half of "X and Party A".
        "are", "were", "have", "do", "and", "or",
    )

    /** The same, before "n't". */
    private val EN_NEUTRAL_NEG = setOf(
        "ca", "wo", "could", "would", "should", "might", "must", "did", "had", "are", "were", "have", "do",
    )

    /** Words right after a label that make it an object ("Party B owes Party A an apology"). */
    private val EN_OBJECT_NEXT = setOf(
        "a", "an", "the", "some", "any", "no", "this", "that", "these", "those", "his", "her", "their",
        "its", "our", "lots", "nothing", "something", "anything", "everything",
    )

    /** Words before a label that make it the subject of what follows. */
    private val EN_SUBJECT_INTRO = setOf(
        "and", "but", "or", "because", "since", "while", "whereas", "although", "though", "if", "when",
        "unless", "that", "so", "until", "whether", "where", "what", "who", "which", "once", "than",
        "says", "said", "thinks", "thought", "believes", "believed", "argues", "argued", "claims",
        "claimed", "feels", "felt", "insists", "insisted", "admits", "admitted", "knows", "knew",
        "assumes", "assumed", "expects", "expected", "means", "shows", "suggests", "both", "either",
    )

    /** Words before a label that make it an object: no verb follows it. */
    private val EN_PREPOSITIONS = setOf(
        "to", "for", "with", "about", "of", "from", "at", "on", "by", "against", "toward", "towards",
        "like", "unlike", "over", "behind", "without", "within", "into", "onto", "upon", "under",
        "around", "near", "beside", "via", "per", "between", "among",
    )

    /** Common verbs whose -s form is safe to lower to "you" + base form. */
    private val EN_COMMON_VERBS = setOf(
        "want", "think", "say", "claim", "argue", "believe", "feel", "know", "need", "agree", "insist",
        "admit", "win", "lose", "make", "take", "get", "see", "expect", "assume", "care", "prefer",
        "mean", "try", "deserve", "point", "focus", "rely", "ignore", "refuse", "accept", "seem",
        "value", "keep", "treat", "hold", "notice", "mention", "suggest", "show", "prove", "ask",
        "promise", "plan", "choose", "decide", "understand", "remember", "forget", "worry", "help",
        "pay", "spend", "leave", "stay", "work", "call", "use", "count", "describe", "consider",
        "wish", "hope", "like", "love", "hate", "do", "go", "have", "stop", "start", "miss", "owe",
        "blame", "lie", "win", "deny", "admit", "apologize", "apologise", "complain", "object",
    )

    /** -s words that are never a third-person verb after a subject. */
    private val EN_NOT_VERBS = setOf(
        "always", "perhaps", "sometimes", "nevertheless", "towards", "its", "this", "his", "hers",
        "yours", "unless", "whereas", "across", "plus", "thus", "versus", "yes", "besides",
        "afterwards", "nowadays", "regardless", "less", "was", "is", "has", "does", "as",
        "himself", "herself", "itself", "themselves", "ourselves", "yourselves", "nonetheless",
    )

    private val ES_PLURAL = Regex("(?:ss|sh|ch|x|zz|o)es\\z")
    private val S_NOT_VERB = Regex("(?:ss|us|is|as|os|'s|’s)\\z")

    /** Base form of a third-person -s verb, or null when the word is not one. */
    private fun enBaseForm(word: String): String? {
        val w = word.lowercase(Locale.ROOT)
        if (w.length < 3 || w in EN_NOT_VERBS || !w.endsWith("s")) return null
        if (w == "goes") return "go"
        if (w == "focuses") return "focus"
        if (w.endsWith("ies")) return if (w.length > 4) w.dropLast(3) + "y" else w.dropLast(1)
        if (ES_PLURAL.containsMatchIn(w)) return w.dropLast(2)
        if (S_NOT_VERB.containsMatchIn(w)) return null
        return w.dropLast(1)
    }

    /** A known verb's third-person form ("wants", "tries"), as its base form. */
    private fun enKnownVerb(word: String): String? = enBaseForm(word)?.takeIf { it in EN_COMMON_VERBS }

    private val PREV_WORD = Regex("([A-Za-z]+)$WS*\\z")

    private fun prevWord(before: String): String =
        PREV_WORD.find(before)?.groupValues?.get(1)?.lowercase(Locale.ROOT) ?: ""

    /** Whether a word before a label is probably a verb, making the label its object. */
    private fun enVerbLike(word: String): Boolean =
        word.endsWith("s") || word.endsWith("ed") || word in EN_NEUTRAL_NEXT || word in EN_COMMON_VERBS

    private val EN_ENDS_HERE = Regex("^$WS*(?:[.!?…\"”’)\\]]|\\z)")
    private val EN_NEXT_WORD = Regex("^( )([A-Za-z]+?)(n['’]t)?(?![\\p{L}\\p{N}'’-])")
    private val EN_JOINED = Regex("^$WS+(?:and|or|but)$WS+([A-Za-z]+?)(?:n['’]t)?(?![\\p{L}'’])")
    private val EN_PAST = Regex("[a-z]{3,}ed")
    private val EN_SUBJECT_END = Regex("[.!?;:,(—–\"“]\\z")

    /**
     * "you" for an English narrator plus how much of `after` it rewrote, or
     * null to keep the label. Only the word immediately after the label is
     * looked at.
     */
    private fun enSelf(before: String, after: String): Rendered? {
        val prev = prevWord(before)
        // An object of a preposition: nothing after it agrees with it.
        if (prev in EN_PREPOSITIONS) return Rendered("you", 0)
        // Nothing after the label, or the sentence (or a quote) ends right there.
        if (EN_ENDS_HERE.containsMatchIn(after)) return Rendered("you", 0)
        val m = EN_NEXT_WORD.find(after) ?: return null
        val whole = m.value
        val space = m.groupValues[1]
        val word = m.groupValues[2]
        val neg = m.groupValues[3]
        val lower = word.lowercase(Locale.ROOT)
        // A second verb joined on must agree too ("was and is"): keep the label.
        val rest = after.substring(whole.length)
        val joined = EN_JOINED.find(rest)?.groupValues?.get(1)
        if (joined != null && (EN_BE_HAVE[joined.lowercase(Locale.ROOT)] != null || enKnownVerb(joined) != null)) return null
        EN_BE_HAVE[lower]?.let { return Rendered("you$space$it$neg", whole.length) }
        // "can't" splits as "ca" + "n't", "won't" as "wo" + "n't".
        if (neg.isNotEmpty()) return if (lower in EN_NEUTRAL_NEG) Rendered("you", 0) else null
        if (lower in EN_NEUTRAL_NEXT || lower in EN_OBJECT_NEXT) return Rendered("you", 0)
        if (EN_PAST.matches(lower) && !lower.endsWith("eed")) return Rendered("you", 0)
        val base = enKnownVerb(word) ?: return null
        val trimmed = before.trimEnd(::isJsSpace)
        val subject = trimmed.isEmpty() || EN_SUBJECT_END.containsMatchIn(trimmed) || prev in EN_SUBJECT_INTRO
        if (!subject && enVerbLike(prev)) return null
        return Rendered("you$space$base", whole.length)
    }

    // Turkish narrator: "sen" forms, only where the result is surely grammatical.

    private val TR_SELF_CASE: Map<TrCase, String> = mapOf(
        TrCase.DAT to "sana",
        TrCase.ACC to "seni",
        TrCase.ABL to "senden",
        TrCase.LOC to "sende",
        TrCase.LOCKI to "sendeki",
        TrCase.INS to "seninle",
        TrCase.GENKI to "seninki",
    )

    /** Postpositions after a bare narrator label: the pronoun takes the genitive before them. */
    private val TR_SELF_POSTPOSITION: Map<String, String> = mapOf(
        "için" to "senin için",
        "gibi" to "senin gibi",
        "kadar" to "senin kadar",
        "hakkında" to "senin hakkında",
        "ile" to "seninle",
        "tarafından" to "senin tarafından",
        "yüzünden" to "senin yüzünden",
        "açısından" to "senin açından",
        "sayesinde" to "senin sayende",
        "adına" to "senin adına",
        "yerine" to "senin yerine",
        "lehine" to "senin lehine",
        "aleyhine" to "senin aleyhine",
    )

    private const val TR_ADVERBS =
        "daha|çok|biraz|kesinlikle|tamamen|kısmen|büyük ölçüde|genel olarak|yine de|bu konuda|burada|bu kez|bu sefer|açıkça|haklı olarak"

    /** Words ending like a possessive that are quantifiers or adverbs ("Taraf A'nın çoğu iddiası"). */
    private val TR_NOT_POSSESSED = Regex("^(?:çoğu|birçoğu|aşağı|elmas)")
    private val TR_GI_END = Regex("ğ[ıiuü]\\z")
    private val TR_MASI = Regex("(?:[^aeıioöuü]|m[ae])m[ae](s[ıi])(n(?:[ae]|[ıi]|[dt][ae]n?|[ıi]n)|yl[ae])?\\z")

    /**
     * The word after "Taraf A'nın", turned to agree with "senin", or null when
     * that cannot be done safely: only "-ğI" (gains "-n") and a verbal noun
     * "-mAsI" (turns "-n") are unambiguous.
     */
    private fun trPossessedSecondPerson(word: String): String? {
        val w = word.lowercase(TR)
        if (TR_NOT_POSSESSED.containsMatchIn(w)) return null
        if (TR_GI_END.containsMatchIn(w)) return word + "n"
        val m = TR_MASI.find(w) ?: return null
        val si = m.groupValues[1]
        val ending = m.groups[2]?.value
        val at = w.length - si.length - (ending?.length ?: 0)
        val tail = when {
            ending == null -> "n"
            ending.startsWith("y") -> "nl" + word.takeLast(1)
            else -> word.substring(at + 2)
        }
        return word.substring(0, at) + tail
    }

    private val TR_POST = Regex("^$WS+(\\p{L}+)(?!\\p{L})")
    private val TR_RIGHT =
        Regex("^$WS+((?:(?:$TR_ADVERBS)$WS+)*)(haklı|haksız)(y?dı)?(?=$WS*(?:[.!?,;:)…—–]|\\z))")
    private val TR_NEXT_WORD = Regex("^($WS+)(\\p{L}+)")
    private val TR_CLITIC = Regex("^($WS+)(da|de|mı|mi|mu|mü)(?![\\p{L}\\p{N}])")
    private val TR_BACK_LAST = Regex("[aıou][^aeıioöuü]*\\z")

    /** `trCase` null is the nominative (a bare label). */
    private fun trSelf(trCase: TrCase?, after: String): Rendered? {
        if (trCase == null) {
            val post = TR_POST.find(after)
            val phrase = post?.let { TR_SELF_POSTPOSITION[it.groupValues[1].lowercase(TR)] }
            if (post != null && phrase != null) return Rendered(phrase, post.value.length)
            val right = TR_RIGHT.find(after) ?: return null
            val adverbs = right.groupValues[1]
            val adj = right.groupValues[2]
            val past = right.groupValues[3]
            val ending = if (past.isNotEmpty()) "${past}n" else "sın"
            return Rendered("sen $adverbs$adj$ending", right.value.length)
        }
        if (trCase == TrCase.GEN) {
            val next = TR_NEXT_WORD.find(after) ?: return null
            val turned = trPossessedSecondPerson(next.groupValues[2]) ?: return null
            return Rendered("senin${next.groupValues[1]}$turned", next.value.length)
        }
        val form = TR_SELF_CASE[trCase] ?: return null
        // A following "da/de" or question particle agrees with the label ("Taraf A'da da");
        // make it agree with the pronoun instead ("sende de", "sana da").
        val clitic = TR_CLITIC.find(after) ?: return Rendered(form, 0)
        val back = TR_BACK_LAST.containsMatchIn(form)
        val particle = if (clitic.groupValues[2].startsWith("m")) (if (back) "mı" else "mi") else if (back) "da" else "de"
        return Rendered("$form${clitic.groupValues[1]}$particle", clitic.value.length)
    }

    private data class Rendered(val text: String, val consumed: Int)

    private fun renderEn(party: Party, suffix: String?, apos: String, before: String, after: String): Rendered? {
        var possessive = false
        if (suffix != null) {
            if (suffix == "s") {
                possessive = true
            } else {
                val c = classifyTr(suffix) ?: return null
                // A Turkish suffix left in English text: a genitive reads as "'s",
                // any other case is dropped (as the translation backstop does).
                possessive = c == TrCase.GEN || c == TrCase.GENKI
            }
        }
        if (!party.self) {
            return Rendered(if (possessive) "${party.name}${apos.ifEmpty { "'" }}s" else party.name, 0)
        }
        val r = (if (possessive) Rendered("your", 0) else enSelf(before, after)) ?: return null
        return if (atSentenceStart(before)) r.copy(text = capitalize(r.text, AppLang.EN)) else r
    }

    private fun renderTr(party: Party, suffix: String?, apos: String, before: String, after: String): Rendered? {
        val trCase: TrCase? = when (suffix) {
            null -> null
            "s" -> TrCase.GEN
            else -> classifyTr(suffix) ?: return null
        }
        if (!party.self) {
            if (trCase == null) return Rendered(party.name, 0)
            val tail = trSuffix(party.name, trCase) ?: return null
            return Rendered("${party.name}${apos.ifEmpty { "'" }}$tail", 0)
        }
        val r = trSelf(trCase, after) ?: return null
        return if (atSentenceStart(before)) r.copy(text = capitalize(r.text, AppLang.TR)) else r
    }

    /**
     * Put real names back into verdict text written with labels. `textLang`
     * is the language the text is written in. A narrator becomes "you"/"sen"
     * only where that stays grammatical; any label that cannot be rendered
     * with confidence is left as written.
     */
    fun restoreNames(text: String, parties: Map<String, Party>, textLang: AppLang): String {
        if (text.isEmpty() || parties.isEmpty()) return text
        val out = StringBuilder()
        var pos = 0
        var from = 0
        while (true) {
            val m = LABEL_IN_TEXT.find(text, from) ?: break
            from = m.range.last + 1
            val whole = m.value
            val word = m.groupValues[1]
            val letter = m.groupValues[2]
            val apos = m.groupValues[3]
            val suffix = m.groups[4]?.value
            val isParty = word == "Party" || word == "Taraf"
            if (isParty != (letter == "A" || letter == "B")) continue
            val party = parties[letter] ?: continue
            val start = m.range.first
            val before = text.substring(0, start)
            val after = text.substring(start + whole.length)
            val r = (
                if (textLang == AppLang.TR) renderTr(party, suffix, apos, before, after)
                else renderEn(party, suffix, apos, before, after)
                ) ?: continue
            out.append(text, pos, start).append(r.text)
            pos = start + whole.length + r.consumed
            from = pos
        }
        return out.append(text, pos, text.length).toString()
    }

    /**
     * The verdict with real names in its free text, for the author's own
     * view only. `selfLang` is the language the argument was judged in
     * (narrator detection); the grammar follows the language the text is
     * written in, which differs once the verdict has been translated.
     * Returns the same object when there is nothing to restore.
     */
    fun personalizeResult(result: VerdictResult, nameMap: List<NameMapping>?, selfLang: AppLang): VerdictResult {
        val parties = PartyNames.resolveParties(nameMap, selfLang)
        if (parties.isEmpty()) return result
        val lang = ContentLang.verdictLang(result)
        val r = { s: String -> restoreNames(s, parties, lang) }
        val map = result.argumentMap
        return result.copy(
            headline = r(result.headline),
            crux = r(result.crux),
            losingSideBestPoint = r(result.losingSideBestPoint),
            splitPoints = result.splitPoints?.map { it.copy(point = r(it.point)) },
            conditional = result.conditional?.map { it.copy(ifValue = r(it.ifValue), then = r(it.then)) },
            argumentMap = map.copy(
                sideA = map.sideA.map { it.copy(claim = r(it.claim)) },
                sideB = map.sideB.map { it.copy(claim = r(it.claim)) },
                bedrockA = r(map.bedrockA),
                bedrockB = r(map.bedrockB),
            ),
            factsReliedOn = result.factsReliedOn.map(r),
            lean = result.lean?.let { it.copy(reason = r(it.reason)) },
            cruxTrial = result.cruxTrial?.let { it.copy(attack = r(it.attack), reasoning = r(it.reasoning)) },
            factCheck = result.factCheck?.let { fc ->
                fc.copy(claims = fc.claims.map { it.copy(claim = r(it.claim), summary = r(it.summary)) })
            },
        )
    }

    /** Just the headline of [personalizeResult], for list rows. */
    fun headline(result: VerdictResult, nameMap: List<NameMapping>?, selfLang: AppLang): String {
        val parties = PartyNames.resolveParties(nameMap, selfLang)
        if (parties.isEmpty()) return result.headline
        return restoreNames(result.headline, parties, ContentLang.verdictLang(result))
    }
}
