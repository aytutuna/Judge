package com.okjudge.judge

import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.lifecycle.lifecycleScope
import com.okjudge.judge.ui.JudgeRoot
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

        // Hold the splash until the language setting is read, so the first
        // frame is already in the right language.
        var ready = false
        splash.setKeepOnScreenCondition { !ready }
        lifecycleScope.launch {
            container.settings.langPref.first()
            ready = true
        }

        val ivory = Color.rgb(0xF6, 0xF1, 0xE9)
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.light(ivory, ivory),
            navigationBarStyle = SystemBarStyle.light(ivory, ivory),
        )
        if (savedInstanceState == null) links.value = intent?.data
        setContent { JudgeRoot(container, links, onLinkHandled = { links.value = null }) }
    }
}
