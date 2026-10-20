package com.okjudge.judge.core.api

import com.okjudge.judge.core.display.UiError
import com.okjudge.judge.core.model.StoredVerdict
import com.okjudge.judge.core.model.TranslateOutcome
import com.okjudge.judge.core.model.VerdictOutcome
import com.okjudge.judge.core.model.VerdictRequest
import com.okjudge.judge.core.model.WireJson
import com.okjudge.judge.i18n.AppLang
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerializationException
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.coroutines.executeAsync
import java.io.IOException
import java.io.InterruptedIOException
import java.util.concurrent.TimeUnit

sealed interface ApiResult<out T> {
    data class Ok<T>(val value: T) : ApiResult<T>
    data class Err(val error: UiError) : ApiResult<Nothing>
}

/**
 * Client for the three phase-1 endpoints of /api/v1. No cookies, no
 * automatic retries of the verdict POST (a retry would cost the user's rate
 * limit and a second verdict), and per-call timeouts sized to the server's
 * real work: a verdict can legitimately take about 285 s.
 *
 * Main-safe: the call, the body read and the JSON decode all run on [io], so
 * callers on Dispatchers.Main never touch the socket.
 */
class JudgeApi(
    baseUrl: String,
    client: OkHttpClient,
    private val userAgent: String,
    private val tokenStore: TokenStore = NoTokenStore,
    private val onSignedOut: () -> Unit = {},
    timeouts: Timeouts = Timeouts(),
    private val io: CoroutineDispatcher = Dispatchers.IO,
) {
    data class Timeouts(val verdictSec: Long = 310, val translateSec: Long = 90, val getSec: Long = 20)

    private val base: HttpUrl = baseUrl.trimEnd('/').toHttpUrl()

    private val verdictClient = client.newBuilder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(timeouts.verdictSec, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .callTimeout(timeouts.verdictSec, TimeUnit.SECONDS)
        .retryOnConnectionFailure(false)
        .build()

    private val translateClient = client.newBuilder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(timeouts.translateSec, TimeUnit.SECONDS)
        .callTimeout(timeouts.translateSec, TimeUnit.SECONDS)
        .build()

    private val getClient = client.newBuilder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(timeouts.getSec, TimeUnit.SECONDS)
        .callTimeout(timeouts.getSec, TimeUnit.SECONDS)
        .build()

    suspend fun submitVerdict(request: VerdictRequest): ApiResult<VerdictOutcome> {
        val body = WireJson.json.encodeToString(VerdictRequest.serializer(), request)
        val req = request(url("api", "v1", "verdict")).post(body.toRequestBody(JSON)).build()
        return execute(verdictClient, req, WireJson::decodeVerdictResponse)
    }

    suspend fun translate(id: String, lang: AppLang): ApiResult<TranslateOutcome> {
        val url = base.newBuilder()
            .addPathSegments("api/v1/verdicts")
            .addPathSegment(id)
            .addPathSegment("translate")
            .addQueryParameter("lang", lang.tag)
            .build()
        val req = request(url).post(EMPTY).build()
        return execute(translateClient, req, WireJson::decodeTranslateResponse)
    }

    suspend fun getVerdict(id: String): ApiResult<StoredVerdict> {
        val url = base.newBuilder().addPathSegments("api/v1/verdicts").addPathSegment(id).build()
        return execute(getClient, request(url).get().build(), WireJson::decodeStoredVerdict)
    }

    private fun url(vararg segments: String): HttpUrl =
        base.newBuilder().apply { segments.forEach { addPathSegment(it) } }.build()

    private fun request(url: HttpUrl): Request.Builder {
        val builder = Request.Builder()
            .url(url)
            .header("Accept", "application/json")
            .header("User-Agent", userAgent)
        tokenStore.get()?.let { builder.header("Authorization", "Bearer $it") }
        return builder
    }

    private suspend fun <T> execute(client: OkHttpClient, request: Request, decode: (String) -> T): ApiResult<T> {
        val hadToken = request.header("Authorization") != null
        val result = try {
            withContext(io) { exchange(client, request, decode) }
        } catch (e: CancellationException) {
            throw e
        } catch (e: IOException) {
            currentCoroutineContext().ensureActive()
            ApiResult.Err(transportError(e))
        }
        // Sign-out runs back on the caller's dispatcher: it may touch UI state.
        val error = (result as? ApiResult.Err)?.error as? UiError.Api
        if (hadToken && error?.status == 401 && error.code == "signin_required") {
            tokenStore.clear()
            onSignedOut()
        }
        return result
    }

    /** Runs on [io]: executes the call, reads the body and decodes it. */
    private suspend fun <T> exchange(client: OkHttpClient, request: Request, decode: (String) -> T): ApiResult<T> =
            client.newCall(request).executeAsync().use { response ->
                val text = response.body.string()
                if (response.isSuccessful) {
                    try {
                        ApiResult.Ok(decode(text))
                    } catch (_: SerializationException) {
                        ApiResult.Err(UiError.Unknown)
                    } catch (_: IllegalArgumentException) {
                        ApiResult.Err(UiError.Unknown)
                    }
                } else {
                    ApiResult.Err(errorFor(response.code, text, response.header("Retry-After")))
                }
            }

    companion object {
        private val JSON = "application/json; charset=utf-8".toMediaType()
        private val EMPTY: RequestBody = ByteArray(0).toRequestBody(null)

        /** HTTP failure -> UiError (see the error table in the design doc, 4.5). */
        fun errorFor(status: Int, body: String?, retryAfterHeader: String?): UiError {
            if (status == 524 || status == 504) return UiError.Timeout
            val header = retryAfterHeader?.trim()?.toDoubleOrNull()?.takeIf { it > 0 }
            val parsed = WireJson.decodeErrorBody(body)
            if (parsed != null) {
                return UiError.Api(
                    code = parsed.code,
                    status = status,
                    retryAfterSec = parsed.retryAfterSec ?: header,
                    resetsAt = parsed.resetsAt,
                    serverText = parsed.error,
                )
            }
            return when {
                status >= 500 -> UiError.Api(code = "unavailable", status = status)
                else -> UiError.Api(code = null, status = status, retryAfterSec = header)
            }
        }

        fun transportError(e: IOException): UiError = when (e) {
            is InterruptedIOException -> UiError.Timeout
            else -> UiError.Offline
        }
    }
}
