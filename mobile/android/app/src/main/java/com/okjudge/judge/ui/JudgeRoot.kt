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
import androidx.compose.material3.Snackbar
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
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
import com.okjudge.judge.core.auth.Account
import com.okjudge.judge.core.session.VerdictFlow
import com.okjudge.judge.i18n.AppLang
import com.okjudge.judge.i18n.LangPref
import com.okjudge.judge.i18n.LocalLang
import com.okjudge.judge.i18n.LocalStrings
import com.okjudge.judge.i18n.Strings
import com.okjudge.judge.i18n.deviceLanguageTag
import com.okjudge.judge.ui.components.JudgeIcons
import com.okjudge.judge.ui.history.HistoryScreen
import com.okjudge.judge.ui.history.HistoryViewModel
import com.okjudge.judge.ui.home.HomeScreen
import com.okjudge.judge.ui.home.HomeViewModel
import com.okjudge.judge.ui.home.Submitted
import com.okjudge.judge.ui.premium.ClarifyScreen
import com.okjudge.judge.ui.premium.PricingScreen
import com.okjudge.judge.core.model.PricingInfo
import com.okjudge.judge.core.premium.Tier
import com.okjudge.judge.ui.judging.JudgingScreen
import com.okjudge.judge.ui.judging.rememberReducedMotion
import com.okjudge.judge.ui.settings.SettingsScreen
import com.okjudge.judge.ui.signin.SignInActions
import com.okjudge.judge.ui.signin.SignInScreen
import com.okjudge.judge.ui.signin.SignInViewModel
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
@Serializable data object ClarifyKey : NavKey
@Serializable data object PricingKey : NavKey

/** Sign-in; [thenVerdict] when it was opened by "Get the verdict", which goes on after signing in. */
@Serializable data class SignInKey(val thenVerdict: Boolean) : NavKey

private enum class Tab { NEW, HISTORY, SETTINGS }

/** App shell: language, theme, the back stack, the bottom bar and the sign-in gate. */
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
            var submitAfterSignIn by rememberSaveable { mutableStateOf(false) }
            val context = LocalContext.current
            val account = container.account
            val snackbar = remember { SnackbarHostState() }
            val currentStrings by rememberUpdatedState(strings)
            LaunchedEffect(container.verdictFlow) {
                // Premium moves on by itself: questions first, then the judging screen.
                container.verdictFlow.navigation.collect { nav ->
                    when (nav) {
                        VerdictFlow.Nav.CLARIFY -> if (backStack.none { it is ClarifyKey }) backStack.add(ClarifyKey)
                        VerdictFlow.Nav.JUDGING -> {
                            backStack.removeAll { it is ClarifyKey }
                            if (backStack.none { it is JudgingKey }) backStack.add(JudgingKey)
                        }
                    }
                }
            }
            LaunchedEffect(account) {
                // The tier switch and the pricing screen read /config.
                account.loadProviders()
                // A session that ended on the server while the app was closed shows up here.
                launch { account.refresh() }
                account.notices.collect { notice ->
                    if (notice == Account.Notice.SESSION_EXPIRED) {
                        val onTop = backStack.lastOrNull()
                        if (onTop !is SignInKey && onTop !is JudgingKey) backStack.add(SignInKey(thenVerdict = false))
                    }
                    launch { snackbar.showSnackbar(noticeText(currentStrings, notice)) }
                }
            }
            val top = backStack.lastOrNull()
            val tab = when {
                backStack.any { it is HistoryKey } -> Tab.HISTORY
                backStack.any { it is SettingsKey } -> Tab.SETTINGS
                else -> Tab.NEW
            }

            Scaffold(
                containerColor = Palette.ivory,
                snackbarHost = {
                    SnackbarHost(snackbar) { data ->
                        Snackbar(data, containerColor = Palette.ink, contentColor = Palette.ivory)
                    }
                },
                bottomBar = {
                    if (top !is JudgingKey && top !is SignInKey && top !is ClarifyKey) {
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
                            val vm = viewModel {
                                HomeViewModel(
                                    createSavedStateHandle(),
                                    container.settings,
                                    container.verdictFlow,
                                    accountState = account.state,
                                    providers = account.providers,
                                    uploadEvidence = container.api::uploadEvidence,
                                )
                            }
                            val state by vm.state.collectAsStateWithLifecycle()
                            LaunchedEffect(clearDraft) {
                                if (clearDraft) {
                                    vm.clear()
                                    clearDraft = false
                                }
                            }
                            LaunchedEffect(submitAfterSignIn) {
                                if (submitAfterSignIn) {
                                    submitAfterSignIn = false
                                    if (account.isSignedIn && vm.submit(lang) == Submitted.JUDGING) backStack.add(JudgingKey)
                                }
                            }
                            HomeScreen(
                                state = state,
                                onArgumentChange = vm::onArgumentChange,
                                onExample = vm::onExample,
                                onPreset = vm::onPreset,
                                onSubmit = {
                                    // Every verdict needs an account: sign in first, then go on.
                                    if (!account.isSignedIn) {
                                        if (state.canSubmit && backStack.lastOrNull() !is SignInKey) {
                                            backStack.add(SignInKey(thenVerdict = true))
                                        }
                                    } else if (vm.submit(lang) == Submitted.JUDGING) {
                                        backStack.add(JudgingKey)
                                    }
                                },
                                onDismissError = vm::dismissError,
                                onToggleLang = toggleLang,
                                onOpenPrivacy = { openLink(context, "${container.config.shareBaseUrl.trimEnd('/')}/privacy") },
                                onTier = vm::onTier,
                                onPremiumIntent = { vm.onTier(Tier.PREMIUM) },
                                onSignIn = { if (backStack.lastOrNull() !is SignInKey) backStack.add(SignInKey(thenVerdict = false)) },
                                onPricing = { if (backStack.lastOrNull() !is PricingKey) backStack.add(PricingKey) },
                                onAddEvidence = vm::onAddEvidence,
                                onRemoveEvidence = vm::onRemoveEvidence,
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
                        entry<ClarifyKey> {
                            val step by container.verdictFlow.premiumStep.collectAsStateWithLifecycle()
                            val clarify = step as? VerdictFlow.PremiumStep.Clarify
                            var answers by rememberSaveable { mutableStateOf(mapOf<String, String>()) }
                            LaunchedEffect(clarify == null) {
                                // Nothing to ask (e.g. after the process was restarted): back to the form.
                                if (clarify == null) backStack.removeAll { it is ClarifyKey }
                            }
                            if (clarify != null) {
                                ClarifyScreen(
                                    questions = clarify.questions,
                                    answers = answers,
                                    onAnswer = { id, value -> answers = answers + (id to value) },
                                    onSubmit = { container.verdictFlow.finishClarify(answers, skip = false) },
                                    onSkip = { container.verdictFlow.finishClarify(answers, skip = true) },
                                    onBack = {
                                        container.verdictFlow.leaveClarify()
                                        backStack.removeAll { it is ClarifyKey }
                                    },
                                    onToggleLang = toggleLang,
                                )
                            }
                        }
                        entry<PricingKey> {
                            val accountState by account.state.collectAsStateWithLifecycle()
                            val providers by account.providers.collectAsStateWithLifecycle()
                            val config = (providers as? Account.Providers.Ready)?.config
                            val signedIn = accountState as? Account.State.SignedIn
                            LaunchedEffect(Unit) { account.refresh() }
                            PricingScreen(
                                pricing = config?.pricing ?: PricingInfo(),
                                premiumEnabled = when (providers) {
                                    is Account.Providers.Ready -> config?.premiumEnabled == true
                                    Account.Providers.Failed -> false
                                    Account.Providers.Loading -> null
                                },
                                features = config?.features,
                                signedIn = signedIn != null,
                                signInOffered = config?.signInOffered == true,
                                entitlement = signedIn?.me?.entitlement,
                                onBack = { backStack.removeAll { it is PricingKey } },
                                onSignIn = { if (backStack.lastOrNull() !is SignInKey) backStack.add(SignInKey(thenVerdict = false)) },
                                onToggleLang = toggleLang,
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
                            val accountState by account.state.collectAsStateWithLifecycle()
                            val accountBusy by account.working.collectAsStateWithLifecycle()
                            LaunchedEffect(Unit) { account.refresh() }
                            SettingsScreen(
                                langPref = langPref,
                                versionName = container.config.versionName,
                                onLangPref = { pref -> scope.launch { container.settings.setLangPref(pref) } },
                                onToggleLang = toggleLang,
                                onOpenLink = { openLink(context, it) },
                                siteBaseUrl = container.config.shareBaseUrl,
                                account = accountState,
                                accountBusy = accountBusy,
                                onSignIn = { if (backStack.lastOrNull() !is SignInKey) backStack.add(SignInKey(thenVerdict = false)) },
                                onOpenPricing = { if (backStack.lastOrNull() !is PricingKey) backStack.add(PricingKey) },
                                // App scope: leaving the screen must not stop a sign-out or deletion halfway.
                                onSignOut = { container.appScope.launch { account.signOut() } },
                                onDeleteAccount = { container.appScope.launch { account.deleteAccount() } },
                            )
                        }
                        entry<SignInKey> { key ->
                            val vm = viewModel { SignInViewModel(account) }
                            val state by vm.state.collectAsStateWithLifecycle()
                            LaunchedEffect(state.done) {
                                if (state.done) {
                                    backStack.removeAll { it is SignInKey }
                                    if (key.thenVerdict) submitAfterSignIn = true
                                }
                            }
                            SignInScreen(
                                state = state,
                                onBack = { backStack.removeAll { it is SignInKey } },
                                onToggleLang = toggleLang,
                                actions = SignInActions(
                                    onGoogle = { vm.google(context) },
                                    onEmailChange = vm::onEmailChange,
                                    onRequestCode = { vm.requestCode(lang) },
                                    onCodeChange = vm::onCodeChange,
                                    onSubmitCode = vm::submitCode,
                                    onResend = { vm.resend(lang) },
                                    onChangeEmail = vm::changeEmail,
                                    onRetryProviders = vm::retryProviders,
                                    onOpenPrivacy = { openLink(context, "${container.config.shareBaseUrl.trimEnd('/')}/privacy") },
                                ),
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
    val premium = remember {
        (state as? VerdictFlow.State.Running)?.premium ?: ((state as? VerdictFlow.State.Succeeded)?.outcome?.result?.result?.premium == true)
    }
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
        premium = premium,
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

private fun noticeText(s: Strings, notice: Account.Notice): String = when (notice) {
    Account.Notice.SIGNED_OUT -> s.appAccountSignedOut
    Account.Notice.SESSION_EXPIRED -> s.appAccountSessionExpired
    Account.Notice.DELETED -> s.appAccountDeleted
    Account.Notice.DELETE_FAILED -> s.accountDeleteFailed
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
