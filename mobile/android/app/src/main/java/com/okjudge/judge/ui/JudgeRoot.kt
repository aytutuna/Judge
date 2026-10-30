package com.okjudge.judge.ui

import android.content.Context
import androidx.browser.customtabs.CustomTabColorSchemeParams
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.foundation.isSystemInDarkTheme
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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.repeatOnLifecycle
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
import com.okjudge.judge.core.data.Appearance
import com.okjudge.judge.core.session.VerdictFlow
import com.okjudge.judge.i18n.LangPref
import com.okjudge.judge.i18n.LocalStrings
import com.okjudge.judge.i18n.ProvideLang
import com.okjudge.judge.i18n.Strings
import com.okjudge.judge.i18n.deviceLanguageTags
import com.okjudge.judge.ui.components.JudgeIcons
import com.okjudge.judge.ui.history.HistoryEntry
import com.okjudge.judge.ui.history.HistoryScreen
import com.okjudge.judge.ui.history.HistoryViewModel
import com.okjudge.judge.ui.home.HomeScreen
import com.okjudge.judge.ui.home.HomeViewModel
import com.okjudge.judge.ui.home.Submitted
import com.okjudge.judge.ui.cases.CaseActions
import com.okjudge.judge.ui.cases.CaseLoadStatus
import com.okjudge.judge.ui.cases.CaseScreen
import com.okjudge.judge.ui.cases.CaseViewModel
import com.okjudge.judge.ui.verdict.copyLink
import com.okjudge.judge.ui.verdict.shareUrl
import com.okjudge.judge.ui.verdict.shareVerdict
import android.content.Intent
import android.net.Uri
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import com.okjudge.judge.ui.premium.ClarifyScreen
import com.okjudge.judge.ui.premium.PricingScreen
import com.okjudge.judge.ui.premium.StoreUi
import com.okjudge.judge.core.purchases.PurchaseController
import com.okjudge.judge.core.model.PricingInfo
import com.okjudge.judge.ui.judging.JudgingScreen
import com.okjudge.judge.ui.judging.rememberReducedMotion
import com.okjudge.judge.ui.settings.RestoreUi
import com.okjudge.judge.ui.settings.SettingsScreen
import com.okjudge.judge.ui.signin.SignInActions
import com.okjudge.judge.ui.signin.SignInScreen
import com.okjudge.judge.ui.signin.SignInViewModel
import com.okjudge.judge.ui.theme.DarkPalette
import com.okjudge.judge.ui.theme.JudgePalette
import com.okjudge.judge.ui.theme.JudgeTheme
import com.okjudge.judge.ui.theme.JudgeType
import com.okjudge.judge.ui.theme.LightPalette
import com.okjudge.judge.ui.theme.Palette
import com.okjudge.judge.ui.verdict.VerdictAppealViewModel
import com.okjudge.judge.ui.verdict.VerdictRoute
import com.okjudge.judge.ui.verdict.VerdictViewModel
import com.okjudge.judge.core.analytics.Analytics
import com.okjudge.judge.core.display.UiError
import com.okjudge.judge.core.display.eventCode
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable

@Serializable data object HomeKey : NavKey
@Serializable data object JudgingKey : NavKey
/** [fresh]: straight from judging, without the tab bar. */
@Serializable data class VerdictKey(val id: String, val fresh: Boolean) : NavKey
@Serializable data object HistoryKey : NavKey
@Serializable data object SettingsKey : NavKey
@Serializable data object ClarifyKey : NavKey
@Serializable data object PricingKey : NavKey
/** [otherName]: who a case just created here waits for, as typed on Home. */
@Serializable data class CaseKey(val id: String, val otherName: String? = null) : NavKey

/** Sign-in; [thenVerdict] when it was opened by "Get the verdict", which goes on after signing in. */
@Serializable data class SignInKey(val thenVerdict: Boolean) : NavKey

private enum class Tab { NEW, HISTORY, SETTINGS }

/** App shell: language, theme, the back stack, the bottom bar and the sign-in gate. [onDark] hears the theme in use. */
@Composable
fun JudgeRoot(
    container: AppContainer,
    links: StateFlow<Uri?> = MutableStateFlow(null),
    onLinkHandled: () -> Unit = {},
    onDark: (Boolean) -> Unit = {},
) {
    val langPref by container.settings.langPref.collectAsStateWithLifecycle(initialValue = LangPref.SYSTEM)
    val appearance by container.settings.appearance.collectAsStateWithLifecycle(initialValue = Appearance.SYSTEM)
    val dark = appearance.isDark(isSystemInDarkTheme())
    val darkChanged by rememberUpdatedState(onDark)
    LaunchedEffect(dark) { darkChanged(dark) }
    val configuration = LocalConfiguration.current
    val appContext = LocalContext.current
    val deviceTags = remember(configuration) { deviceLanguageTags(appContext) }
    val lang = langPref.resolve(deviceTags)
    val strings = remember(lang) { container.strings.of(lang) }
    val scope = rememberCoroutineScope()

    ProvideLang(lang, strings) {
        JudgeTheme(dark = dark) {
            val backStack = rememberNavBackStack(HomeKey)
            var clearDraft by rememberSaveable { mutableStateOf(false) }
            var submitAfterSignIn by rememberSaveable { mutableStateOf(false) }
            val context = LocalContext.current
            val account = container.account
            val snackbar = remember { SnackbarHostState() }
            val currentStrings by rememberUpdatedState(strings)
            // "+": a new argument on an empty form. Leaving the judging screen this way
            // cancels it, like its own Cancel.
            val newArgument: () -> Unit = {
                if (backStack.lastOrNull() is JudgingKey) container.verdictFlow.cancel()
                clearDraft = true
                backStack.resetTo(listOf(HomeKey))
            }
            // Home's questions check or case creation would still land on the new, empty form.
            val premiumStep by container.verdictFlow.premiumStep.collectAsStateWithLifecycle()
            val creating by container.verdictFlow.creating.collectAsStateWithLifecycle()
            val onNew = newArgument.takeUnless { premiumStep == VerdictFlow.PremiumStep.Checking || creating }
            val openPricing: () -> Unit = { if (backStack.lastOrNull() !is PricingKey) backStack.add(PricingKey) }
            LaunchedEffect(container.verdictFlow) {
                // A verdict moves on by itself: questions first, then the judging screen.
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
                            backStack.add(CaseKey(nav.id, nav.otherName))
                            container.verdictFlow.caseOpened()
                        }
                        // The verdict was refused for the account: no judging screen behind the answer.
                        VerdictFlow.Nav.Pricing -> {
                            backStack.removeAll { it is ClarifyKey || it is JudgingKey }
                            openPricing()
                        }
                        VerdictFlow.Nav.SignIn -> {
                            backStack.removeAll { it is ClarifyKey || it is JudgingKey }
                            if (backStack.none { it is SignInKey }) backStack.add(SignInKey(thenVerdict = false))
                        }
                    }
                }
            }
            val link by links.collectAsStateWithLifecycle()
            LaunchedEffect(link) {
                when (val target = link?.let { DeepLinks.parse(it.toString()) }) {
                    is DeepLinks.Target.Case -> if ((backStack.lastOrNull() as? CaseKey)?.id != target.id) backStack.add(CaseKey(target.id))
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
                containerColor = Palette.ivory,
                snackbarHost = {
                    SnackbarHost(snackbar) { data ->
                        Snackbar(data, containerColor = Palette.ink, contentColor = Palette.ivory)
                    }
                },
                bottomBar = {
                    if (showsBottomBar(top)) {
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
                                    container.verdictFlow,
                                    accountState = account.state,
                                    providers = account.providers,
                                    uploadEvidence = container.api::uploadEvidence,
                                )
                            }
                            val state by vm.state.collectAsStateWithLifecycle()
                            val analytics = container.analytics
                            ScreenView(analytics, "home")
                            ErrorShown(analytics, state.error)
                            val counted: (Submitted) -> Submitted = {
                                if (it == Submitted.CHECKING || it == Submitted.CREATING) analytics.track("case_submitted")
                                it
                            }
                            LaunchedEffect(clearDraft) {
                                if (clearDraft) {
                                    vm.clear()
                                    clearDraft = false
                                }
                            }
                            LaunchedEffect(submitAfterSignIn) {
                                if (submitAfterSignIn) {
                                    submitAfterSignIn = false
                                    if (counted(vm.submit(lang, strings)) == Submitted.PRICING) openPricing()
                                }
                            }
                            HomeScreen(
                                state = state,
                                onArgumentChange = { text ->
                                    if (state.argument.isEmpty() && text.isNotEmpty()) analytics.track("case_started")
                                    vm.onArgumentChange(text)
                                },
                                onOtherSideChange = vm::onOtherSideChange,
                                onOtherName = vm::onOtherName,
                                onSubmit = {
                                    when (counted(vm.submit(lang, strings))) {
                                        // Every verdict needs an account: sign in first, then go on.
                                        Submitted.SIGN_IN -> if (backStack.lastOrNull() !is SignInKey) backStack.add(SignInKey(thenVerdict = true))
                                        Submitted.PRICING -> openPricing()
                                        else -> Unit
                                    }
                                },
                                onSendLink = { if (counted(vm.sendLink(lang)) == Submitted.PRICING) openPricing() },
                                onExample = {
                                    if (state.argument.isEmpty()) analytics.track("case_started")
                                    vm.fillExample(strings)
                                },
                                onDismissError = vm::dismissError,
                                onNew = newArgument,
                                onAddEvidence = {
                                    analytics.track("evidence_added")
                                    vm.onAddEvidence(it)
                                },
                                onRemoveEvidence = vm::onRemoveEvidence,
                                onDisplayName = vm::onDisplayName,
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
                                onNew = newArgument,
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
                                    onSubmit = {
                                        container.analytics.track("question_answered")
                                        container.verdictFlow.finishClarify(answers, skip = false)
                                    },
                                    onSkip = { container.verdictFlow.finishClarify(answers, skip = true) },
                                    onBack = {
                                        container.verdictFlow.leaveClarify()
                                        backStack.removeAll { it is ClarifyKey }
                                    },
                                    onNew = onNew,
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
                            ScreenView(container.analytics, "pricing")
                            PricingScreen(
                                pricing = config?.pricing ?: PricingInfo(),
                                features = config?.features,
                                signedIn = signedIn != null,
                                signInOffered = config?.signInOffered == true,
                                entitlement = signedIn?.me?.entitlement,
                                onBack = { backStack.removeAll { it is PricingKey } },
                                onSignIn = { if (backStack.lastOrNull() !is SignInKey) backStack.add(SignInKey(thenVerdict = false)) },
                                onNew = onNew,
                                store = StoreUi(
                                    available = store.available,
                                    offers = if (purchases.isReady(store)) store.offers else emptyMap(),
                                    buying = store.buying,
                                    notice = store.notice,
                                    subscriptionPending = PurchaseController.subscriptionPending(store, signedIn?.me?.entitlement),
                                ),
                                onBuy = { productId ->
                                    container.analytics.track("buy_tapped", mapOf("product" to productId))
                                    purchases.buy(context, productId)
                                },
                            )
                        }
                        entry<VerdictKey> { key ->
                            val vm = viewModel(key = "verdict-${key.id}") {
                                VerdictViewModel(key.id, container.history, container.api)
                            }
                            val accountState by account.state.collectAsStateWithLifecycle()
                            val providers by account.providers.collectAsStateWithLifecycle()
                            // Once per verdict, not again on the way back from a screen above it.
                            var viewed by rememberSaveable { mutableStateOf(false) }
                            LaunchedEffect(Unit) {
                                if (!viewed) container.analytics.track("verdict_viewed")
                                viewed = true
                            }
                            // Only the signed-in writer is told they may add context.
                            val appeal = if (accountState is Account.State.SignedIn) {
                                viewModel(key = "verdict-appeal-${key.id}") {
                                    VerdictAppealViewModel(
                                        key.id, container.api, container.history,
                                        onEntitlement = { account.applyEntitlement(it) },
                                        refreshAccount = { account.refresh() },
                                    )
                                }
                            } else {
                                null
                            }
                            VerdictRoute(
                                id = key.id,
                                viewModel = vm,
                                shareBaseUrl = container.config.shareBaseUrl,
                                onBack = if (key.fresh) null else ({ backStack.removeAt(backStack.lastIndex) }),
                                onNew = onNew,
                                appeal = appeal,
                                evidenceOn = (providers as? Account.Providers.Ready)?.config?.features?.evidence == true,
                                onSignIn = { if (backStack.lastOrNull() !is SignInKey) backStack.add(SignInKey(thenVerdict = false)) },
                                onPricing = { if (backStack.lastOrNull() !is PricingKey) backStack.add(PricingKey) },
                                onShared = { container.analytics.track("share_tapped") },
                            )
                        }
                        entry<HistoryKey> {
                            val providers by account.providers.collectAsStateWithLifecycle()
                            val historyOn = (providers as? Account.Providers.Ready)?.config?.features?.history == true
                            ScreenView(container.analytics, "verdicts")
                            val vm = viewModel {
                                HistoryViewModel(
                                    container.history, container.api, container.historyUser,
                                    syncOn = { (account.providers.value as? Account.Providers.Ready)?.config?.features?.history == true },
                                )
                            }
                            val entries by vm.entries.collectAsStateWithLifecycle()
                            val paging by vm.paging.collectAsStateWithLifecycle()
                            val notice by vm.notice.collectAsStateWithLifecycle()
                            val thinking = entries.orEmpty().any { (it as? HistoryEntry.Account)?.item?.historyState?.thinking == true }
                            val lifecycle = LocalLifecycleOwner.current.lifecycle
                            LaunchedEffect(historyOn) { vm.refresh() }
                            // While the judges work on a row, the list is read again now and then.
                            LaunchedEffect(thinking, historyOn) {
                                if (!thinking || !historyOn) return@LaunchedEffect
                                lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
                                    while (true) {
                                        delay(HistoryViewModel.POLL_MS)
                                        vm.refresh(force = true)
                                    }
                                }
                            }
                            HistoryScreen(
                                entries = entries,
                                onOpen = { e ->
                                    when (e) {
                                        is HistoryEntry.Phone -> backStack.add(VerdictKey(e.verdict.id, fresh = false))
                                        is HistoryEntry.Account -> {
                                            val item = e.item
                                            when {
                                                !item.isCase -> vm.openVerdict(item) { id -> backStack.add(VerdictKey(id, fresh = false)) }
                                                // Answering is done on the website: the case opens there too.
                                                item.isRespondent -> item.inviteToken?.let { openLink(context, "${container.config.shareBaseUrl.trimEnd('/')}/r/$it") }
                                                else -> backStack.add(CaseKey(item.id))
                                            }
                                        }
                                    }
                                },
                                onRemove = vm::remove,
                                onNew = onNew,
                                paging = paging,
                                notice = notice,
                                onLoadMore = vm::loadMore,
                                onRetry = { vm.refresh(force = true) },
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
                            val analytics = container.analytics
                            ScreenView(analytics, "case_detail")
                            ErrorShown(analytics, state.actionError)
                            LaunchedEffect(signedIn) {
                                // Signed in from the case screen: read it again.
                                if (signedIn && state.status == CaseLoadStatus.SIGNIN) vm.reload()
                            }
                            val shareBase = container.config.shareBaseUrl
                            CaseScreen(
                                state = state,
                                evidenceOn = (providers as? Account.Providers.Ready)?.config?.features?.evidence == true,
                                reducedMotion = rememberReducedMotion(),
                                otherName = key.otherName ?: vm.otherName,
                                actions = CaseActions(
                                    onBack = if (backStack.size > 1) ({ backStack.removeAt(backStack.lastIndex) }) else null,
                                    onNew = onNew,
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
                                    onShareInvite = {
                                        analytics.track("share_tapped")
                                        shareInvite(context, currentStrings.appShareTitle, currentStrings.caseInviteShareText, it)
                                    },
                                    onOverlayFinished = vm::finishOverlay,
                                    onAppealText = vm::onAppealText,
                                    onAddAppealEvidence = {
                                        analytics.track("evidence_added")
                                        vm.onAddAppealEvidence(it)
                                    },
                                    onRemoveAppealEvidence = vm::onRemoveAppealEvidence,
                                    onSubmitAppeal = vm::submitAppeal,
                                    onTypedName = vm::onTypedName,
                                    onSaveName = vm::saveDisplayName,
                                    onNamesVisible = vm::setNamesVisible,
                                    onShareVerdict = { id, headline ->
                                        analytics.track("share_tapped")
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
                            val usageStats by container.settings.usageStats.collectAsStateWithLifecycle(initialValue = true)
                            LaunchedEffect(Unit) {
                                purchases.refresh()
                                account.refresh()
                            }
                            ScreenView(container.analytics, "settings")
                            SettingsScreen(
                                langPref = langPref,
                                versionName = container.config.versionName,
                                onLangPref = { pref ->
                                    container.analytics.track("settings_changed", mapOf("key" to "language"))
                                    scope.launch { container.settings.setLangPref(pref) }
                                },
                                appearance = appearance,
                                onAppearance = { a ->
                                    container.analytics.track("settings_changed", mapOf("key" to "appearance"))
                                    scope.launch { container.settings.setAppearance(a) }
                                },
                                usageStats = usageStats,
                                onUsageStats = { on -> scope.launch { container.settings.setUsageStats(on) } },
                                onNew = onNew,
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
                            ScreenView(container.analytics, "sign_in")
                            LaunchedEffect(state.done) {
                                if (state.done) {
                                    backStack.removeAll { it is SignInKey }
                                    if (key.thenVerdict) submitAfterSignIn = true
                                }
                            }
                            SignInScreen(
                                state = state,
                                onBack = { backStack.removeAll { it is SignInKey } },
                                onNew = onNew,
                                actions = SignInActions(
                                    onGoogle = {
                                        container.analytics.track("sign_in_started", mapOf("provider" to "google"))
                                        vm.google(context)
                                    },
                                    onEmailChange = vm::onEmailChange,
                                    onRequestCode = {
                                        container.analytics.track("sign_in_started", mapOf("provider" to "email"))
                                        vm.requestCode(lang)
                                    },
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
private fun JudgingEntry(flow: VerdictFlow, onDone: (String) -> Unit, onLeave: () -> Unit, onNew: () -> Unit) {
    val state by flow.state.collectAsStateWithLifecycle()
    val reduced = rememberReducedMotion()
    val startedAt = remember { (state as? VerdictFlow.State.Running)?.startedAt ?: System.currentTimeMillis() }
    val argument = remember {
        when (val st = state) {
            is VerdictFlow.State.Running -> st.argument
            is VerdictFlow.State.Succeeded -> st.argument
            else -> ""
        }.takeIf { it.isNotEmpty() }
    }
    // Before the sides were kept (or after a restart) the sent text stands for your side.
    val sides = remember {
        when (val st = state) {
            is VerdictFlow.State.Running -> st.sides
            is VerdictFlow.State.Succeeded -> st.sides
            else -> emptyList()
        }.ifEmpty { listOfNotNull(argument?.let { VerdictFlow.Side(mine = true, name = "", text = it) }) }
    }
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
        sides = sides,
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
        onNew = onNew,
    )
}

/** screen_view once per back stack entry: saved with it, so a rotation does not count again. */
@Composable
private fun ScreenView(analytics: Analytics, screen: String) {
    var sent by rememberSaveable { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        if (!sent) analytics.track("screen_view", mapOf("screen" to screen))
        sent = true
    }
}

/** error_shown once for each error that comes up, not again when a rotation recreates the screen. */
@Composable
private fun ErrorShown(analytics: Analytics, error: UiError?) {
    var shown by rememberSaveable { mutableStateOf<String?>(null) }
    LaunchedEffect(error) {
        val code = error?.eventCode
        if (code != null && code != shown) analytics.track("error_shown", mapOf("code" to code))
        shown = code
    }
}

/** The tab bar stays off judging and the fresh verdict, sign-in and the questions. */
internal fun showsBottomBar(top: NavKey?): Boolean = when (top) {
    is JudgingKey, is SignInKey, is ClarifyKey -> false
    is VerdictKey -> !top.fresh
    else -> true
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
            Triple(Tab.HISTORY, s.navVerdicts, JudgeIcons.list(Palette.ink)),
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
    fun toolbar(p: JudgePalette) = CustomTabColorSchemeParams.Builder().setToolbarColor(p.ivory.toArgb()).build()
    runCatching {
        // The site follows the phone's theme, so the toolbar does too.
        CustomTabsIntent.Builder()
            .setDefaultColorSchemeParams(toolbar(LightPalette))
            .setColorSchemeParams(CustomTabsIntent.COLOR_SCHEME_DARK, toolbar(DarkPalette))
            .build()
            .launchUrl(context, url.toUri())
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

