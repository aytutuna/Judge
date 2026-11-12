package com.okjudge.judge.ui.components

import android.annotation.SuppressLint
import android.graphics.Color
import android.view.View
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.Image
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
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
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.res.imageResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.okjudge.judge.R
import com.okjudge.judge.core.display.CourtScene
import com.okjudge.judge.ui.theme.Palette

/** Whether the court is shown at all (the Gamify setting); the shell provides it. */
val LocalGamify = staticCompositionLocalOf { true }

private val CourtShape = RoundedCornerShape(16.dp)

private const val COURT_URL = "file:///android_asset/court/index.html"

/**
 * The street court (assets/court, built by mobile/shared/scene) in a web
 * view, driven through `window.judgeCourt`. Decorative: the log under it
 * carries the meaning. Touches go past it to the scrolling page. The empty
 * court is drawn behind the clear web view, so there is no gap before it paints.
 */
@Composable
fun CourtView(scene: CourtScene, reducedMotion: Boolean, modifier: Modifier = Modifier) {
    val live = LocalSceneLive.current && !LocalInspectionMode.current
    var gone by remember { mutableStateOf(false) }
    Box(modifier.clip(CourtShape).border(1.dp, Palette.line, CourtShape).clearAndSetSemantics { }) {
        Image(
            ImageBitmap.imageResource(R.drawable.court_ground),
            contentDescription = null,
            modifier = Modifier.fillMaxSize(),
            contentScale = ContentScale.FillBounds,
            filterQuality = FilterQuality.None,
        )
        if (live && !gone) CourtWebView(scene, reducedMotion, onGone = { gone = true }, Modifier.fillMaxSize())
        Box(Modifier.matchParentSize().pointerInput(Unit) {})
    }
}

@SuppressLint("SetJavaScriptEnabled")
@Composable
private fun CourtWebView(scene: CourtScene, reducedMotion: Boolean, onGone: () -> Unit, modifier: Modifier) {
    val context = LocalContext.current
    val gone by rememberUpdatedState(onGone)
    var loaded by remember { mutableStateOf(false) }
    // No WebView provider, or one being updated, throws here.
    val web = remember {
        runCatching { WebView(context) }.getOrNull()?.apply {
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
            loadUrl(COURT_URL)
        }
    }
    if (web == null) {
        LaunchedEffect(Unit) { gone() }
        return
    }

    LaunchedEffect(loaded, scene, reducedMotion) {
        if (!loaded) return@LaunchedEffect
        web.evaluateJavascript("window.judgeCourt.setReduced($reducedMotion)", null)
        web.evaluateJavascript("window.judgeCourt.set(${scene.json()})", null)
    }

    val lifecycle = LocalLifecycleOwner.current.lifecycle
    DisposableEffect(lifecycle, web) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_PAUSE -> web.onPause()
                Lifecycle.Event.ON_RESUME -> web.onResume()
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
