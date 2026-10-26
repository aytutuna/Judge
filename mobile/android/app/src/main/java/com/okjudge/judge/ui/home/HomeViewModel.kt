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
import com.okjudge.judge.core.display.Preset
import com.okjudge.judge.core.display.UiError
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
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

/** Max screenshots on one side (MAX_EVIDENCE_PER_SIDE). */
const val MAX_EVIDENCE_PER_SIDE = 3

data class HomeUiState(
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
    /** "Just me" (a verdict now) or "Both sides" (a two-sided case with an invite link). */
    val caseMode: CaseMode = CaseMode.NOW,
    /** The owner's name for the case's share pages as typed; null until they type. */
    val typedName: String? = null,
    /** The account's first name, prefilled until the owner types. */
    val suggestedName: String? = null,
    /** A two-sided case is being created. */
    val creating: Boolean = false,
    /** Saved verdicts, newest first, for the "Recent" row. */
    val recent: List<SavedVerdict> = emptyList(),
) {
    val casesOn: Boolean get() = signedIn && features.cases
    val twoSided: Boolean get() = casesOn && caseMode == CaseMode.BOTH
    val shownName: String get() = typedName ?: suggestedName ?: ""

    /** The effective tier: premium only while it can be used and was chosen. */
    val tier: Tier get() = Tiers.effective(availability, tierChoice)
    val premium: Boolean get() = tier == Tier.PREMIUM
    val evidenceOn: Boolean get() = premium && features.evidence

    /** A premium request is being prepared: the form and the switch hold still. */
    val holding: Boolean get() = checking || creating

    /** Nothing typed or attached: the "+" has nothing to clear here. */
    val blank: Boolean get() = argument.isEmpty() && evidence.items.isEmpty()

    val canSubmit: Boolean
        get() = ArgumentRules.canSubmit(argument) && !holding && !(evidenceOn && evidence.busy)
}

/** What a submit started. */
enum class Submitted { NOTHING, JUDGING, CHECKING, CREATING }

enum class CaseMode { NOW, BOTH }

/**
 * The argument form. The draft survives rotation and process death through
 * [SavedStateHandle]; the request itself runs in [VerdictFlow]. The tier
 * switch reads the server config and the account; screenshots are held by
 * an [EvidenceController] for as long as the form lives.
 */
class HomeViewModel(
    private val saved: SavedStateHandle,
    private val settings: SettingsStore,
    private val flow: VerdictFlow,
    accountState: Flow<Account.State> = flowOf(Account.State.SignedOut),
    providers: Flow<Account.Providers> = flowOf(Account.Providers.Loading),
    uploadEvidence: suspend (List<PreparedImage>) -> ApiResult<EvidenceUploadResponse> = { ApiResult.Err(UiError.Unknown) },
    recent: Flow<List<SavedVerdict>> = flowOf(emptyList()),
) : ViewModel() {

    val evidence = EvidenceController(viewModelScope, MAX_EVIDENCE_PER_SIDE, uploadEvidence)

    private val form = combine(
        saved.getStateFlow(KEY_ARGUMENT, ""),
        settings.lastPreset,
        flow.lastError,
        flow.blockedUntil,
    ) { argument, preset, error, blocked -> HomeUiState(argument, preset, error, blocked) }

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
        saved.getStateFlow(KEY_MODE, CaseMode.NOW.name),
        saved.getStateFlow<String?>(KEY_NAME, null),
        flow.creating,
        accountState,
    ) { mode, name, creating, account ->
        val user = (account as? Account.State.SignedIn)?.me?.user
        CasePart(
            mode = runCatching { CaseMode.valueOf(mode) }.getOrDefault(CaseMode.NOW),
            typedName = name,
            suggestedName = CaseLogic.firstNameOf(user?.name),
            creating = creating,
        )
    }

    private data class CasePart(val mode: CaseMode, val typedName: String?, val suggestedName: String?, val creating: Boolean)

    val state: StateFlow<HomeUiState> = combine(form, premium, casePart, recent) { f, p, c, saved ->
        f.copy(
            recent = saved,
            caseMode = c.mode,
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
    }.stateIn(viewModelScope, SharingStarted.Eagerly, HomeUiState(argument = saved[KEY_ARGUMENT] ?: ""))

    fun onArgumentChange(text: String) {
        saved[KEY_ARGUMENT] = text.take(ArgumentRules.MAX)
    }

    fun onExample(text: String) = onArgumentChange(text)

    fun onPreset(preset: Preset) {
        viewModelScope.launch { settings.setLastPreset(preset) }
    }

    /** A tier picked on the switch (a locked Premium remembers the intent: see onPremiumIntent). */
    fun onTier(tier: Tier) {
        viewModelScope.launch { settings.setTierChoice(tier) }
    }

    fun onCaseMode(mode: CaseMode) {
        saved[KEY_MODE] = mode.name
    }

    fun onDisplayName(name: String) {
        saved[KEY_NAME] = name.take(CaseLogic.MAX_DISPLAY_NAME)
    }

    fun onAddEvidence(sources: List<ImageSource>) = evidence.add(sources)

    fun onRemoveEvidence(id: String) = evidence.remove(id)

    /** Starts a verdict: the free request, or premium's clarify step. */
    fun submit(lang: AppLang, now: Long = System.currentTimeMillis()): Submitted {
        val s = state.value
        if (!s.canSubmit) return Submitted.NOTHING
        if ((s.blockedUntil ?: 0) > now) return Submitted.NOTHING
        val tokens = if (s.evidenceOn) s.evidence.tokens else emptyList()
        return if (s.twoSided) {
            if (flow.createCase(s.argument, s.preset, lang, s.tier, tokens, s.shownName)) Submitted.CREATING else Submitted.NOTHING
        } else if (s.premium) {
            if (flow.startPremium(s.argument, s.preset, lang, tokens)) Submitted.CHECKING else Submitted.NOTHING
        } else {
            if (flow.start(s.argument, s.preset, lang)) Submitted.JUDGING else Submitted.NOTHING
        }
    }

    fun dismissError() = flow.dismissError()

    /** "Judge another": back to an empty form. */
    fun clear() {
        saved[KEY_ARGUMENT] = ""
        evidence.clear()
        flow.dismissError()
    }

    private companion object {
        const val KEY_ARGUMENT = "argument"
        const val KEY_MODE = "case_mode"
        const val KEY_NAME = "case_name"
    }
}
