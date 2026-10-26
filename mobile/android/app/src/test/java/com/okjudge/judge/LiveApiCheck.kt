package com.okjudge.judge

import com.okjudge.judge.core.api.ApiResult
import com.okjudge.judge.core.api.JudgeApi
import com.okjudge.judge.core.api.PollPolicy
import com.okjudge.judge.core.api.awaitVerdict
import com.okjudge.judge.core.display.ContentLang
import com.okjudge.judge.core.display.UiError
import com.okjudge.judge.core.display.VerdictDisplay
import com.okjudge.judge.core.model.FrameworkChoice
import com.okjudge.judge.core.model.VerdictOutcome
import com.okjudge.judge.core.model.VerdictRequest
import com.okjudge.judge.core.model.VerdictSubmission
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import org.junit.Assume.assumeTrue
import org.junit.Test

/**
 * One real verdict through the app's API client, the way the app asks for
 * it (202, then polling). Costs a few cents, so it only runs when asked for:
 * gradlew testDebugUnitTest --tests "*LiveApiCheck*" -Pjudge.liveCheck=true [-Pjudge.liveBaseUrl=...]
 * Without a bot-check token the production server may answer 403
 * captcha_failed; that outcome is printed too.
 */
class LiveApiCheck {
    @Test
    fun oneRealVerdict() = runBlocking {
        assumeTrue(System.getProperty("judge.liveCheck") == "true")
        val base = System.getProperty("judge.liveBaseUrl") ?: "https://okjudge.com"
        val api = JudgeApi(base, OkHttpClient(), "Judge-Android/0.1.0 (1) live-check")
        val request = VerdictRequest(
            argument = "My friend Sam says a hot dog is a sandwich because it is meat in a split roll. " +
                "I say it is not, because nobody orders a sandwich and expects a hot dog.",
            framework = FrameworkChoice("balanced"),
            lang = "en",
        )
        val started = System.currentTimeMillis()
        fun secs() = (System.currentTimeMillis() - started) / 1000.0
        val res: ApiResult<VerdictOutcome> = when (val start = api.startVerdict(request)) {
            is ApiResult.Err -> start
            is ApiResult.Ok -> when (val submission = start.value) {
                is VerdictSubmission.Done -> {
                    println("LIVE answered 200 directly after ${secs()}s")
                    ApiResult.Ok(submission.outcome)
                }
                is VerdictSubmission.Accepted -> {
                    val accepted = submission.accepted
                    println("LIVE 202 after ${secs()}s id=${accepted.id} pollAfterMs=${accepted.pollAfterMs} owner_token=${accepted.ownerToken != null}")
                    var polls = 0
                    awaitVerdict(
                        accepted = accepted,
                        policy = PollPolicy(),
                        poll = {
                            polls += 1
                            api.pollVerdict(accepted.id, accepted.ownerToken).also {
                                val what = (it as? ApiResult.Ok)?.value?.let { p -> p::class.simpleName } ?: it.toString()
                                println("LIVE poll #$polls at ${secs()}s -> $what")
                            }
                        },
                        sleep = { delay(it) },
                        elapsedMs = { System.nanoTime() / 1_000_000 },
                    ).asApiResult().also { println("LIVE polls=$polls") }
                }
            }
        }
        println("LIVE base=$base took=${secs()}s")
        when (res) {
            is ApiResult.Ok -> {
                val o = res.value
                val r = o.result.result
                println("LIVE id=${o.id} share=$base/v/${o.id}")
                println("LIVE verdict=${r.verdict} dispute=${r.disputeType} confidence=${r.confidence} runs=${r.runs} lang=${ContentLang.verdictLang(r).tag}")
                println("LIVE headline=${r.headline}")
                println("LIVE crux=${r.crux}")
                println("LIVE lean=${r.leanState} trial=${r.cruxTrial?.outcome} escalated=${r.escalated}")
                println("LIVE tugA=${VerdictDisplay.tugFinal(r)}")
                println("LIVE name_map=${o.nameMap} owner_token=${o.ownerToken != null}")
            }
            is ApiResult.Err -> {
                val e = res.error
                println("LIVE error=$e")
                if (e is UiError.Api) println("LIVE code=${e.code} status=${e.status} server=\"${e.serverText}\"")
            }
        }
    }
}
