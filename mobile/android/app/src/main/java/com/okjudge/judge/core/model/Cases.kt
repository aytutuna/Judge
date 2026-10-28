package com.okjudge.judge.core.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

/*
 * Two-sided cases (lib/case-types.ts). Enum-valued fields stay raw strings,
 * read through the typed accessors, so a value a newer server adds never
 * fails the whole case.
 */

@Serializable
data class CaseEvidenceView(val id: String = "", val kind: String = "", val transcript: String = "")

@Serializable
data class CaseSideView(
    val party: String = "a",
    /** Anonymized, as the judges read it. Empty once that party removed their side. */
    val text: String = "",
    val evidence: List<CaseEvidenceView> = emptyList(),
    val submittedAt: String = "",
    val removed: Boolean = false,
)

@Serializable
data class CaseAppealView(
    val id: String = "",
    val party: String = "a",
    /** judging | judged | failed */
    val status: String = "",
    /** quota | unavailable | refused */
    val error: String? = null,
    val text: String = "",
    val evidence: List<CaseEvidenceView> = emptyList(),
    val outcome: String? = null,
    val verdictId: String? = null,
    val createdAt: String = "",
    val removed: Boolean = false,
)

/** One verdict of a case; [result] is decoded the way verdicts are (lean absent vs null kept). */
@Serializable
data class CaseVerdictView(
    val seq: Int = 0,
    val id: String = "",
    @SerialName("result") val rawResult: JsonObject = JsonObject(emptyMap()),
    val appealId: String? = null,
    val createdAt: String = "",
) {
    val result: VerdictResult by lazy { WireJson.decodeResult(rawResult).result }
}

@Serializable
data class AppealGate(val allowed: Boolean = false, val blockedBy: String? = null)

@Serializable
data class CaseDisplay(val namesVisible: Boolean = false, val a: String? = null, val b: String? = null)

@Serializable
data class CaseRemoved(val at: String = "", val parties: List<String> = emptyList())

enum class CaseStatus(val raw: String, val key: String) {
    AWAITING("awaiting_respondent", "case.status.awaiting"),
    JUDGING("judging", "case.status.judging"),
    JUDGED("judged", "case.status.judged"),
    FAILED("failed", "case.status.failed"),
    EXPIRED("expired", "case.status.expired");

    companion object {
        /** Unknown statuses read as judging: the screen keeps polling instead of offering actions. */
        fun of(raw: String?): CaseStatus = entries.firstOrNull { it.raw == raw } ?: JUDGING
    }
}

@Serializable
data class CaseView(
    val id: String = "",
    val role: String = "owner",
    val yourParty: String = "a",
    @SerialName("status") val statusRaw: String = "",
    /** two_sided | one_sided | null */
    val mode: String? = null,
    /** free | premium: only a premium case holds a unit and takes evidence. */
    val tier: String = "premium",
    val lang: String = "en",
    val framework: FrameworkChoice = FrameworkChoice(),
    val createdAt: String = "",
    val expiresAt: String = "",
    val judgedAt: String? = null,
    val respondentAnswered: Boolean = false,
    val inviteUrl: String? = null,
    val ownInvite: Boolean = false,
    val sides: List<CaseSideView> = emptyList(),
    /** Oldest first; the last one is current. */
    val verdicts: List<CaseVerdictView> = emptyList(),
    val appeals: List<CaseAppealView> = emptyList(),
    val canJudgeNow: Boolean = false,
    val appeal: AppealGate = AppealGate(),
    /** quota | unavailable */
    val lastError: String? = null,
    /** Poll GET again after this many ms while something is judging; null otherwise. */
    val pollAfterMs: Long? = null,
    /** The viewer's own name map from the server's encrypted copy, or null. */
    val names: List<NameMapping>? = null,
    val display: CaseDisplay = CaseDisplay(),
    val removed: CaseRemoved? = null,
    val yourOriginal: String? = null,
) {
    val status: CaseStatus get() = CaseStatus.of(statusRaw)
    val current: CaseVerdictView? get() = verdicts.lastOrNull()
    val oneSided: Boolean get() = mode == "one_sided"
    val premium: Boolean get() = tier != "free"
    val appealJudging: Boolean get() = appeals.any { it.status == "judging" }
}

@Serializable
data class CaseSummary(
    val id: String = "",
    @SerialName("status") val statusRaw: String = "",
    val mode: String? = null,
    val createdAt: String = "",
    val expiresAt: String = "",
    val respondentAnswered: Boolean = false,
    val verdict: String? = null,
    val headline: String? = null,
    val excerpt: String? = null,
    val removed: Boolean = false,
) {
    val status: CaseStatus get() = CaseStatus.of(statusRaw)
}

@Serializable
data class CaseListResponse(val cases: List<CaseSummary> = emptyList(), val next: String? = null)

@Serializable
data class CaseResponse(@SerialName("case") val case: CaseView)

/** POST /api/v1/cases and POST /api/v1/cases/{id}/appeals (CreateCaseResponse, AppealResponse). */
@Serializable
data class CaseWithNames(
    @SerialName("case") val case: CaseView,
    @SerialName("name_map") val nameMap: List<NameMapping> = emptyList(),
    val entitlement: Entitlement? = null,
    val replayed: Boolean = false,
)

@Serializable
data class InviteResponse(val inviteUrl: String = "")

@Serializable
data class CaseRemovalResponse(val removed: Boolean = false, val removedAt: String = "", @SerialName("case") val case: CaseView? = null)

/** POST /api/v1/cases (CreateCaseRequest). Null fields are left out. */
@Serializable
data class CreateCaseRequest(
    val text: String,
    val framework: FrameworkChoice = FrameworkChoice(),
    val lang: String = "en",
    val tier: String = "premium",
    val evidence: List<String>? = null,
    val displayName: String? = null,
)

/** POST /api/v1/cases/{id}/appeals and /api/v1/verdicts/{id}/appeals (AppealRequest). */
@Serializable
data class AppealRequest(val text: String, val evidence: List<String>? = null)

/** One round of context added to a one-sided verdict (VerdictAppealView); its id is also its verdict's. */
@Serializable
data class VerdictAppealView(
    val id: String = "",
    /** judging | judged | failed */
    val status: String = "",
    /** quota | unavailable | refused */
    val error: String? = null,
    val outcome: String? = null,
    val baseId: String = "",
    val createdAt: String = "",
)

/**
 * A one-sided verdict's rounds from GET /api/v1/verdicts/{id}, oldest first.
 * [gate] is the writer's `owner.appeal`, null for everyone else.
 */
data class VerdictRounds(val appeals: List<VerdictAppealView>, val gate: AppealGate?)

/** 202 from POST /api/v1/verdicts/{id}/appeals (VerdictAppealResponse): the round to poll. */
@Serializable
data class VerdictAppealResponse(
    val appeal: VerdictAppealView,
    val appeals: List<VerdictAppealView> = emptyList(),
    val pollAfterMs: Long = WireJson.DEFAULT_POLL_AFTER_MS,
    @SerialName("name_map") val nameMap: List<NameMapping> = emptyList(),
    val entitlement: Entitlement? = null,
    val replayed: Boolean = false,
) {
    /** The round as an accepted verdict: it is polled the same way. */
    fun accepted(): VerdictAccepted = VerdictAccepted(appeal.id, pollAfterMs, nameMap, replayed = replayed, entitlement = entitlement)
}
