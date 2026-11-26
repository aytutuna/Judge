package com.okjudge.judge.core.auth

import android.content.Context
import com.okjudge.judge.core.display.UiError
import com.okjudge.judge.core.model.AgeStatus
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset

/** What the phone's own age signal says about the user. Only ever reported, never acted on here. */
enum class PlatformAge { ADULT, MINOR, UNDER13, UNKNOWN }

/** What the app shows over everything else for the age check. */
enum class AgeGate {
    NONE,

    /** The account has no date of birth yet (also an old 18+ block): the date step. */
    DATE,

    /** A final block: Judge can't be used. */
    BLOCKED,
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

    /** What to tell the server about the store's answer, or null when there is nothing to say or the block is final. */
    fun report(platform: PlatformAge?, age: AgeStatus?): Report? = when {
        age == null || (age.blocked && !age.needsDob) -> null
        platform == PlatformAge.ADULT -> Report(adult = true)
        platform == PlatformAge.MINOR -> Report(adult = false)
        platform == PlatformAge.UNDER13 -> Report(adult = false, under13 = true)
        else -> null
    }

    /** Decided from the server's last word, in this order: a final block, the date step, nothing. */
    fun gate(signedIn: Boolean, age: AgeStatus?): AgeGate = when {
        !signedIn || age == null -> AgeGate.NONE
        age.blocked && !age.needsDob -> AgeGate.BLOCKED
        age.needsDob -> AgeGate.DATE
        else -> AgeGate.NONE
    }

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
    fun usageStatsLocked(age: AgeStatus?): Boolean = age != null && (age.teen || age.blocked || age.needsDob)

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
        error is UiError.Api && error.status == 403 && (error.code == BLOCKED || error.code == UNCONFIRMED)

    /** The age error of a 403, sent as `code` or as a bare `error`; null for anything else. */
    fun errorCode(status: Int, code: String?, error: String?): String? {
        if (status != 403) return null
        return listOf(code, error).firstOrNull { it == BLOCKED || it == UNCONFIRMED }
    }
}
