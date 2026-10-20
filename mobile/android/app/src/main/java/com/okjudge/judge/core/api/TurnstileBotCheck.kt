package com.okjudge.judge.core.api

import android.annotation.SuppressLint
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface
import android.webkit.WebView
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * Invisible Cloudflare Turnstile in an off-screen WebView. The page is
 * loaded with base URL `https://okjudge.com/`, so the widget's hostname
 * matches the site key's allowed domain and the server verifies the token
 * exactly as it does for the website.
 *
 * Unvalidated against production: if Cloudflare refuses tokens minted this
 * way, swap this class for a server-backed check; callers only see [BotCheck].
 * A challenge that needs a tap fails here with [BotCheckException] (phase 1
 * has no sheet for it yet).
 */
class TurnstileBotCheck(
    private val context: Context,
    private val siteKey: String,
    private val pageBaseUrl: String = "https://okjudge.com/",
    private val timeoutMs: Long = 30_000,
) : BotCheck {

    override suspend fun token(): String? = try {
        withTimeout(timeoutMs) { withContext(Dispatchers.Main) { fetchToken() } }
    } catch (e: TimeoutCancellationException) {
        throw BotCheckException("Turnstile timed out", e)
    }

    @SuppressLint("SetJavaScriptEnabled")
    private suspend fun fetchToken(): String = suspendCancellableCoroutine { cont ->
        val main = Handler(Looper.getMainLooper())
        val settled = AtomicBoolean(false)
        val webView = WebView(context.applicationContext)

        fun finish(block: () -> Unit) {
            if (!settled.compareAndSet(false, true)) return
            main.post {
                block()
                webView.removeJavascriptInterface(BRIDGE)
                webView.destroy()
            }
        }

        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        webView.addJavascriptInterface(
            object {
                @JavascriptInterface
                fun onToken(token: String) = finish { if (cont.isActive) cont.resume(token) }

                @JavascriptInterface
                fun onError(code: String) = finish {
                    if (cont.isActive) cont.resumeWithException(BotCheckException("Turnstile error $code"))
                }
            },
            BRIDGE,
        )
        cont.invokeOnCancellation { finish {} }
        webView.loadDataWithBaseURL(pageBaseUrl, html(siteKey), "text/html", "utf-8", null)
    }

    private fun html(key: String): String {
        val safeKey = key.filter { it.isLetterOrDigit() || it == '_' || it == '-' }
        return """
            <!doctype html>
            <html><head><meta name="viewport" content="width=device-width,initial-scale=1">
            <script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=judgeReady" async defer onerror="$BRIDGE.onError('load')"></script>
            <script>
              function judgeReady() {
                turnstile.render('#w', {
                  sitekey: '$safeKey',
                  appearance: 'interaction-only',
                  callback: function (t) { $BRIDGE.onToken(t); },
                  'error-callback': function (c) { $BRIDGE.onError(String(c)); return true; },
                  'unsupported-callback': function () { $BRIDGE.onError('unsupported'); },
                  'before-interactive-callback': function () { $BRIDGE.onError('interactive'); }
                });
              }
            </script></head>
            <body><div id="w"></div></body></html>
        """.trimIndent()
    }

    private companion object {
        const val BRIDGE = "JudgeBridge"
    }
}
