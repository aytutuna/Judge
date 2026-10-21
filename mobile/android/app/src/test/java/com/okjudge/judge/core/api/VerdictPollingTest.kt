package com.okjudge.judge.core.api

import com.okjudge.judge.Fixtures
import com.okjudge.judge.core.display.UiError
import com.okjudge.judge.core.model.NameMapping
import com.okjudge.judge.core.model.VerdictAccepted
import com.okjudge.judge.core.model.VerdictOutcome
import com.okjudge.judge.core.model.VerdictPoll
import com.okjudge.judge.core.model.WireJson
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class VerdictPollingTest {
    private val policy = PollPolicy()
    private val accepted = VerdictAccepted(
        id = "winB000001",
        pollAfterMs = 2000,
        nameMap = listOf(NameMapping("Alex", "Party A")),
        ownerToken = "tok",
    )
    private val ready = VerdictPoll.Ready("winB000001", Fixtures.sample("win_b_named").result)

    /** Runs the loop on a virtual clock: each sleep advances it. */
    private class Run(answers: List<ApiResult<VerdictPoll>>, val repeatLast: Boolean = false) {
        private val queue = ArrayDeque(answers)
        var clock = 0L
        val sleeps = mutableListOf<Long>()
        var polls = 0

        suspend fun go(accepted: VerdictAccepted, policy: PollPolicy): ApiResult<VerdictOutcome> = awaitVerdict(
            accepted = accepted,
            policy = policy,
            poll = {
                polls += 1
                if (repeatLast && queue.size == 1) queue.first() else queue.removeFirst()
            },
            sleep = { sleeps += it; clock += it },
            elapsedMs = { clock },
        )
    }

    private val judging: ApiResult<VerdictPoll> = ApiResult.Ok(VerdictPoll.Judging(2000))

    @Test
    fun nextDelay_growsToFiveSeconds_andBacksOffHarderAfterErrors() {
        assertEquals(listOf(2000L, 3000L, 4500L, 5000L, 5000L), (0..4).map { policy.nextDelay(it) })
        assertEquals(7000L, policy.nextDelay(1, hintMs = 7000))
        assertEquals(listOf(4000L, 8000L, 15_000L, 15_000L), (1..4).map { policy.nextDelay(0, errors = it) })
        assertEquals(PollPolicy.MAX_WAIT_MS, policy.nextDelay(0, hintMs = 600_000))
    }

    @Test
    fun ready_mergesTheAcceptedNameMapAndOwnerToken() = runBlocking {
        val run = Run(listOf(judging, judging, ApiResult.Ok(ready)))
        val outcome = (run.go(accepted, policy) as ApiResult.Ok).value
        assertEquals(VerdictOutcome("winB000001", ready.result, accepted.nameMap, ownerToken = "tok"), outcome)
        assertEquals("first wait is the 202's pollAfterMs", listOf(2000L, 3000L, 4500L), run.sleeps)
    }

    @Test
    fun networkErrors_retryWithBackoff_thenGiveUp() = runBlocking {
        val recovers = Run(listOf(ApiResult.Err(UiError.Offline), ApiResult.Err(UiError.Timeout), ApiResult.Ok(ready)))
        assertTrue(recovers.go(accepted, policy) is ApiResult.Ok)
        assertEquals(listOf(2000L, 4000L, 8000L), recovers.sleeps)

        val offline = Run(List(policy.maxErrors + 1) { ApiResult.Err(UiError.Offline) })
        assertEquals(ApiResult.Err(UiError.Offline), offline.go(accepted, policy))
        assertEquals(policy.maxErrors + 1, offline.polls)
    }

    @Test
    fun aJudgingAnswer_resetsTheErrorCount() = runBlocking {
        val answers = mutableListOf<ApiResult<VerdictPoll>>()
        repeat(3) { answers += List(policy.maxErrors) { ApiResult.Err(UiError.Offline) }; answers += judging }
        answers += ApiResult.Ok(ready)
        assertTrue(Run(answers).go(accepted, policy) is ApiResult.Ok)
    }

    @Test
    fun rateLimitAndServerErrors_areTransient_butNotFoundIsFinal() = runBlocking {
        val limited = UiError.Api(code = "rate_limited", status = 429, retryAfterSec = 9.0)
        val run = Run(listOf(ApiResult.Err(limited), ApiResult.Err(UiError.Api("unavailable", 503)), ApiResult.Ok(ready)))
        assertTrue(run.go(accepted, policy) is ApiResult.Ok)
        assertEquals("Retry-After wins", 9000L, run.sleeps[1])

        val gone = UiError.Api(code = "not_found", status = 404)
        val missing = Run(listOf(ApiResult.Err(gone), ApiResult.Ok(ready)))
        assertEquals(ApiResult.Err(gone), missing.go(accepted, policy))
        assertEquals(1, missing.polls)
    }

    @Test
    fun failedCodes_becomeApiErrors() = runBlocking {
        for (code in listOf("quota", "unavailable", "refused")) {
            val run = Run(listOf(judging, ApiResult.Ok(VerdictPoll.Failed(code, "server text"))))
            assertEquals(ApiResult.Err(UiError.Api(code = code, status = 502, serverText = "server text")), run.go(accepted, policy))
        }
    }

    @Test
    fun stillJudgingAtTheDeadline_timesOut() = runBlocking {
        val run = Run(listOf(judging), repeatLast = true)
        assertEquals(ApiResult.Err(UiError.Timeout), run.go(accepted, policy))
        assertEquals(policy.deadlineMs, run.clock)
    }

    @Test
    fun decodePoll_readsTheThreeStates_andAPreAsyncServer() {
        assertEquals(VerdictPoll.Judging(2000), WireJson.decodePoll("""{"id":"x","status":"judging","pollAfterMs":2000}"""))
        assertEquals(
            VerdictPoll.Failed("quota", "msg"),
            WireJson.decodePoll("""{"id":"x","status":"failed","code":"quota","error":"msg"}"""),
        )
        val stored = Fixtures.verdicts["storedVerdictResponse"].toString()
        val ready = WireJson.decodePoll(stored) as VerdictPoll.Ready
        assertEquals("winB000001", ready.id)
        assertEquals(Fixtures.sample("win_b_named").result, ready.result)
    }

    @Test
    fun decodeAccepted_keepsNameMapAndOwnerToken_andDefaultsTheWait() {
        val a = WireJson.decodeAccepted(
            """{"id":"x","status":"judging","pollAfterMs":1500,"poll":"/api/v1/verdicts/x",""" +
                """"name_map":[{"original":"Sam","replacement":"Party B"}],"owner_token":"t"}""",
        )
        assertEquals(VerdictAccepted("x", 1500, listOf(NameMapping("Sam", "Party B")), "t"), a)
        val bare = WireJson.decodeAccepted("""{"id":"y","status":"judging","name_map":[],"replayed":true}""")
        assertEquals(VerdictAccepted("y", WireJson.DEFAULT_POLL_AFTER_MS, emptyList(), null, replayed = true), bare)
    }
}
