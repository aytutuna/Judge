package com.okjudge.judge.core.api

import com.okjudge.judge.core.display.UiError
import com.okjudge.judge.core.model.VerdictAccepted
import com.okjudge.judge.core.model.VerdictOutcome
import com.okjudge.judge.core.model.VerdictPoll
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.roundToLong

/**
 * Client backoff for async verdicts (POLL_POLICY in lib/verdict-poll.ts):
 * start at the 202's pollAfterMs, grow [factor]x per poll up to [maxMs]
 * while the server answers; after errors (offline, 5xx, 429) double up to
 * [errorMaxMs]. A larger server hint (pollAfterMs, Retry-After) wins.
 *
 * [maxErrors] failed polls in a row end the wait; so does [deadlineMs]
 * after the 202 (the server fails a verdict still judging after 10 minutes,
 * so the app normally hears "failed" first).
 */
data class PollPolicy(
    val firstMs: Long = 2000,
    val factor: Double = 1.5,
    val maxMs: Long = 5000,
    val errorMaxMs: Long = 15_000,
    val maxErrors: Int = 5,
    val deadlineMs: Long = 11 * 60_000L,
) {
    /** Milliseconds to wait before poll number [attempt] (0-based) after [errors] failed polls in a row. */
    fun nextDelay(attempt: Int, hintMs: Long? = null, errors: Int = 0): Long {
        val steady = min(maxMs.toDouble(), firstMs * factor.pow(max(0, attempt)))
        val backoff = if (errors > 0) min(errorMaxMs.toDouble(), firstMs * 2.0.pow(errors)) else 0.0
        val hint = (hintMs ?: 0L).coerceAtLeast(0L).toDouble()
        return min(MAX_WAIT_MS.toDouble(), maxOf(steady, backoff, hint)).roundToLong()
    }

    companion object {
        const val MAX_WAIT_MS = 60_000L
    }
}

/** How polling an accepted verdict ended. */
sealed interface PollOutcome {
    data class Ready(val outcome: VerdictOutcome) : PollOutcome

    /**
     * No verdict. [resumable] is false when the server settled it (failed,
     * 404, 410): polling the same id again would only repeat that. After
     * network trouble, server hiccups or the deadline the verdict may still
     * arrive, so the id is worth keeping.
     */
    data class Ended(val error: UiError, val resumable: Boolean) : PollOutcome

    fun asApiResult(): ApiResult<VerdictOutcome> = when (this) {
        is Ready -> ApiResult.Ok(outcome)
        is Ended -> ApiResult.Err(error)
    }
}

/**
 * Polls an accepted verdict until it is ready or failed, then merges the
 * 202's name map and owner token into the result, so a polled verdict and
 * a direct 200 give the same [VerdictOutcome].
 *
 * Network errors, timeouts, unreadable bodies, 429 and 5xx keep polling the
 * same id with backoff; any other 4xx (404, 410) ends it. Cancelling the
 * calling coroutine stops the wait and the poll in flight.
 */
internal suspend fun awaitVerdict(
    accepted: VerdictAccepted,
    policy: PollPolicy,
    poll: suspend () -> ApiResult<VerdictPoll>,
    sleep: suspend (Long) -> Unit,
    elapsedMs: () -> Long,
): PollOutcome {
    val deadline = elapsedMs() + policy.deadlineMs
    var attempt = 0
    var errors = 0
    var wait = accepted.pollAfterMs.coerceAtMost(PollPolicy.MAX_WAIT_MS)
    while (true) {
        sleep(max(0L, min(wait, deadline - elapsedMs())))
        if (elapsedMs() >= deadline) return PollOutcome.Ended(UiError.Timeout, resumable = true)
        when (val answer = poll()) {
            is ApiResult.Ok -> when (val p = answer.value) {
                is VerdictPoll.Judging -> {
                    errors = 0
                    attempt += 1
                    wait = policy.nextDelay(attempt, hintMs = p.pollAfterMs)
                }
                is VerdictPoll.Failed -> return PollOutcome.Ended(failedError(p), resumable = false)
                is VerdictPoll.Ready -> return PollOutcome.Ready(
                    VerdictOutcome(
                        id = accepted.id,
                        result = p.result,
                        nameMap = accepted.nameMap,
                        replayed = accepted.replayed,
                        ownerToken = accepted.ownerToken,
                        entitlement = accepted.entitlement,
                    ),
                )
            }
            is ApiResult.Err -> {
                if (!isTransient(answer.error)) return PollOutcome.Ended(answer.error, resumable = false)
                errors += 1
                if (errors >= policy.maxErrors) return PollOutcome.Ended(answer.error, resumable = true)
                val retryAfter = (answer.error as? UiError.Api)?.retryAfterSec?.let { (it * 1000).roundToLong() }
                wait = policy.nextDelay(attempt, hintMs = retryAfter, errors = errors)
            }
        }
    }
}

/** A verdict that failed in the background, as the error UI sees it (status 502 like the sync path). */
internal fun failedError(failed: VerdictPoll.Failed): UiError =
    UiError.Api(code = failed.code, status = 502, serverText = failed.error)

private fun isTransient(error: UiError): Boolean = when (error) {
    is UiError.Api -> error.status >= 500 || error.status == 429 || error.status == 408
    UiError.Offline, UiError.Timeout, UiError.Unknown -> true
    UiError.BotCheck -> false
}
