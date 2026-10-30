package com.okjudge.judge

import android.content.Intent
import android.content.res.Configuration
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.ui.graphics.toArgb
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.lifecycle.lifecycleScope
import com.okjudge.judge.ui.JudgeRoot
import com.okjudge.judge.ui.theme.DarkPalette
import com.okjudge.judge.ui.theme.LightPalette
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    /** An okjudge.com link the app was opened with, until the app shell has handled it. */
    private val links = MutableStateFlow<Uri?>(null)

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        links.value = intent.data
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        val splash = installSplashScreen()
        super.onCreate(savedInstanceState)
        val container = (application as JudgeApp).container

        // Hold the splash until the language and appearance settings are
        // read, so the first frame is already in the right language and theme.
        var ready = false
        splash.setKeepOnScreenCondition { !ready }
        lifecycleScope.launch {
            container.settings.langPref.first()
            container.settings.appearance.first()
            ready = true
        }

        systemBars((resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES)
        if (savedInstanceState == null) links.value = intent?.data
        setContent { JudgeRoot(container, links, onLinkHandled = { links.value = null }, onDark = ::systemBars) }
    }

    override fun onStart() {
        super.onStart()
        (application as JudgeApp).container.analytics.becameActive()
    }

    override fun onStop() {
        super.onStop()
        (application as JudgeApp).container.analytics.enteredBackground()
    }

    private fun systemBars(dark: Boolean) {
        val style = if (dark) {
            SystemBarStyle.dark(DarkPalette.ivory.toArgb())
        } else {
            LightPalette.ivory.toArgb().let { SystemBarStyle.light(it, it) }
        }
        enableEdgeToEdge(statusBarStyle = style, navigationBarStyle = style)
    }
}
