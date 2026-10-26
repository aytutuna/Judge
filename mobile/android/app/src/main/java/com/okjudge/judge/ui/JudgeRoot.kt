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
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
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
import com.okjudge.judge.ui.cases.CaseActions
import com.okjudge.judge.ui.cases.CaseListViewModel
import com.okjudge.judge.ui.cases.CaseLoadStatus
import com.okjudge.judge.ui.cases.CaseScreen
import com.okjudge.judge.ui.cases.CaseViewModel
import com.okjudge.judge.ui.verdict.copyLink
import com.okjudge.judge.ui.verdict.shareUrl
import com.okjudge.judge.ui.verdict.shareVerdict
import android.content.Intent
import android.net.Uri
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import com.okjudge.judge.ui.premium.ClarifyScreen
import com.okjudge.judge.ui.premium.PricingScreen
import com.okjudge.judge.ui.premium.StoreUi
import com.okjudge.judge.core.purchases.PurchaseController
import com.okjudge.judge.core.model.PricingInfo
import com.okjudge.judge.core.premium.Tier
import com.okjudge.judge.ui.judging.JudgingScreen
import com.okjudge.judge.ui.judging.rememberReducedMotion
import com.okjudge.judge.ui.settings.RestoreUi
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
/** [argument]: what a fresh verdict judged, shown above it as the thread. */
@Serializable data class VerdictKey(val id: String, val fresh: Boolean, val argument: String? = null) : NavKey
@Serializable data object HistoryKey : NavKey
@Serializable data object SettingsKey : NavKey
@Serializable data object ClarifyKey : NavKey
@Serializable data object PricingKey : NavKey
@Serializable data class CaseKey(val id: String) : NavKey

/** Sign-in; [thenVerdict] when it was opened by "Get the verdict", which goes on after signing in. */
@Serializable data class SignInKey(val thenVerdict: Boolean) : NavKey

private enum class Tab { NEW, HISTORY, SETTINGS }

/** App shell: language, theme, the back stack, the bottom bar and the sign-in gate. */
@Composable
fun JudgeRoot(container: AppContainer, links: StateFlow<Uri?> = MutableStateFlow(null), onLinkHandled: () -> Unit = {}) {
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
            // The tier the user saw when they tapped "Get the verdict" signed out (always free then).
            var tierAtTap by rememberSaveable { mutableStateOf(Tier.FREE) }
            val context = LocalContext.current
            val account = container.account
            val snackbar = remember { SnackbarHostState() }
            val currentStrings by rememberUpdatedState(strings)
            LaunchedEffect(container.verdictFlow) {
                // Premium moves on by itself: questions first, then the judging screen.
                container.verdictFlow.navigation.collect { nav ->
                    when (nav) {
                        VerdictFlow.Nav.Clarify -> if (backStack.none { it is ClarifyKey }) backStack.add(ClarifyKey)
                        VerdictFlow.Nav.Judging -> {
                            backStack.removeAll { it is ClarifyKey }
                            if (backStack.none { it is JudgingKey }) backStack.add(JudgingKey)
                        }
                        is VerdictFlow.Nav.Case -> {
                            // The form's work is now the case: it starts empty next time.
                            clearDraft = true
                            backStack.removeAll { it is ClarifyKey }
                            backStack.add(CaseKey(nav.id))
                            container.verdictFlow.caseOpened()
                        }
                    }
                }
            }
            val link by links.collectAsStateWithLifecycle()
            LaunchedEffect(link) {
                when (val target = link?.let { DeepLinks.parse(it.toString()) }) {
                    is DeepLinks.Target.Case -> if (backStack.lastOrNull() != CaseKey(target.id)) backStack.add(CaseKey(target.id))
                    // Invites are answered on the website: the app only passes them on.
                    is DeepLinks.Target.Invite -> openLink(context, target.url)
                    null -> Unit
                }
                if (link != null) onLinkHandled()
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
            val clarifyOpen = backStack.any { it is ClarifyKey }
            LaunchedEffect(clarifyOpen) {
                // Questions left behind another way (a tab, a link) are dropped with their screen.
                if (!clarifyOpen) container.verdictFlow.leaveClarify()
            }
            val top = backStack.lastOrNull()
            val tab = when {
                backStack.any { it is HistoryKey } -> Tab.HISTORY
                backStack.any { it is SettingsKey } -> Tab.SETTINGS
                else -> Tab.NEW
            }

            Scaffold(
                containerColor = if (top is HomeKey) Palette.ivory2 else Palette.ivory,
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
                                    recent = container.history.observeAll(),
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
                                    // Only the request the user saw goes out by itself: if signing in made
                                    // Premium the effective tier or brought back "Both sides", they choose again.
                                    if (account.isSignedIn && state.tier == tierAtTap && !state.twoSided && vm.submit(lang) == Submitted.JUDGING) {
                                        backStack.add(JudgingKey)
                                    }
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
                                            tierAtTap = state.tier
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
                                onCaseMode = vm::onCaseMode,
                                onDisplayName = vm::onDisplayName,
                                onOpenVerdict = { id -> backStack.add(VerdictKey(id, fresh = false)) },
                                onAllVerdicts = { backStack.resetTo(listOf(HomeKey, HistoryKey)) },
                            )
                        }
                        entry<JudgingKey> {
                            JudgingEntry(
                                flow = container.verdictFlow,
                                onDone = { id, argument ->
                                    backStack.removeAll { it is JudgingKey }
                                    backStack.add(VerdictKey(id, fresh = true, argument = argument))
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
                            val purchases = container.purchases
                            val store by purchases.state.collectAsStateWithLifecycle()
                            LaunchedEffect(Unit) {
                                purchases.refresh()
                                account.refresh()
                            }
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
                                store = StoreUi(
                                    available = store.available,
                                    offers = if (purchases.isReady(store)) store.offers else emptyMap(),
                                    buying = store.buying,
                                    notice = store.notice,
                                    subscriptionPending = PurchaseController.subscriptionPending(store, signedIn?.me?.entitlement),
                                ),
                                onBuy = { productId -> purchases.buy(context, productId) },
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
                            val accountState by account.state.collectAsStateWithLifecycle()
                            val providers by account.providers.collectAsStateWithLifecycle()
                            val config = (providers as? Account.Providers.Ready)?.config
                            val casesOn = accountState is Account.State.SignedIn && config?.features?.cases == true
                            val cases = if (casesOn) {
                                val listVm = viewModel { CaseListViewModel(container.api) }
                                LaunchedEffect(Unit) { listVm.reload() }
                                listVm.state.collectAsStateWithLifecycle().value to listVm
                            } else {
                                null
                            }
                            HistoryScreen(
                                items = items,
                                onOpen = { id -> backStack.add(VerdictKey(id, fresh = false)) },
                                onDelete = vm::delete,
                                onDeleteAll = vm::deleteAll,
                                onToggleLang = toggleLang,
                                cases = cases?.first,
                                onOpenCase = { id -> backStack.add(CaseKey(id)) },
                                onRetryCases = { cases?.second?.reload() },
                            )
                        }
                        entry<CaseKey> { key ->
                            val vm = viewModel(key = "case-${key.id}") {
                                CaseViewModel(
                                    key.id, container.api, container.caseNames,
                                    onEntitlement = { account.applyEntitlement(it) },
                                    refreshAccount = { account.refresh() },
                                )
                            }
                            val state by vm.state.collectAsStateWithLifecycle()
                            val accountState by account.state.collectAsStateWithLifecycle()
                            val providers by account.providers.collectAsStateWithLifecycle()
                            val signedIn = accountState is Account.State.SignedIn
                            LaunchedEffect(signedIn) {
                                // Signed in from the case screen: read it again.
                                if (signedIn && state.status == CaseLoadStatus.SIGNIN) vm.reload()
                            }
                            val shareBase = container.config.shareBaseUrl
                            CaseScreen(
                                state = state,
                                evidenceOn = (providers as? Account.Providers.Ready)?.config?.features?.evidence == true,
                                reducedMotion = rememberReducedMotion(),
                                actions = CaseActions(
                                    onBack = if (backStack.size > 1) ({ backStack.removeAt(backStack.lastIndex) }) else null,
                                    onToggleLang = toggleLang,
                                    onReload = vm::reload,
                                    onSignIn = { if (backStack.lastOrNull() !is SignInKey) backStack.add(SignInKey(thenVerdict = false)) },
                                    onPricing = { if (backStack.lastOrNull() !is PricingKey) backStack.add(PricingKey) },
                                    onStartOver = {
                                        clearDraft = true
                                        backStack.resetTo(listOf(HomeKey))
                                    },
                                    onJudgeNow = { vm.judge(onlyMine = true) },
                                    onRetry = { vm.judge(onlyMine = false) },
                                    onResetInvite = vm::resetInvite,
                                    onRemove = vm::remove,
                                    onCopyInvite = { copyLink(context, it) },
                                    onShareInvite = { shareInvite(context, currentStrings.appShareTitle, currentStrings.caseInviteShareText, it) },
                                    onOverlayFinished = vm::finishOverlay,
                                    onAppealText = vm::onAppealText,
                                    onAddAppealEvidence = vm::onAddAppealEvidence,
                                    onRemoveAppealEvidence = vm::onRemoveAppealEvidence,
                                    onSubmitAppeal = vm::submitAppeal,
                                    onTypedName = vm::onTypedName,
                                    onSaveName = vm::saveDisplayName,
                                    onNamesVisible = vm::setNamesVisible,
                                    onShareVerdict = { id, headline ->
                                        shareVerdict(context, currentStrings.appShareTitle, headline, currentStrings.shareText, shareUrl(shareBase, id))
                                    },
                                    onCopyVerdict = { id -> copyLink(context, shareUrl(shareBase, id)) },
                                ),
                            )
                        }
                        entry<SettingsKey> {
                            val accountState by account.state.collectAsStateWithLifecycle()
                            val accountBusy by account.working.collectAsStateWithLifecycle()
                            val providers by account.providers.collectAsStateWithLifecycle()
                            val purchases = container.purchases
                            val store by purchases.state.collectAsStateWithLifecycle()
                            val purchasesOn = (providers as? Account.Providers.Ready)?.config?.pricing?.purchasesEnabled == true
                            LaunchedEffect(Unit) {
                                purchases.refresh()
                                account.refresh()
                            }
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
                                restore = if (purchasesOn && purchases.isReady(store)) RestoreUi(store.restoring, store.restoreNotice) else null,
                                onRestore = { purchases.restore() },
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
private fun JudgingEntry(flow: VerdictFlow, onDone: (String, String?) -> Unit, onLeave: () -> Unit) {
    val state by flow.state.collectAsStateWithLifecycle()
    val reduced = rememberReducedMotion()
    val startedAt = remember { (state as? VerdictFlow.State.Running)?.startedAt ?: System.currentTimeMillis() }
    val argument = remember { (state as? VerdictFlow.State.Running)?.argument?.takeIf { it.isNotEmpty() } }
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
        argument = argument,
        onFinished = {
            if (outcome != null) {
                flow.acknowledge()
                onDone(outcome.id, argument)
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

/** The invite link through the share sheet, with the web's share text. */
fun shareInvite(context: Context, chooserTitle: String, shareText: String, url: String) {
    val send = Intent(Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(Intent.EXTRA_TEXT, "$shareText\n$url")
    }
    runCatching { context.startActivity(Intent.createChooser(send, chooserTitle).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
}

/** okjudge.com links the app is opened with: /c/{id} opens the case, /r/{token} goes to the website. */
object DeepLinks {
    sealed interface Target {
        data class Case(val id: String) : Target
        data class Invite(val url: String) : Target
    }

    private val ID = Regex("^[A-Za-z0-9_-]{1,64}$")

    const val HOST = "okjudge.com"

    fun parse(url: String): Target? {
        val u = url.toHttpUrlOrNull() ?: return null
        // The activity is exported: only the site's own links are followed.
        if (u.scheme != "https" || u.host != HOST) return null
        val segments = u.pathSegments.filter { it.isNotEmpty() }
        if (segments.size != 2) return null
        return when (segments[0]) {
            "c" -> segments[1].takeIf { ID.matches(it) }?.let { Target.Case(it) }
            "r" -> if (ID.matches(segments[1])) Target.Invite(u.toString()) else null
            else -> null
        }
    }
}

