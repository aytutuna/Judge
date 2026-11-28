package com.okjudge.judge.core.auth

import android.content.Context
import com.okjudge.judge.core.display.UiError
import com.okjudge.judge.core.model.AgeStatus
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset

/**
 * What the phone's own age signal says about the user. It is reported to the server, except that
 * [MINOR_UNAPPROVED] also holds the app behind the approval cover.
 */
enum class PlatformAge {
    ADULT,
    MINOR,
    UNDER13,

    /** A minor whose parent's approval of a significant change is pending or was declined. */
    MINOR_UNAPPROVED,

    /** Play answered and has nothing to report (not shared, or no usable range). Not a held minor. */
    NO_SIGNAL,

    /** Play could not be asked or gave no final answer (error, timeout, cancelled prompt, verification pending). */
    UNKNOWN,
}

/** What the app shows over everything else for the age check. */
enum class AgeGate {
    NONE,

    /** The account has no date of birth yet (also an old 18+ block): the date step. */
    DATE,

    /** A final block: Judge can't be used. */
    BLOCKED,

    /** Brazil under 18: refused until the 18th birthday. */
    RESTRICTED,

    /** A parent has to say yes: the email step, the waiting page, or the declined and revoked pages. */
    PARENT,

    /** The store holds the account until a parent approves: nothing past the age step. */
    APPROVAL,
}

/** The phone's age signal (Google Play Age Signals in the app). */
fun interface AgeSignalSource {
    /** [host] is the Activity a consent prompt attaches to. Never throws: failures read as [PlatformAge.UNKNOWN]. */
    suspend fun check(host: Context): PlatformAge

    companion object {
        val None = AgeSignalSource { PlatformAge.UNKNOWN }
    }
}

/** The age decisions, kept pure so both the account and the tests use the same rules. */
object AgeCheck {
    const val SUPPORT_EMAIL = "support@okjudge.com"

    const val BLOCKED = "age_blocked"
    const val UNCONFIRMED = "age_unconfirmed"

    /** Not a refusal of the account: the phone check or a report is still running, so wait a moment. */
    const val CHECKING = "age_checking"
    const val REGION = "age_region"
    const val PARENT_PENDING = "age_parent_pending"

    /** The 403 codes that put an age screen up. */
    val REFUSALS = setOf(BLOCKED, UNCONFIRMED, REGION, PARENT_PENDING)
    const val AGE_SET = "age_set"

    private const val AHEAD_HOURS = 14L

    /** POST /api/v1/me/age with the store's answer. */
    data class Report(val adult: Boolean, val under13: Boolean = false)

    /**
     * An age range the platform shared. An upper bound below 13 is under 13,
     * below 18 a minor (supervised, verified or declared alike); a lower bound
     * of 18 or more is an adult. No range, or one that straddles 18, says nothing.
     */
    fun fromRange(lower: Int?, upper: Int?): PlatformAge = when {
        upper != null && upper < 13 -> PlatformAge.UNDER13
        upper != null && upper < 18 -> PlatformAge.MINOR
        lower != null && lower >= 18 -> PlatformAge.ADULT
        else -> PlatformAge.UNKNOWN
    }

    /**
     * The store's full answer as one result. A shared answer without a usable range is
     * [PlatformAge.NO_SIGNAL]: Play answered, so any earlier hold ends. Anything not shared (the person's own choice
     * to decline, verification still required, unspecified, missing) is [PlatformAge.UNKNOWN]: it says nothing about age. A minor whose
     * significant change is pending or declined is [PlatformAge.MINOR_UNAPPROVED] until the store shows approval.
     */
    fun fromSignals(accessStatus: Int?, lower: Int?, upper: Int?, changeStatus: Int?): PlatformAge {
        if (accessStatus != SIGNALS_SHARED) return PlatformAge.UNKNOWN
        val range = fromRange(lower, upper)
        val held = changeStatus == CHANGE_PENDING || changeStatus == CHANGE_DECLINED
        return when {
            range == PlatformAge.MINOR && held -> PlatformAge.MINOR_UNAPPROVED
            range == PlatformAge.UNKNOWN -> PlatformAge.NO_SIGNAL
            else -> range
        }
    }

    // Values of AgeSignalsStatus.SHARED and SignificantChangeStatus.PENDING / DECLINED (age-signals 0.0.6).
    const val SIGNALS_SHARED = 1
    const val CHANGE_PENDING = 2
    const val CHANGE_DECLINED = 3

    /** What to tell the server about the store's answer, or null when there is nothing to say or the block is final. */
    fun report(platform: PlatformAge?, age: AgeStatus?): Report? = when {
        age == null || (age.blocked && !age.needsDob) -> null
        platform == PlatformAge.ADULT -> Report(adult = true)
        platform == PlatformAge.MINOR || platform == PlatformAge.MINOR_UNAPPROVED -> Report(adult = false)
        platform == PlatformAge.UNDER13 -> Report(adult = false, under13 = true)
        else -> null
    }

    /** Decided in this order: a final block, the region refusal, the parent step, the date step, the store's pending approval, nothing. */
    fun gate(signedIn: Boolean, age: AgeStatus?, platform: PlatformAge? = null): AgeGate = when {
        !signedIn || age == null -> AgeGate.NONE
        age.blocked && !age.needsDob -> AgeGate.BLOCKED
        age.restricted -> AgeGate.RESTRICTED
        age.parent != null -> AgeGate.PARENT
        age.needsDob -> AgeGate.DATE
        platform == PlatformAge.MINOR_UNAPPROVED -> AgeGate.APPROVAL
        else -> AgeGate.NONE
    }

    /** Whether the typed date also asks where the person lives: 13 to 15 on the latest date, as the website does. */
    fun asksCountry(dob: LocalDate, nowMillis: Long): Boolean =
        !underThirteen(dob, nowMillis) && youngerThan(dob, 16, nowMillis)

    /** Whether the typed date and country also ask about Quebec: 13 in Canada. */
    fun asksQuebec(dob: LocalDate, country: String?, nowMillis: Long): Boolean =
        asksCountry(dob, nowMillis) && youngerThan(dob, 14, nowMillis) && country == "CA"

    private fun youngerThan(dob: LocalDate, years: Long, nowMillis: Long): Boolean =
        dob.isAfter(Instant.ofEpochMilli(nowMillis).atOffset(ZoneOffset.UTC).toLocalDate().minusYears(years))

    /** The latest calendar date anywhere on Earth (UTC+14). */
    fun latestDate(nowMillis: Long): LocalDate =
        Instant.ofEpochMilli(nowMillis).plusSeconds(AHEAD_HOURS * 3600).atOffset(ZoneOffset.UTC).toLocalDate()

    /**
     * Under 13 on the latest date anywhere, so nobody whose 13th birthday it
     * already is in their own time zone gets closed out for good. 29 February
     * minus years lands on the 28th.
     */
    fun underThirteen(dob: LocalDate, nowMillis: Long): Boolean = dob.isAfter(latestDate(nowMillis).minusYears(13))

    /** Usage events go out only for an account whose age is known and 18 or more (as on the website). */
    fun usageStatsLocked(age: AgeStatus?): Boolean = age != null && (age.teen || age.blocked || age.needsDob || age.restricted || age.parent != null)

    /**
     * What analytics may do: false (drop everything) when the setting is off or the account is locked,
     * true once the age is known to be fine, null while it is not known yet (events wait in memory).
     */
    fun usageStatsOn(preference: Boolean, locked: Boolean?): Boolean? = when {
        !preference || locked == true -> false
        locked == null -> null
        else -> true
    }

    /** The "Help improve Judge" card is never shown to a teen, whatever a cached answer says. */
    fun showsConsentCard(ask: Boolean, teen: Boolean): Boolean = ask && !teen

    fun isAgeError(error: UiError?): Boolean =
        error is UiError.Api && error.status == 403 && error.code in REFUSALS

    /** The age error of a 403, sent as `code` or as a bare `error`; null for anything else. */
    fun errorCode(status: Int, code: String?, error: String?): String? {
        if (status != 403) return null
        return listOf(code, error).firstOrNull { it in REFUSALS }
    }
}
