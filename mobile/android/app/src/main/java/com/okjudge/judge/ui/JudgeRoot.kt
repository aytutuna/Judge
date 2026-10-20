package com.okjudge.judge.ui

import android.content.Context
import androidx.browser.customtabs.CustomTabColorSchemeParams
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.navigation3.rememberViewModelStoreNavEntryDecorator
import androidx.lifecycle.createSavedStateHandle
import androidx.navigation3.runtime.NavBackStack
import androidx.navigation3.runtime.NavKey
import androidx.navigation3.runtime.entryProvider
import androidx.navigation3.runtime.rememberNavBackStack
import androidx.navigation3.runtime.rememberSaveableStateHolderNavEntryDecorator
import androidx.navigation3.ui.NavDisplay
import com.okjudge.judge.AppContainer
import com.okjudge.judge.core.session.VerdictFlow
import com.okjudge.judge.i18n.AppLang
import com.okjudge.judge.i18n.LangPref
import com.okjudge.judge.i18n.LocalLang
import com.okjudge.judge.i18n.LocalStrings
import com.okjudge.judge.i18n.deviceLanguageTag
import com.okjudge.judge.ui.components.JudgeIcons
import com.okjudge.judge.ui.history.HistoryScreen
import com.okjudge.judge.ui.history.HistoryViewModel
import com.okjudge.judge.ui.home.HomeScreen
import com.okjudge.judge.ui.home.HomeViewModel
import com.okjudge.judge.ui.judging.JudgingScreen
import com.okjudge.judge.ui.judging.rememberReducedMotion
import com.okjudge.judge.ui.settings.SettingsScreen
import com.okjudge.judge.ui.theme.JudgeTheme
import com.okjudge.judge.ui.theme.JudgeType
import com.okjudge.judge.ui.theme.Palette
import com.okjudge.judge.ui.verdict.VerdictRoute
import com.okjudge.judge.ui.verdict.VerdictViewModel
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable

@Serializable data object HomeKey : NavKey
@Serializable data object JudgingKey : NavKey
@Serializable data class VerdictKey(val id: String, val fresh: Boolean) : NavKey
@Serializable data object HistoryKey : NavKey
@Serializable data object SettingsKey : NavKey

private enum class Tab { NEW, HISTORY, SETTINGS }

/** App shell: language, theme, the back stack and the bottom bar. */
@Composable
fun JudgeRoot(container: AppContainer) {
    val langPref by container.settings.langPref.collectAsStateWithLifecycle(initialValue = LangPref.SYSTEM)
    val configuration = LocalConfiguration.current
    val deviceTag = remember(configuration) { deviceLanguageTag() }
    val lang = langPref.resolve(deviceTag)
    val strings = remember(lang) { container.strings.of(lang) }
    val scope = rememberCoroutineScope()
    val toggleLang: () -> Unit = {
        scope.launch { container.settings.setLangPref(if (lang == AppLang.EN) LangPref.TR else LangPref.EN) }
    }

    CompositionLocalProvider(LocalLang provides lang, LocalStrings provides strings) {
        JudgeTheme {
            val backStack = rememberNavBackStack(HomeKey)
            var clearDraft by rememberSaveable { mutableStateOf(false) }
            val context = LocalContext.current
            val top = backStack.lastOrNull()
            val tab = when {
                backStack.any { it is HistoryKey } -> Tab.HISTORY
                backStack.any { it is SettingsKey } -> Tab.SETTINGS
                else -> Tab.NEW
            }

            Scaffold(
                containerColor = Palette.ivory,
                bottomBar = {
                    if (top !is JudgingKey) {
                        BottomBar(tab) { selected ->
                            backStack.resetTo(
                                when (selected) {
                                    Tab.NEW -> listOf(HomeKey)
                                    Tab.HISTORY -> listOf(HomeKey, HistoryKey)
                                    Tab.SETTINGS -> listOf(HomeKey, SettingsKey)
                                },
                            )
                        }
                    }
                },
            ) { padding ->
                NavDisplay(
                    backStack = backStack,
                    modifier = Modifier.padding(padding).consumeWindowInsets(padding),
                    onBack = { if (backStack.size > 1) backStack.removeAt(backStack.lastIndex) },
                    entryDecorators = listOf(
                        rememberSaveableStateHolderNavEntryDecorator(),
                        rememberViewModelStoreNavEntryDecorator(),
                    ),
                    entryProvider = entryProvider {
                        entry<HomeKey> {
                            val vm = viewModel { HomeViewModel(createSavedStateHandle(), container.settings, container.verdictFlow) }
                            val state by vm.state.collectAsStateWithLifecycle()
                            LaunchedEffect(clearDraft) {
                                if (clearDraft) {
                                    vm.clear()
                                    clearDraft = false
                                }
                            }
                            HomeScreen(
                                state = state,
                                onArgumentChange = vm::onArgumentChange,
                                onExample = vm::onExample,
                                onPreset = vm::onPreset,
                                onSubmit = { if (vm.submit(lang)) backStack.add(JudgingKey) },
                                onDismissError = vm::dismissError,
                                onToggleLang = toggleLang,
                                onOpenPrivacy = { openLink(context, "${container.config.shareBaseUrl.trimEnd('/')}/privacy") },
                            )
                        }
                        entry<JudgingKey> {
                            JudgingEntry(
                                flow = container.verdictFlow,
                                onDone = { id ->
                                    backStack.removeAll { it is JudgingKey }
                                    backStack.add(VerdictKey(id, fresh = true))
                                },
                                onLeave = { backStack.removeAll { it is JudgingKey } },
                            )
                        }
                        entry<VerdictKey> { key ->
                            val vm = viewModel(key = "verdict-${key.id}") {
                                VerdictViewModel(key.id, container.history, container.api)
                            }
                            VerdictRoute(
                                id = key.id,
                                viewModel = vm,
                                shareBaseUrl = container.config.shareBaseUrl,
                                onBack = if (key.fresh) null else ({ backStack.removeAt(backStack.lastIndex) }),
                                onJudgeAnother = if (key.fresh) ({
                                    clearDraft = true
                                    backStack.resetTo(listOf(HomeKey))
                                }) else null,
                                onToggleLang = toggleLang,
                            )
                        }
                        entry<HistoryKey> {
                            val vm = viewModel { HistoryViewModel(container.history) }
                            val items by vm.items.collectAsStateWithLifecycle()
                            HistoryScreen(
                                items = items,
                                onOpen = { id -> backStack.add(VerdictKey(id, fresh = false)) },
                                onDelete = vm::delete,
                                onDeleteAll = vm::deleteAll,
                                onToggleLang = toggleLang,
                            )
                        }
                        entry<SettingsKey> {
                            SettingsScreen(
                                langPref = langPref,
                                versionName = container.config.versionName,
                                onLangPref = { pref -> scope.launch { container.settings.setLangPref(pref) } },
                                onToggleLang = toggleLang,
                                onOpenLink = { openLink(context, it) },
                                siteBaseUrl = container.config.shareBaseUrl,
                            )
                        }
                    },
                )
            }
        }
    }
}

@Composable
private fun JudgingEntry(flow: VerdictFlow, onDone: (String) -> Unit, onLeave: () -> Unit) {
    val state by flow.state.collectAsStateWithLifecycle()
    val reduced = rememberReducedMotion()
    val startedAt = remember { (state as? VerdictFlow.State.Running)?.startedAt ?: System.currentTimeMillis() }
    val current = state
    LaunchedEffect(current) {
        when (current) {
            is VerdictFlow.State.Failed -> {
                flow.acknowledge()
                onLeave()
            }
            VerdictFlow.State.Idle -> onLeave()
            else -> Unit
        }
    }
    val outcome = (current as? VerdictFlow.State.Succeeded)?.outcome
    JudgingScreen(
        done = outcome != null,
        result = outcome?.result?.result,
        startedAt = startedAt,
        reducedMotion = reduced,
        onFinished = {
            if (outcome != null) {
                flow.acknowledge()
                onDone(outcome.id)
            }
        },
        onCancel = {
            flow.cancel()
            onLeave()
        },
    )
}

@Composable
private fun BottomBar(selected: Tab, onSelect: (Tab) -> Unit) {
    val s = LocalStrings.current
    NavigationBar(containerColor = Palette.paper, tonalElevation = 0.dp) {
        val colors = NavigationBarItemDefaults.colors(
            selectedIconColor = Palette.ink,
            selectedTextColor = Palette.ink,
            indicatorColor = Palette.terraTint,
            unselectedIconColor = Palette.muted,
            unselectedTextColor = Palette.muted,
        )
        listOf(
            Triple(Tab.NEW, s.appTabNew, JudgeIcons.plus(Palette.ink)),
            Triple(Tab.HISTORY, s.appTabHistory, JudgeIcons.list(Palette.ink)),
            Triple(Tab.SETTINGS, s.appTabSettings, JudgeIcons.gear(Palette.ink)),
        ).forEach { (tab, label, icon) ->
            NavigationBarItem(
                selected = tab == selected,
                onClick = { onSelect(tab) },
                icon = { Icon(icon, contentDescription = null) },
                label = { Text(label, style = JudgeType.material.labelMedium) },
                colors = colors,
            )
        }
    }
}

private fun NavBackStack<NavKey>.resetTo(keys: List<NavKey>) {
    if (toList() == keys) return
    clear()
    addAll(keys)
}

fun openLink(context: Context, url: String) {
    val params = CustomTabColorSchemeParams.Builder().setToolbarColor(android.graphics.Color.rgb(0xF6, 0xF1, 0xE9)).build()
    runCatching {
        CustomTabsIntent.Builder().setDefaultColorSchemeParams(params).build().launchUrl(context, url.toUri())
    }
}
