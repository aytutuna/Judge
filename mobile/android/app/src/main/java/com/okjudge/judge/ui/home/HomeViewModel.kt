package com.okjudge.judge.ui.home

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.okjudge.judge.core.api.ApiResult
import com.okjudge.judge.core.auth.Account
import com.okjudge.judge.core.cases.CaseLogic
import com.okjudge.judge.core.data.SavedVerdict
import com.okjudge.judge.core.data.SettingsStore
import com.okjudge.judge.core.display.ArgumentRules
import com.okjudge.judge.core.display.Examples
import com.okjudge.judge.core.display.Preset
import com.okjudge.judge.core.display.UiError
import com.okjudge.judge.core.display.jsTrim
import com.okjudge.judge.core.evidence.EvidenceController
import com.okjudge.judge.core.evidence.EvidenceState
import com.okjudge.judge.core.evidence.ImageSource
import com.okjudge.judge.core.evidence.PreparedImage
import com.okjudge.judge.core.model.Entitlement
import com.okjudge.judge.core.model.EvidenceUploadResponse
import com.okjudge.judge.core.model.Features
import com.okjudge.judge.core.premium.Tier
import com.okjudge.judge.core.premium.TierAvailability
import com.okjudge.judge.core.premium.Tiers
import com.okjudge.judge.core.session.VerdictFlow
import com.okjudge.judge.i18n.AppLang
import com.okjudge.judge.i18n.Strings
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlin.random.Random

/** Max screenshots on one side (MAX_EVIDENCE_PER_SIDE). */
const val MAX_EVIDENCE_PER_SIDE = 3

data class HomeUiState(
    /** Your side. */
    val argument: String = "",
    val preset: Preset = Preset.DEFAULT,
    val error: UiError? = null,
    val blockedUntil: Long? = null,
    /** The remembered Free / Premium choice (a preference only). */
    val tierChoice: Tier = Tier.FREE,
    val availability: TierAvailability = TierAvailability.HIDDEN,
    val entitlement: Entitlement? = null,
    val features: Features = Features(),
    val signedIn: Boolean = false,
    /** Premium is asking whether facts are missing (POST /clarify). */
    val checking: Boolean = false,
    val evidence: EvidenceState = EvidenceState(max = MAX_EVIDENCE_PER_SIDE),
    /** Your name over your card, in the joined text and on a new case's share pages; null until typed. */
    val typedName: String? = null,
    /** The account's first name, prefilled until the owner types. */
    val suggestedName: String? = null,
    /** A two-sided case is being created. */
    val creating: Boolean = false,
    /** Saved verdicts, newest first, for the "Recent" row. */
    val recent: List<SavedVerdict> = emptyList(),
    /** The other side, when the user writes it too; empty sends [argument] alone. */
    val otherSide: String = "",
    /** The name over the other side's card. */
    val otherName: String = "",
) {
    val casesOn: Boolean get() = signedIn && features.cases
    val shownName: String get() = typedName ?: suggestedName ?: ""

    /** The effective tier: premium only while it can be used and was chosen. */
    val tier: Tier get() = Tiers.effective(availability, tierChoice)
    val premium: Boolean get() = tier == Tier.PREMIUM
    val evidenceOn: Boolean get() = premium && features.evidence

    /** A premium request is being prepared: the form and the switch hold still. */
    val holding: Boolean get() = checking || creating

    /** Nothing typed or attached: the "+" has nothing to clear here. */
    val blank: Boolean get() = argument.isEmpty() && otherSide.isEmpty() && evidence.items.isEmpty()

    /** Enough written and nothing running; [fits] checks the length of what is sent. */
    val canSubmit: Boolean
        get() = argument.jsTrim().length + otherSide.jsTrim().length >= ArgumentRules.MIN &&
            !holding && !(evidenceOn && evidence.busy)

    /** "Or send them a link": only your side goes into the case, so theirs must be empty. */
    val canSendLink: Boolean
        get() = casesOn && otherSide.isBlank() && ArgumentRules.canSubmit(argument) && !holding && !(evidenceOn && evidence.busy)

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

/** What a submit started. */
enum class Submitted { NOTHING, JUDGING, CHECKING, CREATING }

/**
 * The argument form: your side, and theirs when you know it. The draft
 * survives rotation and process death through [SavedStateHandle]; the
 * request itself runs in [VerdictFlow]. The tier switch reads the server
 * config and the account; screenshots are held by an [EvidenceController]
 * for as long as the form lives.
 */
class HomeViewModel(
    private val saved: SavedStateHandle,
    private val settings: SettingsStore,
    private val flow: VerdictFlow,
    accountState: Flow<Account.State> = flowOf(Account.State.SignedOut),
    providers: Flow<Account.Providers> = flowOf(Account.Providers.Loading),
    uploadEvidence: suspend (List<PreparedImage>) -> ApiResult<EvidenceUploadResponse> = { ApiResult.Err(UiError.Unknown) },
    recent: Flow<List<SavedVerdict>> = flowOf(emptyList()),
    private val random: Random = Random.Default,
) : ViewModel() {

    val evidence = EvidenceController(viewModelScope, MAX_EVIDENCE_PER_SIDE, uploadEvidence)

    private val written = combine(
        saved.getStateFlow(KEY_ARGUMENT, ""),
        saved.getStateFlow(KEY_OTHER, ""),
        saved.getStateFlow(KEY_OTHER_NAME, ""),
    ) { mine, theirs, name -> Triple(mine, theirs, name) }

    private val form = combine(
        written,
        settings.lastPreset,
        flow.lastError,
        flow.blockedUntil,
    ) { (argument, other, otherName), preset, error, blocked ->
        HomeUiState(argument, preset, error, blocked, otherSide = other, otherName = otherName)
    }

    private val premium = combine(settings.tierChoice, accountState, providers, flow.premiumStep, evidence.state) {
            choice, account, prov, step, ev ->
        val config = (prov as? Account.Providers.Ready)?.config
        val signedIn = account is Account.State.SignedIn
        val entitlement = (account as? Account.State.SignedIn)?.me?.entitlement
        PremiumPart(
            choice = choice,
            availability = Tiers.availability(config, signedIn, entitlement),
            entitlement = entitlement,
            features = config?.features ?: Features(),
            signedIn = signedIn,
            checking = step == VerdictFlow.PremiumStep.Checking,
            evidence = ev,
        )
    }

    private data class PremiumPart(
        val choice: Tier,
        val availability: TierAvailability,
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

    val state: StateFlow<HomeUiState> = combine(form, premium, casePart, recent) { f, p, c, saved ->
        f.copy(
            recent = saved,
            typedName = c.typedName,
            suggestedName = c.suggestedName,
            creating = c.creating,
            tierChoice = p.choice,
            availability = p.availability,
            entitlement = p.entitlement,
            features = p.features,
            signedIn = p.signedIn,
            checking = p.checking,
            evidence = p.evidence,
        )
    }.stateIn(
        viewModelScope,
        SharingStarted.Eagerly,
        HomeUiState(argument = saved[KEY_ARGUMENT] ?: "", otherSide = saved[KEY_OTHER] ?: "", otherName = saved[KEY_OTHER_NAME] ?: ""),
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

    fun onPreset(preset: Preset) {
        viewModelScope.launch { settings.setLastPreset(preset) }
    }

    /** A tier picked on the switch (a locked Premium remembers the intent: see onPremiumIntent). */
    fun onTier(tier: Tier) {
        viewModelScope.launch { settings.setTierChoice(tier) }
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
        saved[KEY_OTHER_NAME] = example.theirName
        saved[KEY_OTHER] = example.theirs
    }

    fun onAddEvidence(sources: List<ImageSource>) = evidence.add(sources)

    fun onRemoveEvidence(id: String) = evidence.remove(id)

    /**
     * Starts a verdict on what was written, joined in the words of [strings]
     * when both sides are: the free request, or premium's clarify step.
     */
    fun submit(lang: AppLang, strings: Strings, now: Long = System.currentTimeMillis()): Submitted {
        val s = state.value
        if (!s.canSubmit || !s.fits(strings)) return Submitted.NOTHING
        if ((s.blockedUntil ?: 0) > now) return Submitted.NOTHING
        val text = s.outgoing(strings)
        return if (s.premium) {
            val tokens = if (s.evidenceOn) s.evidence.tokens else emptyList()
            if (flow.startPremium(text, s.preset, lang, tokens, s.sides)) Submitted.CHECKING else Submitted.NOTHING
        } else {
            if (flow.start(text, s.preset, lang, s.sides)) Submitted.JUDGING else Submitted.NOTHING
        }
    }

    /** "Or send them a link to write it": a two-sided case with your side; the other person writes theirs. */
    fun sendLink(lang: AppLang, now: Long = System.currentTimeMillis()): Submitted {
        val s = state.value
        if (!s.canSendLink || (s.blockedUntil ?: 0) > now) return Submitted.NOTHING
        val tokens = if (s.evidenceOn) s.evidence.tokens else emptyList()
        val started = flow.createCase(s.argument, s.preset, lang, s.tier, tokens, s.shownName, s.otherName)
        return if (started) Submitted.CREATING else Submitted.NOTHING
    }

    fun dismissError() = flow.dismissError()

    /** "Judge another": back to an empty form. */
    fun clear() {
        saved[KEY_ARGUMENT] = ""
        saved[KEY_OTHER] = ""
        saved[KEY_OTHER_NAME] = ""
        // A name the example wrote is not the user's: the account's first name comes back.
        if (saved.get<Boolean>(KEY_EXAMPLE_NAME) == true) {
            saved[KEY_NAME] = null
            saved[KEY_EXAMPLE_NAME] = false
        }
        evidence.clear()
        flow.dismissError()
    }

    private companion object {
        const val KEY_ARGUMENT = "argument"
        const val KEY_OTHER = "other_side"
        const val KEY_OTHER_NAME = "other_name"
        const val KEY_NAME = "case_name"
        const val KEY_EXAMPLE = "example"
        const val KEY_EXAMPLE_NAME = "example_name"
    }
}
