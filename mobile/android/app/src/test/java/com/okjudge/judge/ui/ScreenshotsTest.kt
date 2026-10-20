package com.okjudge.judge.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.unit.dp
import com.github.takahirom.roborazzi.captureRoboImage
import com.okjudge.judge.Fixtures
import com.okjudge.judge.core.data.SavedVerdict
import com.okjudge.judge.core.display.Preset
import com.okjudge.judge.core.display.UiError
import com.okjudge.judge.i18n.AppLang
import com.okjudge.judge.i18n.LangPref
import com.okjudge.judge.ui.components.TopBar
import com.okjudge.judge.ui.history.HistoryScreen
import com.okjudge.judge.ui.home.HomeScreen
import com.okjudge.judge.ui.home.HomeUiState
import com.okjudge.judge.ui.judging.JudgingScreen
import com.okjudge.judge.ui.settings.SettingsScreen
import com.okjudge.judge.ui.verdict.TranslationStatus
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Screenshots for visual review against the web. They are written only in
 * Roborazzi record mode:
 * gradlew recordRoborazziDebug --tests "*ScreenshotsTest*" -Pjudge.shotsDir=<dir>
 * Under a plain test run they still render every screen (a smoke test).
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [36], qualifiers = "w393dp-h852dp-xxhdpi")
class ScreenshotsTest {
    @get:Rule
    val compose = createComposeRule()

    private fun capture(name: String, tall: Boolean = false, content: @Composable () -> Unit) {
        if (tall) RuntimeEnvironment.setQualifiers("+w393dp-h2900dp")
        compose.mainClock.autoAdvance = false
        compose.setContent(content)
        compose.mainClock.advanceTimeBy(5_000)
        compose.onRoot().captureRoboImage(UiTestSupport.shot(name))
    }

    private fun homeState(lang: AppLang) = HomeUiState(
        argument = UiTestSupport.s(lang).exampleHotdogText,
        preset = Preset.FAIRNESS,
    )

    @Test
    fun home_en() = capture("home_en") {
        Themed(AppLang.EN) { HomeScreen(HomeUiState(), {}, {}, {}, {}, {}, {}, {}) }
    }

    @Test
    fun home_tr_filled_withError() = capture("home_tr_error", tall = true) {
        Themed(AppLang.TR) {
            HomeScreen(homeState(AppLang.TR).copy(error = UiError.Api("rate_limited", 429, 420.0)), {}, {}, {}, {}, {}, {}, {})
        }
    }

    @Test
    fun judging_waiting() = capture("judging_waiting_en") {
        Themed(AppLang.EN) {
            JudgingScreen(done = false, result = null, startedAt = System.currentTimeMillis() - 4_000, reducedMotion = true, onFinished = {}, onCancel = {})
        }
    }

    @Test
    fun judging_final_tipsTowardTheWinner() = capture("judging_final_win_b_tr") {
        Themed(AppLang.TR) {
            JudgingScreen(done = true, result = sample("win_b_named").result.result, startedAt = 0, reducedMotion = true, onFinished = {}, onCancel = {})
        }
    }

    @Test
    fun verdicts_en() {
        for (name in Fixtures.sampleNames) renderVerdict("verdict_${name}_en", name, AppLang.EN)
    }

    @Test
    fun verdict_win_a_self_tr() = renderVerdict("verdict_win_a_self_tr", "win_a_self", AppLang.TR)

    @Test
    fun verdict_overturned_tr_tr() = renderVerdict("verdict_overturned_tr_tr", "overturned_tr", AppLang.TR)

    @Test
    fun verdict_lean_translating_tr() =
        renderVerdict("verdict_lean_loading_tr", "lean_b_majority_escalated", AppLang.TR, TranslationStatus.LOADING)

    private var verdictStarted = false
    private val current = androidx.compose.runtime.mutableStateOf<(@Composable () -> Unit)?>(null)

    private fun renderVerdict(file: String, name: String, lang: AppLang, status: TranslationStatus = TranslationStatus.ORIGINAL) {
        val outcome = sample(name)
        val content: @Composable () -> Unit = {
            Themed(lang) {
                Column(Modifier.fillMaxSize()) {
                    TopBar(onBack = null, onToggleLang = {})
                    SampleVerdict(outcome, lang, Modifier.padding(horizontal = 16.dp, vertical = 12.dp), status)
                }
            }
        }
        if (verdictStarted) {
            compose.runOnUiThread { current.value = content }
            androidx.compose.runtime.snapshots.Snapshot.sendApplyNotifications()
        } else {
            current.value = content
        }
        if (!verdictStarted) {
            verdictStarted = true
            RuntimeEnvironment.setQualifiers("+w393dp-h2900dp")
            compose.mainClock.autoAdvance = false
            compose.setContent { current.value?.invoke() }
        }
        compose.mainClock.advanceTimeBy(2_000)
        compose.onRoot().captureRoboImage(UiTestSupport.shot(file))
    }

    @Test
    fun history_en() = capture("history_en") {
        val items = listOf("win_a_self", "win_b_named", "lean_tie", "overturned_tr", "conditional").mapIndexed { i, n ->
            val o = sample(n)
            SavedVerdict(o.id, 1_760_900_000_000L - i * 86_400_000L, o.result, o.nameMap, Preset.BALANCED.id, emptyMap())
        }
        Themed(AppLang.EN) { HistoryScreen(items, {}, {}, {}, {}) }
    }

    @Test
    fun settings_tr() = capture("settings_tr") {
        Themed(AppLang.TR) { SettingsScreen(LangPref.SYSTEM, "0.1.0", {}, {}, {}, "https://okjudge.com") }
    }

    @Test
    fun brandMark_icon() = capture("brand_mark") {
        Themed(AppLang.EN) {
            Box(Modifier.width(240.dp).fillMaxWidth()) { com.okjudge.judge.ui.components.BrandMark(200.dp, Modifier.padding(20.dp)) }
        }
    }
}
