package com.okjudge.judge.core.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.Transient

/*
 * Wire models for /api/v1 (lib/types.ts). Enum-valued fields are kept as raw
 * strings and read through the typed accessors below, so a value a newer
 * server adds decodes to UNKNOWN instead of failing the whole verdict.
 */

@Serializable
data class NameMapping(val original: String = "", val replacement: String = "")

@Serializable
data class Claim(val claim: String = "", val kind: String = "") {
    val claimKind: ClaimKind get() = ClaimKind.of(kind)
}

@Serializable
data class ArgumentMap(
    @SerialName("side_a") val sideA: List<Claim> = emptyList(),
    @SerialName("side_b") val sideB: List<Claim> = emptyList(),
    @SerialName("bedrock_a") val bedrockA: String = "",
    @SerialName("bedrock_b") val bedrockB: String = "",
)

@Serializable
data class SplitPoint(val party: String = "", val point: String = "")

@Serializable
data class ConditionalBranch(@SerialName("if_value") val ifValue: String = "", val then: String = "")

@Serializable
data class LeanTally(@SerialName("for") val forVotes: Int = 0, val against: Int = 0)

@Serializable
data class Lean(
    val party: String = "a",
    val unanimous: Boolean = false,
    val reason: String = "",
    val tally: LeanTally? = null,
)

@Serializable
data class CruxTrial(val attack: String = "", val outcome: String = "", val reasoning: String = "") {
    val trialOutcome: TrialOutcome get() = TrialOutcome.of(outcome)
}

@Serializable
data class FactSource(val title: String = "", val url: String = "")

@Serializable
data class FactClaim(
    val claim: String = "",
    val status: String = "",
    val summary: String = "",
    val sources: List<FactSource> = emptyList(),
)

@Serializable
data class FactCheck(val status: String = "", val claims: List<FactClaim> = emptyList())

@Serializable
data class Panel(val models: List<String> = emptyList())

/**
 * The verdict as shown and stored (VerdictResult in lib/types.ts).
 *
 * `lean` has three states on the wire: absent (no forced ruling), `null`
 * (the judges split even when forced) and an object. kotlinx.serialization
 * folds the first two into `null`, so the decoder records whether the key
 * was present in [leanPresent]; read it through [leanState].
 */
@Serializable
data class VerdictResult(
    val verdict: String = "",
    @SerialName("dispute_type") val disputeType: String = "",
    val headline: String = "",
    val crux: String = "",
    @SerialName("split_points") val splitPoints: List<SplitPoint>? = null,
    val conditional: List<ConditionalBranch>? = null,
    @SerialName("argument_map") val argumentMap: ArgumentMap = ArgumentMap(),
    @SerialName("facts_relied_on") val factsReliedOn: List<String> = emptyList(),
    @SerialName("losing_side_best_point") val losingSideBestPoint: String = "",
    val confidence: Int = 1,
    val runs: List<String> = emptyList(),
    val demo: Boolean = false,
    @SerialName("model_refused") val modelRefused: Boolean? = null,
    @SerialName("crux_trial") val cruxTrial: CruxTrial? = null,
    val lean: Lean? = null,
    val escalated: Boolean? = null,
    val lang: String? = null,
    val tier: String? = null,
    @SerialName("fact_check") val factCheck: FactCheck? = null,
    val panel: Panel? = null,
    @Transient val leanPresent: Boolean = false,
) {
    val finalVerdict: FinalVerdict get() = FinalVerdict.of(verdict)
    val dispute: DisputeType get() = DisputeType.of(disputeType)
    val refused: Boolean get() = modelRefused == true
    val premium: Boolean get() = tier == "premium"

    val leanState: LeanState
        get() = when {
            lean != null -> LeanState.Leans(lean)
            leanPresent -> LeanState.Tie
            else -> LeanState.None
        }
}

sealed interface LeanState {
    data object None : LeanState
    data object Tie : LeanState
    data class Leans(val lean: Lean) : LeanState
}

enum class FinalVerdict(val raw: String) {
    SIDE_A("side_a"), SIDE_B("side_b"), SPLIT("split"), CONDITIONAL("conditional"),
    DISSOLVED("dissolved"), TOO_CLOSE("too_close"), UNKNOWN("");

    companion object {
        fun of(raw: String?): FinalVerdict = entries.firstOrNull { it.raw == raw && it != UNKNOWN } ?: UNKNOWN
    }
}

enum class DisputeType(val raw: String) {
    FACTUAL("factual"), LOGICAL("logical"), DEFINITIONAL("definitional"), VALUES("values"),
    MIXED("mixed"), UNKNOWN("");

    companion object {
        fun of(raw: String?): DisputeType = entries.firstOrNull { it.raw == raw && it != UNKNOWN } ?: UNKNOWN
    }
}

enum class ClaimKind(val raw: String) {
    FACT("fact"), VALUE("value"), DEFINITION("definition"), LOGIC("logic"), UNKNOWN("");

    companion object {
        fun of(raw: String?): ClaimKind = entries.firstOrNull { it.raw == raw && it != UNKNOWN } ?: UNKNOWN
    }
}

enum class TrialOutcome(val raw: String) {
    SURVIVED("survived"), OVERTURNED("overturned"), UNCERTAIN("uncertain"), UNKNOWN("");

    companion object {
        fun of(raw: String?): TrialOutcome = entries.firstOrNull { it.raw == raw && it != UNKNOWN } ?: UNKNOWN
    }
}

// --- Requests -----------------------------------------------------------------

@Serializable
data class FrameworkChoice(val preset: String = "balanced", val sliders: Map<String, Int>? = null)

@Serializable
data class Clarification(val question: String, val answer: String)

/** POST /api/v1/verdict. `tier` and `clarifications` are the premium slots (phase 2). */
@Serializable
data class VerdictRequest(
    val argument: String,
    val framework: FrameworkChoice = FrameworkChoice(),
    val lang: String = "en",
    val tier: String = "free",
    val clarifications: List<Clarification>? = null,
    val turnstileToken: String? = null,
)

/** Error body of every /api/v1 failure. */
@Serializable
data class ApiErrorBody(
    val error: String? = null,
    val code: String? = null,
    val retryAfterSec: Double? = null,
    val resetsAt: String? = null,
)

// --- Decoded responses (domain) -----------------------------------------------

/** A decoded result next to the exact JSON it came from, so history keeps
 * fields a newer server adds. */
data class ParsedResult(val result: VerdictResult, val rawJson: String)

data class VerdictOutcome(
    val id: String,
    val result: ParsedResult,
    val nameMap: List<NameMapping>,
    val replayed: Boolean = false,
    /** Signed-out writers only, returned once with the verdict (or its 202). */
    val ownerToken: String? = null,
)

/**
 * 202 from POST /api/v1/verdict sent with `Prefer: respond-async`
 * (VerdictAcceptedResponse in lib/verdict-poll.ts). The poll answer does not
 * repeat `name_map` or `owner_token`, so they are kept from here.
 */
data class VerdictAccepted(
    val id: String,
    val pollAfterMs: Long,
    val nameMap: List<NameMapping>,
    val ownerToken: String? = null,
    val replayed: Boolean = false,
)

/** What POST /api/v1/verdict answered: the verdict itself (200) or a job to poll (202). */
sealed interface VerdictSubmission {
    data class Done(val outcome: VerdictOutcome) : VerdictSubmission
    data class Accepted(val accepted: VerdictAccepted) : VerdictSubmission
}

/** GET /api/v1/verdicts/{id} for an async verdict (VerdictPollResponse). */
sealed interface VerdictPoll {
    data class Judging(val pollAfterMs: Long?) : VerdictPoll
    data class Failed(val code: String, val error: String?) : VerdictPoll
    data class Ready(val id: String, val result: ParsedResult) : VerdictPoll
}

data class TranslateOutcome(
    val id: String,
    val lang: String,
    val source: String,
    val translated: Boolean,
    val result: ParsedResult,
)

data class StoredVerdict(val id: String, val result: ParsedResult, val createdAt: String)
