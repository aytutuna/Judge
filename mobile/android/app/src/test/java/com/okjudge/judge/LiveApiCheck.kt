package com.okjudge.judge

import com.okjudge.judge.core.api.ApiResult
import com.okjudge.judge.core.api.JudgeApi
import com.okjudge.judge.core.display.ContentLang
import com.okjudge.judge.core.display.UiError
import com.okjudge.judge.core.display.VerdictDisplay
import com.okjudge.judge.core.model.FrameworkChoice
import com.okjudge.judge.core.model.VerdictRequest
import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import org.junit.Assume.assumeTrue
import org.junit.Test

/**
 * One real verdict through the app's API client. Costs a few cents, so it
 * only runs when asked for:
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
        val res = api.submitVerdict(request)
        val secs = (System.currentTimeMillis() - started) / 1000.0
        println("LIVE base=$base took=${secs}s")
        when (res) {
            is ApiResult.Ok -> {
                val o = res.value
                val r = o.result.result
                println("LIVE id=${o.id} share=$base/v/${o.id}")
                println("LIVE verdict=${r.verdict} dispute=${r.disputeType} confidence=${r.confidence} runs=${r.runs} lang=${ContentLang.verdictLang(r).tag}")
                println("LIVE headline=${r.headline}")
                println("LIVE crux=${r.crux}")
                println("LIVE lean=${r.leanState} trial=${r.cruxTrial?.outcome} escalated=${r.escalated}")
                println("LIVE tugA=${VerdictDisplay.tugFinal(r)} beamDeg=${VerdictDisplay.finalBeamDeg(r)}")
                println("LIVE name_map=${o.nameMap}")
            }
            is ApiResult.Err -> {
                val e = res.error
                println("LIVE error=$e")
                if (e is UiError.Api) println("LIVE code=${e.code} status=${e.status} server=\"${e.serverText}\"")
            }
        }
    }
}
