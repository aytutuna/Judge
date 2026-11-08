package com.okjudge.judge.ui.home

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.okjudge.judge.core.api.ApiResult
import com.okjudge.judge.core.auth.Account
import com.okjudge.judge.core.cases.CaseLogic
import com.okjudge.judge.core.display.ArgumentRules
import com.okjudge.judge.core.display.Examples
import com.okjudge.judge.core.display.UiError
import com.okjudge.judge.core.display.jsTrim
import com.okjudge.judge.core.evidence.EvidenceController
import com.okjudge.judge.core.evidence.EvidenceState
import com.okjudge.judge.core.evidence.ImageSource
import com.okjudge.judge.core.evidence.PreparedImage
import com.okjudge.judge.core.model.Entitlement
import com.okjudge.judge.core.model.EvidenceUploadResponse
import com.okjudge.judge.core.model.Features
import com.okjudge.judge.core.premium.Tiers
import com.okjudge.judge.core.session.VerdictFlow
import com.okjudge.judge.i18n.AppLang
import com.okjudge.judge.i18n.Strings
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.stateIn
import kotlin.random.Random

/** Max screenshots on one side (MAX_EVIDENCE_PER_SIDE). */
const val MAX_EVIDENCE_PER_SIDE = 3

data class HomeUiState(
    /** Your side. */
    val argument: String = "",
    val error: UiError? = null,
    val blockedUntil: Long? = null,
    val entitlement: Entitlement? = null,
    val features: Features = Features(),
    val signedIn: Boolean = false,
    /** Asking whether facts are missing (POST /clarify). */
    val checking: Boolean = false,
    val evidence: EvidenceState = EvidenceState(max = MAX_EVIDENCE_PER_SIDE),
    /** Your name over your card, in the joined text and on a new case's share pages; null until typed. */
    val typedName: String? = null,
    /** The account's first name, prefilled until the owner types. */
    val suggestedName: String? = null,
    /** A two-sided case is being created. */
    val creating: Boolean = false,
    /** The other side, when the user writes it too; empty sends [argument] alone. */
    val otherSide: String = "",
    /** The name over the other side's card. */
    val otherName: String = "",
    /** The second card is on Home: one person writes in one box until then. */
    val theirsOpen: Boolean = false,
    /** What the last example wrote ([exampleMark]), to tell it from the user's own text. */
    val exampleText: String? = null,
) {
    val casesOn: Boolean get() = features.cases
    val shownName: String get() = typedName ?: suggestedName ?: ""
    val evidenceOn: Boolean get() = signedIn && features.evidence

    /** "Add context" is drawn whenever the deployment offers it; signed out, a tap goes to sign-in. */
    val evidenceOffered: Boolean get() = features.evidence

    /** Signed in with nothing left to spend; unknown while the account loads, so the server decides then. */
    val outOfUnits: Boolean get() = signedIn && entitlement != null && Tiers.remaining(entitlement) == null

    /** A request is being prepared: the form holds still. */
    val holding: Boolean get() = checking || creating

    /** Nothing typed, attached or opened: Home has nothing to clear. */
    val blank: Boolean get() = argument.isEmpty() && otherSide.isEmpty() && evidence.items.isEmpty() && !theirsOpen

    /** An example writes over the form, so it never replaces the user's text. */
    val offersExample: Boolean get() = blank || exampleText == exampleMark(argument, shownName, otherSide, otherName)

    /** Enough written and nothing running; [fits] checks the length of what is sent. */
    val canSubmit: Boolean
        get() = argument.jsTrim().length + otherSide.jsTrim().length >= ArgumentRules.MIN &&
            !holding && !(evidenceOn && evidence.busy)

    /**
     * "Send them a link": from the start, with nothing written, or with your
     * side written as for a verdict. Context images only go with a written side.
     */
    val canSendLink: Boolean
        get() = casesOn && !theirsOpen && !holding && !(evidenceOn && evidence.busy) &&
            if (argument.jsTrim().isEmpty()) !evidenceOn || evidence.items.isEmpty() else ArgumentRules.canSubmit(argument)

    /** What the judges read: your side as written, or both sides joined with a name in front of each. */
    fun outgoing(s: Strings): String = joined(argument, otherSide, shownName, otherName, s)

    fun fits(s: Strings): Boolean = outgoing(s).length <= ArgumentRules.MAX

    /** The written sides, yours first, for the judging screen. */
    val sides: List<VerdictFlow.Side>
        get() = listOf(
            VerdictFlow.Side(mine = true, name = shownName.trim(), text = argument.trim()),
            VerdictFlow.Side(mine = false, name = otherName.trim(), text = otherSide.trim()),
        ).filter { it.text.isNotEmpty() }

    companion object {
        /** Both sides and both names in one value, so an edit to any of them shows. */
        fun exampleMark(mine: String, myName: String, theirs: String, theirName: String): String =
            listOf(mine, myName, theirs, theirName).joinToString("\u0000")

        fun joined(mine: String, theirs: String, myName: String, theirName: String, s: Strings): String {
            val other = theirs.trim()
            if (other.isEmpty()) return mine
            fun part(text: String, name: String, unnamed: String): String {
                val n = name.trim()
                return (if (n.isEmpty()) unnamed else s.appHomeSays(n)) + " " + text
            }
            return buildList {
                if (mine.isNotBlank()) add(part(mine.trim(), myName, s.appHomeMySide))
                add(part(other, theirName, s.appHomeOtherSide))
            }.joinToString("\n\n")
        }
    }
}

/** What a submit started, or the screen it needs first. */
enum class Submitted { NOTHING, CHECKING, CREATING, SIGN_IN, PRICING }

/**
 * The argument form: your side, and theirs when you know it. The draft
 * survives rotation and process death through [SavedStateHandle]; the
 * request itself runs in [VerdictFlow]. The balance comes from the account
 * and the extras on offer from the server config; screenshots are held by
 * an [EvidenceController] for as long as the form lives.
 */
class HomeViewModel(
    private val saved: SavedStateHandle,
    private val flow: VerdictFlow,
    accountState: Flow<Account.State> = flowOf(Account.State.SignedOut),
    providers: Flow<Account.Providers> = flowOf(Account.Providers.Loading),
    uploadEvidence: suspend (List<PreparedImage>) -> ApiResult<EvidenceUploadResponse> = { ApiResult.Err(UiError.Unknown) },
    private val random: Random = Random.Default,
) : ViewModel() {

    val evidence = EvidenceController(viewModelScope, MAX_EVIDENCE_PER_SIDE, uploadEvidence)

    init {
        // Refused tokens would fail the same way on every retry.
        viewModelScope.launch {
            flow.lastError.collect { if ((it as? UiError.Api)?.code == "evidence_invalid") evidence.invalidateTokens() }
        }
        // A restored draft with their side written needs the card that shows it.
        if (!saved.get<String>(KEY_OTHER).isNullOrEmpty()) saved[KEY_THEIRS_OPEN] = true
    }

    private val written = combine(
        saved.getStateFlow(KEY_ARGUMENT, ""),
        saved.getStateFlow(KEY_OTHER, ""),
        saved.getStateFlow(KEY_OTHER_NAME, ""),
    ) { mine, theirs, name -> Triple(mine, theirs, name) }

    private val cardState = combine(
        saved.getStateFlow(KEY_THEIRS_OPEN, false),
        saved.getStateFlow<String?>(KEY_EXAMPLE_TEXT, null),
    ) { open, example -> open to example }

    private val form = combine(
        written,
        cardState,
        flow.lastError,
        flow.blockedUntil,
    ) { (argument, other, otherName), (open, example), error, blocked ->
        HomeUiState(argument, error, blocked, otherSide = other, otherName = otherName, theirsOpen = open, exampleText = example)
    }

    private val premium = combine(accountState, providers, flow.premiumStep, evidence.state) { account, prov, step, ev ->
        val config = (prov as? Account.Providers.Ready)?.config
        PremiumPart(
            entitlement = (account as? Account.State.SignedIn)?.me?.entitlement,
            features = config?.features ?: Features(),
            signedIn = account is Account.State.SignedIn,
            checking = step == VerdictFlow.PremiumStep.Checking,
            evidence = ev,
        )
    }

    private data class PremiumPart(
        val entitlement: Entitlement?,
        val features: Features,
        val signedIn: Boolean,
        val checking: Boolean,
        val evidence: EvidenceState,
    )

    private val casePart = combine(
        saved.getStateFlow<String?>(KEY_NAME, null),
        flow.creating,
        accountState,
    ) { name, creating, account ->
        val user = (account as? Account.State.SignedIn)?.me?.user
        CasePart(
            typedName = name,
            suggestedName = CaseLogic.firstNameOf(user?.name),
            creating = creating,
        )
    }

    private data class CasePart(val typedName: String?, val suggestedName: String?, val creating: Boolean)

    val state: StateFlow<HomeUiState> = combine(form, premium, casePart) { f, p, c ->
        f.copy(
            typedName = c.typedName,
            suggestedName = c.suggestedName,
            creating = c.creating,
            entitlement = p.entitlement,
            features = p.features,
            signedIn = p.signedIn,
            checking = p.checking,
            evidence = p.evidence,
        )
    }.stateIn(
        viewModelScope,
        SharingStarted.Eagerly,
        HomeUiState(
            argument = saved[KEY_ARGUMENT] ?: "",
            otherSide = saved[KEY_OTHER] ?: "",
            otherName = saved[KEY_OTHER_NAME] ?: "",
            theirsOpen = saved[KEY_THEIRS_OPEN] ?: false,
            exampleText = saved[KEY_EXAMPLE_TEXT],
        ),
    )

    fun onArgumentChange(text: String) {
        saved[KEY_ARGUMENT] = text.take(ArgumentRules.MAX)
    }

    fun onOtherSideChange(text: String) {
        saved[KEY_OTHER] = text.take(ArgumentRules.MAX)
    }

    fun onOtherName(name: String) {
        saved[KEY_OTHER_NAME] = name.take(CaseLogic.MAX_DISPLAY_NAME)
    }

    fun onDisplayName(name: String) {
        saved[KEY_NAME] = name.take(CaseLogic.MAX_DISPLAY_NAME)
        saved[KEY_EXAMPLE_NAME] = false
    }

    /** "Try an example": both names and both sides, in the words of [strings], over whatever was typed. */
    fun fillExample(strings: Strings) {
        if (state.value.holding) return
        val id = Examples.pick(saved[KEY_EXAMPLE], random)
        val example = Examples.of(id, strings)
        saved[KEY_EXAMPLE] = id
        saved[KEY_NAME] = example.myName
        saved[KEY_EXAMPLE_NAME] = true
        saved[KEY_ARGUMENT] = example.mine
        saved[KEY_EXAMPLE_TEXT] = HomeUiState.exampleMark(example.mine, example.myName, example.theirs, example.theirName)
        saved[KEY_THEIRS_OPEN] = true
        saved[KEY_OTHER_NAME] = example.theirName
        saved[KEY_OTHER] = example.theirs
    }

    /** "Add their side": the second card, for writing both sides on one phone. */
    fun addTheirSide() {
        saved[KEY_THEIRS_OPEN] = true
    }

    /** The second card's close button: back to one person writing. */
    fun removeTheirSide() {
        saved[KEY_THEIRS_OPEN] = false
        saved[KEY_OTHER] = ""
        saved[KEY_OTHER_NAME] = ""
        // The example's own name would otherwise go out with a link case.
        dropExampleName()
        saved[KEY_EXAMPLE_TEXT] = null
    }

    private fun dropExampleName() {
        // A name the example wrote is not the user's: the account's first name comes back.
        if (saved.get<Boolean>(KEY_EXAMPLE_NAME) == true) {
            saved[KEY_NAME] = null
            saved[KEY_EXAMPLE_NAME] = false
        }
    }

    fun onAddEvidence(sources: List<ImageSource>) = evidence.add(sources)

    fun onRemoveEvidence(id: String) = evidence.remove(id)

    /**
     * Starts a verdict on what was written, joined in the words of [strings]
     * when both sides are: the clarify step first. Signed out or with nothing
     * left to spend it starts nothing and names the screen to open instead.
     */
    fun submit(lang: AppLang, strings: Strings, now: Long = System.currentTimeMillis()): Submitted {
        val s = state.value
        if (!s.canSubmit || !s.fits(strings)) return Submitted.NOTHING
        if ((s.blockedUntil ?: 0) > now) return Submitted.NOTHING
        if (!s.signedIn) return Submitted.SIGN_IN
        if (s.outOfUnits) return Submitted.PRICING
        val tokens = if (s.evidenceOn) s.evidence.tokens else emptyList()
        return if (flow.startPremium(s.outgoing(strings), lang, tokens, s.sides)) Submitted.CHECKING else Submitted.NOTHING
    }

    /** "Send them a link to write it": a two-sided case, with your side if it is written; the other person writes theirs. */
    fun sendLink(lang: AppLang, now: Long = System.currentTimeMillis()): Submitted {
        val s = state.value
        if (!s.canSendLink || (s.blockedUntil ?: 0) > now) return Submitted.NOTHING
        if (!s.signedIn) return Submitted.SIGN_IN
        if (s.outOfUnits) return Submitted.PRICING
        val tokens = if (s.evidenceOn) s.evidence.tokens else emptyList()
        val started = flow.createCase(s.argument, lang, tokens, s.shownName, s.otherName)
        return if (started) Submitted.CREATING else Submitted.NOTHING
    }

    fun dismissError() = flow.dismissError()

    /** "Clear" and a finished verdict: back to an empty form. */
    fun clear() {
        saved[KEY_ARGUMENT] = ""
        removeTheirSide()
        evidence.clear()
        flow.dismissError()
    }

    private companion object {
        const val KEY_ARGUMENT = "argument"
        const val KEY_OTHER = "other_side"
        const val KEY_OTHER_NAME = "other_name"
        const val KEY_THEIRS_OPEN = "theirs_open"
        const val KEY_EXAMPLE_TEXT = "example_text"
        const val KEY_NAME = "case_name"
        const val KEY_EXAMPLE = "example"
        const val KEY_EXAMPLE_NAME = "example_name"
    }
}
