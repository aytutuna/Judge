package com.okjudge.judge.core.display

import com.okjudge.judge.i18n.AppLang
import com.okjudge.judge.i18n.Strings
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException
import java.util.Locale
import kotlin.math.ceil

/**
 * A failure as the UI sees it. Resolved to text at render time with the
 * current language, so a language switch re-localizes an error already on
 * screen.
 */
sealed interface UiError {
    /** The server answered with an error (or a status that implies one). */
    data class Api(
        val code: String?,
        val status: Int,
        val retryAfterSec: Double? = null,
        val resetsAt: String? = null,
        val serverText: String? = null,
    ) : UiError

    /** No network, DNS failure, connection refused. */
    data object Offline : UiError

    /** Client timeout, or Cloudflare's 524 when the origin took longer than 100 s. */
    data object Timeout : UiError

    /** The bot check could not produce a token. */
    data object BotCheck : UiError

    /** A 200 whose body did not parse. */
    data object Unknown : UiError
}

/** Ports of `formatWait`, `formatDate`, `tWithDate` and `apiErrorMessage` (lib/i18n.ts). */
object Errors {
    /** Stable API codes the dictionary has a message for (ERROR_KEY_BY_CODE). */
    val KNOWN_CODES: Set<String> = setOf(
        "invalid", "too_short", "too_long", "not_configured", "quota", "unavailable",
        "rate_limited", "daily_cap", "captcha_failed", "signin_required", "premium_required",
        "no_credits", "fair_use", "in_progress", "bad_origin", "not_found",
    )

    /** A server wait as a whole phrase, rounding up: minutes below 90, hours beyond. */
    fun formatWait(s: Strings, seconds: Double?): String {
        if (seconds == null || !seconds.isFinite() || seconds <= 0) return s.waitMoment
        val minutes = ceil(seconds / 60).toLong()
        if (minutes < 90) return if (minutes == 1L) s.waitMinute else s.waitMinutes(minutes.toString())
        val hours = ceil(seconds / 3600).toLong()
        return if (hours == 1L) s.waitHour else s.waitHours(hours.toString())
    }

    /** "November 18" / "18 Kasım", or null for a missing or unparseable timestamp. */
    fun formatDate(lang: AppLang, iso: String?, zone: ZoneId = ZoneId.systemDefault()): String? {
        if (iso.isNullOrEmpty()) return null
        val instant = try {
            Instant.parse(iso)
        } catch (_: DateTimeParseException) {
            return null
        }
        val formatter = when (lang) {
            AppLang.EN -> DateTimeFormatter.ofPattern("MMMM d", Locale.US)
            AppLang.TR -> DateTimeFormatter.ofPattern("d MMMM", Locale.forLanguageTag("tr-TR"))
        }
        return formatter.format(instant.atZone(zone))
    }

    /** Localized message for an API error body (apiErrorMessage). */
    fun apiErrorMessage(
        s: Strings,
        lang: AppLang,
        code: String?,
        status: Int?,
        retryAfterSec: Double?,
        resetsAt: String?,
        serverText: String?,
    ): String {
        val effective = code ?: if (status == 429) "rate_limited" else null
        if (effective != null && effective in KNOWN_CODES) {
            return when (effective) {
                "rate_limited" -> s.errorRateLimited(formatWait(s, retryAfterSec))
                "daily_cap" -> s.errorDailyCap(formatWait(s, retryAfterSec))
                "fair_use" -> formatDate(lang, resetsAt)?.let { s.errorFairUse(it) } ?: s.errorFairUseSoon
                "bad_origin" -> s.appErrorBadOrigin
                else -> s.text("error.$effective") ?: s.errorFallback
            }
        }
        if (!serverText.isNullOrBlank()) return serverText
        return s.errorFallback
    }

    fun message(error: UiError, s: Strings, lang: AppLang): String = when (error) {
        is UiError.Api -> apiErrorMessage(s, lang, error.code, error.status, error.retryAfterSec, error.resetsAt, error.serverText)
        UiError.Offline -> s.appErrorOffline
        UiError.Timeout -> s.appErrorTimeout
        UiError.BotCheck -> s.appTurnstileError
        UiError.Unknown -> s.errorFallback
    }

    /** Whether a "Try again" button makes sense for this failure. */
    fun isRetryable(error: UiError): Boolean = when (error) {
        is UiError.Api -> error.code in setOf("unavailable", "quota", "captcha_failed") ||
            (error.code == null && error.status >= 500)
        UiError.Offline, UiError.Timeout, UiError.BotCheck, UiError.Unknown -> true
    }

    /** How long the submit button stays disabled after this failure, in seconds. */
    fun blockSeconds(error: UiError): Double? = when {
        error is UiError.Api && (error.code == "rate_limited" || (error.code == null && error.status == 429)) ->
            error.retryAfterSec?.takeIf { it > 0 } ?: 60.0
        error is UiError.Api && error.code == "daily_cap" -> error.retryAfterSec?.takeIf { it > 0 }
        else -> null
    }
}
