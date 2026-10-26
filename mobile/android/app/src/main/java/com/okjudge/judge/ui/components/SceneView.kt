package com.okjudge.judge.ui.components

import android.annotation.SuppressLint
import android.graphics.Color
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.okjudge.judge.core.display.SceneMode
import com.okjudge.judge.core.display.VerdictDisplay
import com.okjudge.judge.ui.theme.Palette

/** False where a WebView draws nothing (Robolectric tests): the flat balance stands in. */
val LocalSceneLive = staticCompositionLocalOf { true }

val SceneShape = RoundedCornerShape(18.dp)

private const val SCENE_URL = "file:///android_asset/scene/index.html"

/**
 * The web's three.js balance (assets/scene, built by mobile/shared/scene) in
 * a web view, driven through `window.judgeScene`. Decorative: the captions
 * around it carry the meaning. Touches go past it to the scrolling page.
 */
@Composable
fun SceneView(mode: SceneMode, reducedMotion: Boolean, modifier: Modifier = Modifier) {
    val live = LocalSceneLive.current && !LocalInspectionMode.current
    var gone by remember { mutableStateOf(false) }
    Box(modifier.clip(SceneShape).background(Palette.paper).clearAndSetSemantics { }) {
        if (live && !gone) {
            SceneWebView(mode, reducedMotion, onGone = { gone = true }, Modifier.fillMaxSize())
        } else {
            val angle = if (mode is SceneMode.Verdict) VerdictDisplay.svgRotateDeg(mode.tugA).toFloat() else 0f
            Balance(angle, Modifier.fillMaxSize().padding(horizontal = 32.dp, vertical = 24.dp))
        }
        Box(Modifier.matchParentSize().pointerInput(Unit) {})
    }
}

private class SceneEvents(private val handle: (String) -> Unit) {
    @JavascriptInterface
    fun onEvent(type: String) = handle(type)
}

@SuppressLint("SetJavaScriptEnabled")
@Composable
private fun SceneWebView(mode: SceneMode, reducedMotion: Boolean, onGone: () -> Unit, modifier: Modifier) {
    val context = LocalContext.current
    val gone by rememberUpdatedState(onGone)
    var loaded by remember { mutableStateOf(false) }
    // WebGL can drop its context in the background; the page then shows its flat fallback until reloaded.
    var lost by remember { mutableStateOf(false) }
    val web = remember {
        WebView(context).apply {
            setBackgroundColor(Color.TRANSPARENT)
            isVerticalScrollBarEnabled = false
            isHorizontalScrollBarEnabled = false
            overScrollMode = View.OVER_SCROLL_NEVER
            isFocusable = false
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
            settings.javaScriptEnabled = true
            settings.setSupportZoom(false)
            settings.builtInZoomControls = false
            settings.displayZoomControls = false
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            addJavascriptInterface(SceneEvents { type -> post { if (type == "lost") lost = true } }, "JudgeScene")
            webViewClient = object : WebViewClient() {
                override fun onPageFinished(view: WebView, url: String) {
                    loaded = true
                }

                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest) = true

                override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                    gone()
                    return true
                }
            }
            loadUrl(SCENE_URL)
        }
    }

    LaunchedEffect(loaded, mode, reducedMotion) {
        if (!loaded) return@LaunchedEffect
        if (reducedMotion) web.evaluateJavascript("window.judgeScene.setReduced(true)", null)
        web.evaluateJavascript("window.judgeScene.setMode(${mode.json()})", null)
    }

    val lifecycle = LocalLifecycleOwner.current.lifecycle
    DisposableEffect(lifecycle, web) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_PAUSE -> web.onPause()
                Lifecycle.Event.ON_RESUME -> {
                    web.onResume()
                    if (lost) {
                        lost = false
                        loaded = false
                        web.reload()
                    }
                }
                else -> Unit
            }
        }
        lifecycle.addObserver(observer)
        onDispose {
            lifecycle.removeObserver(observer)
            web.stopLoading()
            web.destroy()
        }
    }

    AndroidView(factory = { web }, modifier = modifier)
}
