package com.okjudge.judge.core.auth

import android.content.Context
import com.okjudge.judge.core.display.UiError
import com.okjudge.judge.core.model.AgeStatus

/** What the phone's own age signal says about the user. */
enum class PlatformAge { ADULT, MINOR, UNKNOWN }

/** What the app shows over everything else for the age check. */
enum class AgeGate {
    NONE,

    /** The account hasn't confirmed 18+ yet: the sheet with the checkbox. */
    CONFIRM,

    /** Under 18, or the account is blocked: Judge can't be used. */
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

    /** POST /api/v1/me/age. */
    data class Report(val adult: Boolean, val source: String)

    /**
     * An age range the platform shared. An upper bound below 18 is a minor
     * (supervised, verified or declared alike); a lower bound of 18 or more is
     * an adult. No range, or one that straddles 18, says nothing.
     */
    fun fromRange(lower: Int?, upper: Int?): PlatformAge = when {
        upper != null && upper < 18 -> PlatformAge.MINOR
        lower != null && lower >= 18 -> PlatformAge.ADULT
        else -> PlatformAge.UNKNOWN
    }

    /** What to tell the server about this account now, or null when nothing. A minor is reported even after a confirmation. */
    fun report(platform: PlatformAge?, age: AgeStatus?, ticked: Boolean): Report? = when {
        age == null || age.blocked -> null
        platform == PlatformAge.MINOR -> Report(adult = false, source = "platform")
        age.confirmed -> null
        platform == PlatformAge.ADULT -> Report(adult = true, source = "platform")
        ticked -> Report(adult = true, source = "checkbox")
        else -> null
    }

    /** The confirmation the sheet sends: the platform's when it already said 18+, else the checkbox's. */
    fun confirmation(platform: PlatformAge?): Report =
        Report(adult = true, source = if (platform == PlatformAge.ADULT) "platform" else "checkbox")

    /** The sheet waits for the platform's answer and for a report in flight, so it never flashes up. */
    fun gate(platform: PlatformAge?, signedIn: Boolean, age: AgeStatus?, posting: Boolean): AgeGate = when {
        platform == PlatformAge.MINOR -> AgeGate.BLOCKED
        !signedIn || age == null -> AgeGate.NONE
        age.blocked -> AgeGate.BLOCKED
        !age.confirmed && platform != null && !posting -> AgeGate.CONFIRM
        else -> AgeGate.NONE
    }

    /** The sign-in checkbox shows unless the platform already said 18+. */
    fun needsCheckbox(platform: PlatformAge?): Boolean = platform != PlatformAge.ADULT

    fun isAgeError(error: UiError?): Boolean =
        error is UiError.Api && error.status == 403 && (error.code == BLOCKED || error.code == UNCONFIRMED)

    /** The age error of a 403, sent as `code` or as a bare `error`; null for anything else. */
    fun errorCode(status: Int, code: String?, error: String?): String? {
        if (status != 403) return null
        return listOf(code, error).firstOrNull { it == BLOCKED || it == UNCONFIRMED }
    }
}
