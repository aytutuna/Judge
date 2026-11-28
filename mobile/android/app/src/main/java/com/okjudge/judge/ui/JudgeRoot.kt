package com.okjudge.judge.ui

import android.app.Activity
import android.content.Context
import androidx.browser.customtabs.CustomTabColorSchemeParams
import androidx.browser.customtabs.CustomTabsIntent
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Snackbar
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.rememberDrawerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleStartEffect
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
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import com.okjudge.judge.AppContainer
import com.okjudge.judge.BuildConfig
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import com.okjudge.judge.core.auth.Account
import com.okjudge.judge.core.feedback.Consent
import com.okjudge.judge.core.feedback.DataExport
import com.okjudge.judge.core.model.ConsentState
import com.okjudge.judge.core.auth.AgeCheck
import com.okjudge.judge.core.auth.AgeGate
import com.okjudge.judge.core.display.Errors
import com.okjudge.judge.ui.age.AgeApprovalScreen
import com.okjudge.judge.ui.age.AgeBlockedScreen
import com.okjudge.judge.ui.age.AgeDateScreen
import com.okjudge.judge.ui.age.AgeParentScreen
import com.okjudge.judge.ui.age.AgeRegionScreen
import com.okjudge.judge.core.auth.ParentConsent
import com.okjudge.judge.core.model.AgeHint
import com.okjudge.judge.core.data.Appearance
import com.okjudge.judge.core.session.VerdictFlow
import com.okjudge.judge.i18n.LangPref
import com.okjudge.judge.i18n.LocalLang
import com.okjudge.judge.i18n.LocalStrings
import com.okjudge.judge.i18n.ProvideLang
import com.okjudge.judge.i18n.Strings
import com.okjudge.judge.i18n.deviceLanguageTags
import com.okjudge.judge.ui.components.LocalGamify
import com.okjudge.judge.ui.history.HistoryEntry
import com.okjudge.judge.ui.settings.DeleteUi
import com.okjudge.judge.ui.history.HistoryViewModel
import com.okjudge.judge.ui.home.HomeScreen
import com.okjudge.judge.ui.home.HomeViewModel
import com.okjudge.judge.ui.home.SHORT_WINDOW
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
import com.okjudge.judge.ui.settings.ExportUi
import com.okjudge.judge.ui.settings.RestoreUi
import com.okjudge.judge.ui.settings.AccountScreen
import com.okjudge.judge.ui.settings.SettingsScreen
import com.okjudge.judge.ui.signin.SignInActions
import com.okjudge.judge.ui.signin.SignInScreen
import com.okjudge.judge.ui.signin.SignInViewModel
import com.okjudge.judge.ui.theme.DarkPalette
import com.okjudge.judge.ui.theme.JudgePalette
import com.okjudge.judge.ui.theme.JudgeTheme
import com.okjudge.judge.ui.theme.LightPalette
import com.okjudge.judge.ui.theme.Palette
import com.okjudge.judge.ui.verdict.VerdictAppealViewModel
import com.okjudge.judge.ui.verdict.AgreementSheet
import com.okjudge.judge.ui.verdict.VerdictRoute
import com.okjudge.judge.ui.verdict.VerdictViewModel
import com.okjudge.judge.core.analytics.Analytics
import com.okjudge.judge.core.display.UiError
import com.okjudge.judge.core.display.Venues
import com.okjudge.judge.core.display.eventCode
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import java.time.LocalDate

@Serializable data object HomeKey : NavKey
@Serializable data object JudgingKey : NavKey
@Serializable data class VerdictKey(val id: String) : NavKey
@Serializable data object SettingsKey : NavKey
@Serializable data object ClarifyKey : NavKey
@Serializable data object PricingKey : NavKey
@Serializable data object AccountKey : NavKey
/** [otherName]: who a case just created here waits for, as typed on Home. */
@Serializable data class CaseKey(val id: String, val otherName: String? = null) : NavKey

/** Sign-in; [thenVerdict] or [thenLink] when it was opened by "Get the verdict" or "Send them a link", which go on after signing in. */
@Serializable data class SignInKey(val thenVerdict: Boolean, val thenLink: Boolean = false) : NavKey

internal enum class Tab { NEW, SETTINGS }

/** App shell: language, theme, the back stack, the side menu and the sign-in gate. [onDark] hears the theme in use. */
@Composable
fun JudgeRoot(
    container: AppContainer,
    links: StateFlow<Uri?> = MutableStateFlow(null),
    onLinkHandled: () -> Unit = {},
    onDark: (Boolean) -> Unit = {},
) {
    val langPref by container.settings.langPref.collectAsStateWithLifecycle(initialValue = LangPref.SYSTEM)
    val appearance by container.settings.appearance.collectAsStateWithLifecycle(initialValue = Appearance.SYSTEM)
    val gamify by container.settings.gamify.collectAsStateWithLifecycle(initialValue = null)
    val dark = appearance.isDark(isSystemInDarkTheme())
    val darkChanged by rememberUpdatedState(onDark)
    LaunchedEffect(dark) { darkChanged(dark) }
    val configuration = LocalConfiguration.current
    val appContext = LocalContext.current
    val deviceTags = remember(configuration) { deviceLanguageTags(appContext) }
    val lang = langPref.resolve(deviceTags)
    val strings = remember(lang) { container.strings.of(lang) }
    val scope = rememberCoroutineScope()

    CompositionLocalProvider(LocalGamify provides (gamify == true)) {
        ProvideLang(lang, strings) {
            JudgeTheme(dark = dark) {
                val backStack = rememberNavBackStack(HomeKey)
                var clearDraft by rememberSaveable { mutableStateOf(false) }
                var submitAfterSignIn by rememberSaveable { mutableStateOf(false) }
                var linkAfterSignIn by rememberSaveable { mutableStateOf(false) }
                val context = LocalContext.current
                val account = container.account
                val snackbar = remember { SnackbarHostState() }
                val currentStrings by rememberUpdatedState(strings)
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
                        // Under the age cover the cover itself says it.
                        if (notice == Account.Notice.DELETE_FAILED && account.ageGate.value != AgeGate.NONE) return@collect
                        launch { snackbar.showSnackbar(noticeText(currentStrings, notice)) }
                    }
                }
                val clarifyOpen = backStack.any { it is ClarifyKey }
                LaunchedEffect(clarifyOpen) {
                    // Questions left behind another way (the menu, a link) are dropped with their screen.
                    if (!clarifyOpen) container.verdictFlow.leaveClarify()
                }
                val top = backStack.lastOrNull()
                val site = container.config.shareBaseUrl.trimEnd('/')
                val ageGate by account.ageGate.collectAsStateWithLifecycle()
                val accountNow by account.state.collectAsStateWithLifecycle()
                val phoneAge by account.platformAge.collectAsStateWithLifecycle()
                val agePosting by account.agePosting.collectAsStateWithLifecycle()
                val ageChecking by account.ageChecking.collectAsStateWithLifecycle()
                val onSignInScreen = top is SignInKey
                LaunchedEffect(onSignInScreen, accountNow) {
                    // The phone is asked when sign-in opens, or for a signed-in account that still has to confirm.
                    if (account.needsPlatformAge(onSignInScreen)) account.checkPlatformAge(context)
                }
                val tab = when {
                    backStack.any { it is SettingsKey } -> Tab.SETTINGS
                    else -> Tab.NEW
                }
                val historyVm = viewModel {
                    HistoryViewModel(
                        container.history, container.api, container.historyUser,
                        syncOn = { (account.providers.value as? Account.Providers.Ready)?.config?.features?.history == true },
                    )
                }
                val history by historyVm.entries.collectAsStateWithLifecycle()
                val paging by historyVm.paging.collectAsStateWithLifecycle()
                val historyNotice by historyVm.notice.collectAsStateWithLifecycle()
                val historyProviders by account.providers.collectAsStateWithLifecycle()
                val historyOn = (historyProviders as? Account.Providers.Ready)?.config?.features?.history == true
                val thinking = history.orEmpty().any { (it as? HistoryEntry.Account)?.item?.historyState?.thinking == true }
                val openEntry: (HistoryEntry) -> Unit = { e ->
                    when (e) {
                        is HistoryEntry.Phone -> backStack.add(VerdictKey(e.verdict.id))
                        is HistoryEntry.Account -> {
                            val item = e.item
                            when {
                                !item.isCase -> historyVm.openVerdict(item) { id -> backStack.add(VerdictKey(id)) }
                                // Answering is done on the website: the case opens there too.
                                item.isRespondent -> item.inviteToken?.let { openLink(context, "$site/r/$it") }
                                else -> backStack.add(CaseKey(item.id))
                            }
                        }
                    }
                }

                val drawer = rememberDrawerState(DrawerValue.Closed)
                val reducedMotion = rememberReducedMotion()
                val menuOpen = drawer.targetValue == DrawerValue.Open
                val setMenu: (Boolean) -> Unit = { open ->
                    val to = if (open) DrawerValue.Open else DrawerValue.Closed
                    scope.launch { if (reducedMotion) drawer.snapTo(to) else if (open) drawer.open() else drawer.close() }
                }
                val barShown = showsPageBar(top)
                val barShownNow by rememberUpdatedState(barShown)
                val menuButton = remember { FocusRequester() }
                val firstRow = remember { FocusRequester() }
                var menuWasOpen by remember { mutableStateOf(false) }
                LaunchedEffect(menuOpen) {
                    if (menuOpen) {
                        historyVm.clearNotice()
                        historyVm.refresh()
                        firstRow.requestFocus()
                        menuWasOpen = true
                    } else if (menuWasOpen) {
                        menuWasOpen = false
                        if (barShownNow) menuButton.requestFocus()
                    }
                }

                // While the judges work on a row, the list is read again now and then.
                val lifecycle = LocalLifecycleOwner.current.lifecycle
                LaunchedEffect(menuOpen, thinking, historyOn) {
                    if (!menuOpen || !thinking || !historyOn) return@LaunchedEffect
                    lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
                        while (true) {
                            delay(HistoryViewModel.POLL_MS)
                            historyVm.refresh(force = true)
                        }
                    }
                }

                // While a link row waits, its sides are read live; leaving the app stops it.
                val waitingLinks = history.orEmpty().mapNotNull { it.waitingLinkId }.toSet()
                val live by historyVm.live.collectAsStateWithLifecycle()
                LaunchedEffect(menuOpen, waitingLinks.isNotEmpty(), historyOn) {
                    if (!menuOpen || waitingLinks.isEmpty() || !historyOn) {
                        historyVm.clearLive()
                        return@LaunchedEffect
                    }
                    lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
                        while (true) {
                            historyVm.pollLive()
                            delay(HistoryViewModel.LIVE_POLL_MS)
                        }
                    }
                }

                // A link, an expired session or a verdict on its way can push a page that has no menu.
                LaunchedEffect(barShown) { if (!barShown) drawer.snapTo(DrawerValue.Closed) }

                Box(Modifier.fillMaxSize()) {
                ModalNavigationDrawer(
                    drawerContent = {
                        MenuPanel(
                            selected = tab,
                            entries = history.orEmpty(),
                            hidden = drawer.currentValue == DrawerValue.Closed && !menuOpen,
                            firstRow = firstRow,
                            onSelect = { selected ->
                                backStack.resetTo(
                                    when (selected) {
                                        Tab.NEW -> listOf(HomeKey)
                                        Tab.SETTINGS -> listOf(HomeKey, SettingsKey)
                                    },
                                )
                                setMenu(false)
                            },
                            onOpen = { e ->
                                if (!(e is HistoryEntry.Account && e.item.isCase && e.item.isRespondent)) backStack.resetTo(listOf(HomeKey))
                                openEntry(e)
                                setMenu(false)
                            },
                            onClose = { setMenu(false) },
                            paging = paging,
                            notice = historyNotice,
                            live = live,
                            onRemove = { picked -> historyVm.remove(picked) {} },
                            onLoadMore = historyVm::loadMore,
                            onLoadAll = historyVm::loadAllEntries,
                            onRetry = { historyVm.refresh(force = true) },
                            account = AccountActions(
                                signedIn = accountNow is Account.State.SignedIn,
                                user = (accountNow as? Account.State.SignedIn)?.me?.user,
                                onPricing = openPricing,
                                onSignIn = { if (backStack.lastOrNull() !is SignInKey) backStack.add(SignInKey(thenVerdict = false)) },
                                onSignOut = { container.appScope.launch { account.signOut() } },
                            ),
                        )
                    },
                    // Nothing under the age cover is read out or reachable.
                    modifier = if (ageGate == AgeGate.NONE) Modifier else Modifier.clearAndSetSemantics {},
                    drawerState = drawer,
                    gesturesEnabled = menuOpen || barShown,
                    scrimColor = menuScrim,
                ) {
                Scaffold(
                    // The menu is the only thing read out while it is open.
                    modifier = if (menuOpen) Modifier.clearAndSetSemantics {} else Modifier,
                    containerColor = Palette.ivory,
                    topBar = {
                        if (barShown) {
                            PageBar(
                                title = when (top) {
                                    is SettingsKey -> strings.appTabSettings
                                    else -> null
                                },
                                onMenu = { setMenu(true) },
                                onNew = { backStack.resetTo(listOf(HomeKey)) },
                                menuFocus = menuButton,
                                showGamify = top is HomeKey && LocalConfiguration.current.screenHeightDp >= SHORT_WINDOW.value,
                                gamify = gamify != false,
                                onGamify = { on -> scope.launch { container.settings.setGamify(on) } },
                            )
                        }
                    },
                ) { padding ->
                    Box(Modifier.padding(padding).consumeWindowInsets(padding)) {
                        NavDisplay(
                            backStack = backStack,
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
                                            example = container.examples::next,
                                            drafts = container.drafts,
                                            accountEnded = container.accountEnded,
                                        )
                                    }
                                    val state by vm.state.collectAsStateWithLifecycle()
                                    val analytics = container.analytics
                                    ScreenView(analytics, "home")
                                    ErrorShown(analytics, state.error)
                                    LaunchedEffect(vm) {
                                        vm.shareLink.collect {
                                            analytics.track("share_tapped")
                                            shareInvite(context, currentStrings.appShareTitle, currentStrings.caseInviteShareText, it)
                                        }
                                    }
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
                                    // A tap made during the launch age check: kept only while Home is on screen, never saved.
                                    var heldTap by remember { mutableIntStateOf(HELD_NONE) }
                                    DisposableEffect(Unit) { onDispose { heldTap = HELD_NONE } }
                                    LaunchedEffect(submitAfterSignIn, linkAfterSignIn, heldTap, accountNow, ageGate, phoneAge, agePosting, ageChecking) {
                                        if (!submitAfterSignIn && !linkAfterSignIn && heldTap == HELD_NONE) return@LaunchedEffect
                                        val refusal = account.ageRefusal()
                                        if (refusal != null && refusal != AgeCheck.CHECKING) heldTap = HELD_NONE
                                        if (accountNow is Account.State.SignedOut) {
                                            submitAfterSignIn = false
                                            linkAfterSignIn = false
                                            heldTap = HELD_NONE
                                        } else if (refusal == null) {
                                            // Waits for the age to be on record (the sheet, if it failed).
                                            val link = linkAfterSignIn || heldTap == HELD_LINK
                                            submitAfterSignIn = false
                                            linkAfterSignIn = false
                                            heldTap = HELD_NONE
                                            val started = if (link) vm.sendLink(lang) else vm.submit(lang, strings)
                                            if (counted(started) == Submitted.PRICING) openPricing()
                                        }
                                    }
                                    val venue by container.venues.home.collectAsStateWithLifecycle()
                                    HomeScreen(
                                        state = state,
                                        venue = venue,
                                        onArgumentChange = { text ->
                                            if (state.argument.isEmpty() && text.isNotEmpty()) analytics.track("case_started")
                                            vm.onArgumentChange(text)
                                        },
                                        onOtherSideChange = vm::onOtherSideChange,
                                        onOtherName = vm::onOtherName,
                                        onSubmit = submit@{
                                            // The phone's check or an age report is still running.
                                            when (account.ageRefusal()) {
                                                null -> Unit
                                                // The launch check is still running: the tap goes through by itself when it ends.
                                                AgeCheck.CHECKING -> { heldTap = HELD_SUBMIT; return@submit }
                                                else -> return@submit
                                            }
                                            when (counted(vm.submit(lang, strings))) {
                                                // Every verdict needs an account: sign in first, then go on.
                                                Submitted.SIGN_IN -> if (backStack.lastOrNull() !is SignInKey) backStack.add(SignInKey(thenVerdict = true))
                                                Submitted.PRICING -> openPricing()
                                                else -> Unit
                                            }
                                        },
                                        onSendLink = link@{
                                            when (account.ageRefusal()) {
                                                null -> Unit
                                                AgeCheck.CHECKING -> { heldTap = HELD_LINK; return@link }
                                                else -> return@link
                                            }
                                            when (counted(vm.sendLink(lang))) {
                                                Submitted.SIGN_IN -> if (backStack.lastOrNull() !is SignInKey) backStack.add(SignInKey(thenVerdict = false, thenLink = true))
                                                Submitted.PRICING -> openPricing()
                                                else -> Unit
                                            }
                                        },
                                        onExample = {
                                            if (state.argument.isEmpty()) analytics.track("case_started")
                                            vm.fillExample(lang)
                                        },
                                        onDismissError = vm::dismissError,
                                        onAddTheirSide = vm::addTheirSide,
                                        onRemoveTheirSide = vm::removeTheirSide,
                                        onAddSide = vm::addSide,
                                        onRemoveLastSide = vm::removeLastSide,
                                        onExtraSide = vm::onExtraSideChange,
                                        onExtraName = vm::onExtraName,
                                        onClear = vm::clear,
                                        onAddEvidence = { side, sources ->
                                            analytics.track("evidence_added")
                                            vm.onAddEvidence(side, sources)
                                        },
                                        onRemoveEvidence = vm::onRemoveEvidence,
                                        onDisplayName = vm::onDisplayName,
                                        onAddContextSignIn = { if (backStack.lastOrNull() !is SignInKey) backStack.add(SignInKey(thenVerdict = false)) },
                                    )
                                }
                                entry<JudgingKey> {
                                    JudgingEntry(
                                        flow = container.verdictFlow,
                                        onDone = { id ->
                                            // The case is done: "New" finds an empty form.
                                            clearDraft = true
                                            backStack.removeAll { it is JudgingKey }
                                            backStack.add(VerdictKey(id))
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
                                            onSubmit = {
                                                container.analytics.track("question_answered")
                                                container.verdictFlow.finishClarify(answers, skip = false)
                                            },
                                            onSkip = { container.verdictFlow.finishClarify(answers, skip = true) },
                                            onBack = {
                                                container.verdictFlow.leaveClarify()
                                                backStack.removeAll { it is ClarifyKey }
                                            },
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
                                        onOpenTerms = { openLink(context, "$site/terms") },
                                        onOpenPrivacy = { openLink(context, "$site/privacy") },
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
                                    val teen by account.teen.collectAsStateWithLifecycle()
                                    val askConsent = AgeCheck.showsConsentCard(container.consent.ask.collectAsStateWithLifecycle().value, teen)
                                    LaunchedEffect(accountState is Account.State.SignedIn) {
                                        if (accountState is Account.State.SignedIn) container.consent.refresh() else container.consent.clear()
                                    }
                                    VerdictRoute(
                                        id = key.id,
                                        viewModel = vm,
                                        shareBaseUrl = container.config.shareBaseUrl,
                                        onBack = { backStack.removeAll { it == key } },
                                        // A verdict just judged sits right above the form; one from the list, above the list.
                                        backLabel = strings.appTabNew,
                                        appeal = appeal,
                                        signedOut = accountState is Account.State.SignedOut,
                                        evidenceOn = (providers as? Account.Providers.Ready)?.config?.features?.evidence == true,
                                        onSignIn = { if (backStack.lastOrNull() !is SignInKey) backStack.add(SignInKey(thenVerdict = false)) },
                                        onPricing = { if (backStack.lastOrNull() !is PricingKey) backStack.add(PricingKey) },
                                        onShared = { container.analytics.track("share_tapped") },
                                        feedback = true,
                                        askConsent = askConsent,
                                        onConsent = { on -> container.consent.answer(on, "card", Consent.CARD_WORDING, lang) },
                                        onConsentInfo = { openLink(context, "$site/privacy#help-improve") },
                                    )
                                }
                                entry<CaseKey> { key ->
                                    val vm = viewModel(key = "case-${key.id}") {
                                        CaseViewModel(
                                            key.id, container.api, container.caseNames,
                                            onEntitlement = { account.applyEntitlement(it) },
                                            refreshAccount = { account.refresh() },
                                            saved = createSavedStateHandle(),
                                        )
                                    }
                                    val state by vm.state.collectAsStateWithLifecycle()
                                    LifecycleStartEffect(vm) {
                                        vm.setForeground(true)
                                        onStopOrDispose { vm.setForeground(false) }
                                    }
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
                                            onReload = vm::reload,
                                            onSignIn = { if (backStack.lastOrNull() !is SignInKey) backStack.add(SignInKey(thenVerdict = false)) },
                                            onPricing = { if (backStack.lastOrNull() !is PricingKey) backStack.add(PricingKey) },
                                            onStartOver = {
                                                clearDraft = true
                                                backStack.resetTo(listOf(HomeKey))
                                            },
                                            onJudgeNow = { vm.judge(onlyMine = true) },
                                            onRetry = { vm.judge(onlyMine = false) },
                                            onJudgeAnswered = vm::judgeAnswered,
                                            onResetInvite = vm::resetInvite,
                                            onRemove = vm::remove,
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
                                            onSideText = vm::onSideText,
                                            onAddSideEvidence = {
                                                analytics.track("evidence_added")
                                                vm.onAddSideEvidence(it)
                                            },
                                            onRemoveSideEvidence = vm::onRemoveSideEvidence,
                                            onSubmitSide = vm::submitSide,
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
                                    val teen by account.teen.collectAsStateWithLifecycle()
                                    val statsLocked by account.statsLocked.collectAsStateWithLifecycle()
                                    LaunchedEffect(Unit) {
                                        purchases.refresh()
                                        account.refresh()
                                    }
                                    ScreenView(container.analytics, "settings")
                                    val consent by container.consent.state.collectAsStateWithLifecycle()
                                    LaunchedEffect(accountState is Account.State.SignedIn) {
                                        if (accountState is Account.State.SignedIn) container.consent.refresh() else container.consent.clear()
                                    }
                                    SettingsScreen(
                                        langPref = langPref,
                                        versionName = container.config.versionName,
                                        onLangPref = { pref ->
                                            container.analytics.track("settings_changed", mapOf("key" to "language"))
                                            scope.launch { container.settings.setLangPref(pref) }
                                        },
                                        onAppearance = { a ->
                                            container.analytics.track("settings_changed", mapOf("key" to "appearance"))
                                            scope.launch { container.settings.setAppearance(a) }
                                        },
                                        helpImprove = consent == ConsentState.ON,
                                        onHelpImprove = { on ->
                                            if (accountState is Account.State.SignedIn) {
                                                container.consent.answer(on, "switch", Consent.SWITCH_WORDING, lang)
                                            } else if (backStack.lastOrNull() !is SignInKey) {
                                                backStack.add(SignInKey(thenVerdict = false))
                                            }
                                        },
                                        usageStats = usageStats && statsLocked != true,
                                        teen = teen,
                                        onUsageStats = { on -> scope.launch { container.settings.setUsageStats(on) } },
                                        onOpenLink = { openLink(context, it) },
                                        siteBaseUrl = container.config.shareBaseUrl,
                                        account = accountState,
                                        accountBusy = accountBusy,
                                        onSignIn = { if (backStack.lastOrNull() !is SignInKey) backStack.add(SignInKey(thenVerdict = false)) },
                                        onOpenPricing = { if (backStack.lastOrNull() !is PricingKey) backStack.add(PricingKey) },
                                        // App scope: leaving the screen must not stop a sign-out or deletion halfway.
                                        onSignOut = { container.appScope.launch { account.signOut() } },
                                        onOpenAccount = { if (backStack.lastOrNull() !is AccountKey) backStack.add(AccountKey) },
                                        restore = if (purchasesOn && store.available && (accountState !is Account.State.SignedIn || purchases.isReady(store))) RestoreUi(store.restoring, store.restoreNotice) else null,
                                        onRestore = { purchases.restore() },
                                    )
                                }
                                entry<AccountKey> {
                                    val accountState by account.state.collectAsStateWithLifecycle()
                                    val accountBusy by account.working.collectAsStateWithLifecycle()
                                    LaunchedEffect(accountState is Account.State.SignedOut) {
                                        if (accountState is Account.State.SignedOut) backStack.removeAll { it is AccountKey }
                                    }
                                    val export by container.dataExport.state.collectAsStateWithLifecycle()
                                    val saveExport = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri ->
                                        val ready = container.dataExport.state.value as? DataExport.State.Ready
                                        if (uri == null || ready == null) {
                                            container.dataExport.done()
                                        } else {
                                            scope.launch {
                                                val saved = withContext(Dispatchers.IO) {
                                                    runCatching { context.contentResolver.openOutputStream(uri)!!.use { it.write(ready.json.toByteArray()) } }
                                                }
                                                if (saved.isSuccess) container.dataExport.done() else container.dataExport.failed()
                                            }
                                        }
                                    }
                                    (export as? DataExport.State.Ready)?.takeIf { !it.picking }?.let { ready ->
                                        LaunchedEffect(ready) {
                                            container.dataExport.picking()
                                            saveExport.launch(ready.name)
                                        }
                                    }
                                    AccountScreen(
                                        account = accountState,
                                        busy = accountBusy,
                                        export = ExportUi(
                                            busy = export == DataExport.State.Busy || export is DataExport.State.Ready,
                                            failed = export == DataExport.State.Failed,
                                            onExport = container.dataExport::start,
                                        ),
                                        // App scope: leaving the screen must not stop a deletion halfway.
                                        onDelete = { password -> container.appScope.launch { account.deleteAccount(password) } },
                                        delete = deleteUi(account, accountState) { container.appScope.launch { account.signOut() } },
                                        onBack = { backStack.removeAll { it is AccountKey } },
                                        onManageSubscription = {
                                            openLink(context, "https://play.google.com/store/account/subscriptions?package=${context.packageName}")
                                        },
                                    )
                                }
                                entry<SignInKey> { key ->
                                    val vm = viewModel { SignInViewModel(account, container.lastSignIn) }
                                    val state by vm.state.collectAsStateWithLifecycle()
                                    ScreenView(container.analytics, "sign_in")
                                    LaunchedEffect(state.done) {
                                        if (state.done) {
                                            backStack.removeAll { it is SignInKey }
                                            if (key.thenVerdict) submitAfterSignIn = true
                                            if (key.thenLink) linkAfterSignIn = true
                                        }
                                    }
                                    SignInScreen(
                                        state = state,
                                        forLink = key.thenLink,
                                        onBack = { backStack.removeAll { it is SignInKey } },
                                        actions = SignInActions(
                                            onGoogle = {
                                                container.analytics.track("sign_in_started", mapOf("provider" to "google"))
                                                vm.google(context)
                                            },
                                            onEmailChange = vm::onEmailChange,
                                            onContinue = {
                                                container.analytics.track("sign_in_started", mapOf("provider" to "email"))
                                                vm.continueWithEmail(lang)
                                            },
                                            onRequestCode = { vm.requestCode(lang) },
                                            onPasswordChange = vm::onPasswordChange,
                                            onSignInWithPassword = {
                                                container.analytics.track("sign_in_started", mapOf("provider" to "password"))
                                                vm.signInWithPassword()
                                            },
                                            onForgot = { vm.forgotPassword(lang) },
                                            onUseCode = { vm.useCode(lang) },
                                            onSavePassword = vm::savePassword,
                                            onSkip = vm::skipPassword,
                                            onCodeChange = vm::onCodeChange,
                                            onSubmitCode = vm::submitCode,
                                            onResend = { vm.resend(lang) },
                                            onChangeEmail = vm::changeEmail,
                                            onRetryProviders = vm::retryProviders,
                                            onDevSignIn = if (BuildConfig.DEBUG) vm::signInDev else null,
                                            onOpenTerms = { openLink(context, "$site/terms") },
                                            onOpenPrivacy = { openLink(context, "$site/privacy") },
                                        ),
                                    )
                                }
                            },
                        )
                        // Registered after the display's own handler, so it wins while the menu is open.
                        BackHandler(enabled = menuOpen) { setMenu(false) }
                        SnackbarHost(snackbar, Modifier.align(Alignment.TopCenter).statusBarsPadding()) { data ->
                            Snackbar(data, containerColor = Palette.ink, contentColor = Palette.ivory)
                        }
                    }
                }
                }
                val agreement by container.agreement.state.collectAsStateWithLifecycle()
                if (agreement.open) {
                    AgreementSheet(
                        state = agreement,
                        onContinue = { container.agreement.confirm(lang) },
                        onDismiss = container.agreement::decline,
                    )
                }
                AgeOverlay(
                    gate = ageGate,
                    account = account,
                    signedIn = accountNow is Account.State.SignedIn,
                    onSignOut = { container.appScope.launch { account.signOut() } },
                    onDelete = { password -> container.appScope.launch { account.deleteAccount(password) } },
                    delete = deleteUi(account, accountNow) { container.appScope.launch { account.signOut() } },
                    parent = container.parentConsent,
                    scope = container.appScope,
                    onSubmitDob = { dob, country, quebec -> container.appScope.launch { account.submitDob(dob, country, quebec) } },
                    onContact = { sendEmail(context, AgeCheck.SUPPORT_EMAIL) },
                )
                }
            }
        }
    }
}

private const val PARENT_POLL_MS = 30_000L
private const val HELD_NONE = 0
private const val HELD_SUBMIT = 1
private const val HELD_LINK = 2

@Composable
private fun deleteUi(account: Account, state: Account.State, signInAgain: () -> Unit): DeleteUi {
    val problem by account.deleteProblem.collectAsStateWithLifecycle()
    val failed by account.deleteFailed.collectAsStateWithLifecycle()
    return DeleteUi(
        hasPassword = (state as? Account.State.SignedIn)?.me?.hasPassword == true,
        problem = problem,
        failed = failed,
        onClearProblem = account::clearDeleteProblem,
        onSignInAgain = signInAgain,
    )
}

/** The age check over the whole app: the date step or the final refusal. Back leaves the app. */
@Composable
private fun AgeOverlay(
    gate: AgeGate,
    account: Account,
    signedIn: Boolean,
    onSignOut: () -> Unit,
    onDelete: (String?) -> Unit,
    delete: DeleteUi,
    parent: ParentConsent,
    scope: CoroutineScope,
    onSubmitDob: (LocalDate, String?, Boolean?) -> Unit,
    onContact: () -> Unit,
) {
    if (gate == AgeGate.NONE) return
    val context = LocalContext.current
    BackHandler { (context as? Activity)?.moveTaskToBack(true) }
    val busy by account.working.collectAsStateWithLifecycle()
    val checking by account.ageChecking.collectAsStateWithLifecycle()
    when (gate) {
        AgeGate.DATE -> {
            val posting by account.agePosting.collectAsStateWithLifecycle()
            val failed by account.ageFailed.collectAsStateWithLifecycle()
            var hint by remember { mutableStateOf<AgeHint?>(null) }
            LaunchedEffect(Unit) { hint = account.ageHint() }
            AgeDateScreen(
                busy = busy || posting,
                failed = failed,
                onSubmit = onSubmitDob,
                onEdit = account::clearAgeFailed,
                hint = hint,
                onSignOut = onSignOut,
                onDelete = onDelete,
                delete = delete,
            )
        }
        AgeGate.RESTRICTED -> {
            // Nothing to retry: it lifts on the birthday, so /me is read again on foreground.
            val lifecycle = LocalLifecycleOwner.current.lifecycle
            LaunchedEffect(Unit) { lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) { account.refresh() } }
            AgeRegionScreen(busy = busy, onSignOut = onSignOut, onDelete = onDelete, onContact = onContact, delete = delete)
        }
        AgeGate.PARENT -> {
            val accountState by account.state.collectAsStateWithLifecycle()
            val status = (accountState as? Account.State.SignedIn)?.me?.age?.parent ?: "pending"
            val view by parent.state.collectAsStateWithLifecycle()
            val lang = LocalLang.current
            // The parent's yes lifts the cover by itself: read /me again every 30 seconds and on coming back.
            val lifecycle = LocalLifecycleOwner.current.lifecycle
            LaunchedEffect(Unit) {
                lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
                    while (true) {
                        parent.load()
                        account.refresh()
                        delay(PARENT_POLL_MS)
                    }
                }
            }
            AgeParentScreen(
                status = status,
                view = view.view,
                busy = busy || view.busy,
                error = view.error,
                onSend = { scope.launch { parent.send(it, lang) } },
                onResend = { scope.launch { parent.resend(lang) } },
                onReload = { scope.launch { parent.load() } },
                onSignOut = onSignOut,
                onDelete = onDelete,
                delete = delete,
            )
        }
        AgeGate.BLOCKED -> AgeBlockedScreen(
            signedIn = signedIn,
            busy = busy,
            onSignOut = onSignOut,
            onDelete = onDelete,
            delete = delete,
            onContact = onContact,
        )
        AgeGate.APPROVAL -> AgeApprovalScreen(
            busy = busy || checking,
            onCheckAgain = { account.recheckPlatformAge(context) },
            onSignOut = onSignOut,
            onDelete = onDelete,
            delete = delete,
        )
        AgeGate.NONE -> Unit
    }
}

@Composable
private fun JudgingEntry(flow: VerdictFlow, onDone: (String) -> Unit, onLeave: () -> Unit) {
    val state by flow.state.collectAsStateWithLifecycle()
    val reduced = rememberReducedMotion()
    // A verdict that is already in (the screen was recreated) skips the waiting beats instead of replaying them.
    val startedAt = remember { (state as? VerdictFlow.State.Running)?.startedAt ?: if (state is VerdictFlow.State.Succeeded) 0L else System.currentTimeMillis() }
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
    val venue = remember {
        when (val st = state) {
            is VerdictFlow.State.Running -> st.venue
            is VerdictFlow.State.Succeeded -> st.venue
            else -> null
        } ?: Venues.COURT
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
        names = outcome?.nameMap.orEmpty(),
        startedAt = startedAt,
        reducedMotion = reduced,
        premium = premium,
        sides = sides,
        venue = venue,
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

/** The menu bar is for the two main pages; the rest have their own back button or none. */
internal fun showsPageBar(top: NavKey?): Boolean = top is HomeKey || top is SettingsKey

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

private fun sendEmail(context: Context, address: String) {
    runCatching { context.startActivity(Intent(Intent.ACTION_SENDTO, "mailto:$address".toUri())) }
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

