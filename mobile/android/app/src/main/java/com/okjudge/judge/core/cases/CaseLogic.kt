package com.okjudge.judge.core.cases

import android.content.Context
import com.okjudge.judge.core.display.PartyNames
import com.okjudge.judge.core.model.CaseView
import com.okjudge.judge.core.model.NameMapping
import com.okjudge.judge.core.model.WireJson
import com.okjudge.judge.i18n.AppLang
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow

/**
 * The owner's real names for each case, kept on this phone only
 * (lib/case-names-store.ts): the server's encrypted copy (`case.names`)
 * wins when there is one.
 */
interface CaseNamesStore {
    fun get(caseId: String): List<NameMapping>
    fun save(caseId: String, names: List<NameMapping>)
    fun forget(caseId: String)
}

class MemoryCaseNames : CaseNamesStore {
    private val map = HashMap<String, List<NameMapping>>()

    @Synchronized override fun get(caseId: String): List<NameMapping> = map[caseId].orEmpty()

    @Synchronized override fun save(caseId: String, names: List<NameMapping>) {
        if (names.isEmpty()) return
        map[caseId] = CaseLogic.mergeNameMaps(map[caseId].orEmpty(), names)
    }

    @Synchronized override fun forget(caseId: String) {
        map.remove(caseId)
    }
}

/** Private app storage, excluded from backups like the verdict history. */
class PrefsCaseNames(context: Context) : CaseNamesStore {
    private val prefs = context.applicationContext.getSharedPreferences("case_names", Context.MODE_PRIVATE)

    private fun key(caseId: String) = "a:$caseId"

    @Synchronized override fun get(caseId: String): List<NameMapping> = WireJson.decodeNameMap(prefs.getString(key(caseId), null))

    @Synchronized override fun save(caseId: String, names: List<NameMapping>) {
        if (names.isEmpty()) return
        val merged = CaseLogic.mergeNameMaps(get(caseId), names)
        prefs.edit().putString(key(caseId), WireJson.encodeNameMap(merged)).apply()
    }

    @Synchronized override fun forget(caseId: String) {
        prefs.edit().remove(key(caseId)).apply()
    }
}

/** What the appeal area shows for a case view (appealArea in components/case/AppealForm.tsx). */
sealed interface AppealArea {
    data object None : AppealArea
    data object Judging : AppealArea
    /** [failed]: "failed" or "refused" when the viewer's last appeal did not go through. */
    data class Form(val failed: String?) : AppealArea
    data class Upsell(val signIn: Boolean) : AppealArea
    data class Blocked(val reason: String) : AppealArea
    data object Used : AppealArea
    data object Busy : AppealArea
}

/** Pure case helpers ported from the web. */
object CaseLogic {
    const val MIN_APPEAL_CHARS = 20
    const val MAX_APPEAL_CHARS = 2000
    const val MAX_EVIDENCE_PER_APPEAL = 1
    const val MAX_DISPLAY_NAME = 40

    /** Longest wait between polls after repeated failures (MAX_POLL_BACKOFF_MS). */
    const val MAX_POLL_BACKOFF_MS = 30_000L

    /** Milliseconds until the next poll, or null for none (nextPollDelay in lib/use-case.ts). */
    fun nextPollDelay(view: CaseView?, failures: Int): Long? {
        val after = view?.pollAfterMs ?: return null
        val base = max(1000L, after)
        if (failures <= 0) return base
        return min(MAX_POLL_BACKOFF_MS, (base * 2.0.pow(min(failures, 5))).toLong())
    }

    fun appealArea(view: CaseView): AppealArea {
        if (view.statusRaw != "judged") return AppealArea.None
        val mine = view.appeals.firstOrNull { it.party == view.yourParty }
        if (view.appealJudging) return if (mine?.status == "judging") AppealArea.Judging else AppealArea.Busy
        if (view.appeal.allowed) {
            val failed = if (mine?.status == "failed") (if (mine.error == "refused") "refused" else "failed") else null
            return AppealArea.Form(failed)
        }
        return when (val by = view.appeal.blockedBy) {
            "signin_required" -> AppealArea.Upsell(signIn = true)
            "premium_required", "no_credits", "fair_use" ->
                if (view.role == "respondent") AppealArea.Upsell(signIn = false) else AppealArea.Blocked(by)
            "appeal_used" -> AppealArea.Used
            "busy" -> AppealArea.Busy
            else -> AppealArea.None
        }
    }

    /** Union of two name maps, first occurrence wins (mergeNameMaps). */
    fun mergeNameMaps(prev: List<NameMapping>, next: List<NameMapping>): List<NameMapping> {
        val seen = HashSet<Pair<String, String>>()
        val out = ArrayList<NameMapping>()
        for (m in prev + next) {
            if (m.original.isEmpty() || m.replacement.isEmpty()) continue
            if (!seen.add(m.original to m.replacement)) continue
            out += m
            if (out.size >= MAX_NAME_ENTRIES) break
        }
        return out
    }

    private const val MAX_NAME_ENTRIES = 64

    private val EN_SELF = Regex("^(i|me|my|mine|myself)$", RegexOption.IGNORE_CASE)
    private val FIRST_NAME = Regex("^\\p{Lu}[\\p{L}'’-]{1,39}$")

    /** A first-name suggestion for the owner's display name (firstNameOf), or null. */
    fun firstNameOf(name: String?): String? {
        if (name.isNullOrBlank()) return null
        val first = PartyNames.bareName(name).trim().split(Regex("\\s+")).firstOrNull().orEmpty()
        if (EN_SELF.matches(first)) return null
        return first.takeIf { FIRST_NAME.matches(it) }
    }

    // --- Labels in anonymized text (localizeLabels / textLang in lib/names.ts) ---------

    private val ANY_LABEL = Regex("(?<![\\p{L}\\p{N}])(Party|Taraf|Person|Kişi) ([A-Z])(?![\\p{L}\\p{N}])")
    private val TR_LABEL = Regex("(?<![\\p{L}])(?:Taraf [AB]|Kişi [C-Z])(?![\\p{L}])")
    private val TR_WORDS = Regex(
        "(?<![\\p{L}])(?:ve|bir|bu|ama|için|çok|değil|gibi|ile|diye|sonra|çünkü|hiç|daha|kadar|ediyor|dedi|oldu)(?![\\p{L}])",
        setOf(RegexOption.IGNORE_CASE),
    )
    private val EN_WORDS = Regex(
        "(?<![\\p{L}])(?:the|and|is|was|that|with|for|said|says|this|they|because|would|have)(?![\\p{L}])",
        setOf(RegexOption.IGNORE_CASE),
    )
    private val TR_LETTERS = Regex("[ğıİşĞŞ]")

    /** The language an anonymized text is written in (textLang). */
    fun textLang(text: String): AppLang {
        if (TR_LABEL.containsMatchIn(text)) return AppLang.TR
        val tr = TR_WORDS.findAll(text).count()
        val en = EN_WORDS.findAll(text).count()
        if (tr != en) return if (tr > en) AppLang.TR else AppLang.EN
        return if (TR_LETTERS.containsMatchIn(text)) AppLang.TR else AppLang.EN
    }

    /** "Party A" <-> "Taraf A", "Person C" <-> "Kişi C" in the words of [lang] (localizeLabels). */
    fun localizeLabels(text: String, lang: AppLang): String {
        if (text.isEmpty()) return text
        return ANY_LABEL.replace(text) { m ->
            val word = m.groupValues[1]
            val letter = m.groupValues[2]
            val party = word == "Party" || word == "Taraf"
            if (party != (letter == "A" || letter == "B")) return@replace m.value
            if (lang == AppLang.TR) "${if (party) "Taraf" else "Kişi"} $letter" else "${if (party) "Party" else "Person"} $letter"
        }
    }

    /** localizeLabels by the text's own language. */
    fun localizeLabelsAuto(text: String): String = localizeLabels(text, textLang(text))
}
