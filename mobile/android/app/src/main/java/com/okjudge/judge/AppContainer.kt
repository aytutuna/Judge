package com.okjudge.judge

import android.content.Context
import com.okjudge.judge.core.analytics.Analytics
import com.okjudge.judge.core.analytics.DeviceIdentity
import com.okjudge.judge.core.api.JudgeApi
import com.okjudge.judge.core.api.TokenStore
import com.okjudge.judge.core.auth.Account
import com.okjudge.judge.core.cases.CaseNamesStore
import com.okjudge.judge.core.cases.PrefsCaseNames
import com.okjudge.judge.core.auth.CredentialManagerGoogle
import com.okjudge.judge.core.auth.KeystoreTokenStore
import com.okjudge.judge.core.auth.PlayAgeSignals
import com.okjudge.judge.core.data.DataStoreSettings
import com.okjudge.judge.core.data.HistoryDb
import com.okjudge.judge.core.data.HistoryRepository
import com.okjudge.judge.core.data.RoomHistoryRepository
import com.okjudge.judge.core.data.SettingsStore
import com.okjudge.judge.core.purchases.PurchaseController
import com.okjudge.judge.core.purchases.PurchaseGateway
import com.okjudge.judge.core.purchases.RevenueCatGateway
import com.okjudge.judge.core.session.VerdictFlow
import com.okjudge.judge.i18n.LocalizedStrings
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import java.io.File

/** Build-time configuration (BuildConfig, set from `judge.*` Gradle properties). */
data class AppConfig(
    val apiBaseUrl: String,
    val shareBaseUrl: String,
    val googleServerClientId: String,
    /** Public RevenueCat SDK key; empty turns store purchases off. */
    val revenueCatApiKey: String = "",
    /** Sentry DSN for crash reports; empty means Sentry never starts. */
    val sentryDsn: String = "",
    val versionName: String,
    val versionCode: Int,
) {
    val userAgent: String get() = "Judge-Android/$versionName ($versionCode)"

    companion object {
        fun fromBuildConfig() = AppConfig(
            apiBaseUrl = BuildConfig.API_BASE_URL,
            shareBaseUrl = BuildConfig.SHARE_BASE_URL.ifBlank { BuildConfig.API_BASE_URL },
            googleServerClientId = BuildConfig.GOOGLE_SERVER_CLIENT_ID,
            revenueCatApiKey = BuildConfig.REVENUECAT_API_KEY,
            sentryDsn = BuildConfig.SENTRY_DSN,
            versionName = BuildConfig.VERSION_NAME,
            versionCode = BuildConfig.VERSION_CODE,
        )
    }
}

/**
 * Manual dependency wiring: lazy singletons created once per process in
 * [JudgeApp].
 */
class AppContainer(context: Context, val config: AppConfig = AppConfig.fromBuildConfig()) {
    private val appContext = context.applicationContext

    val appScope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    val strings: LocalizedStrings by lazy { LocalizedStrings(appContext) }

    val tokenStore: TokenStore by lazy { KeystoreTokenStore(appContext) }

    val okHttp: OkHttpClient by lazy { OkHttpClient.Builder().build() }

    private val identity by lazy { DeviceIdentity.prefs(appContext) }

    private val deviceId: String by lazy { DeviceIdentity.deviceId(appContext, identity) }

    val api: JudgeApi by lazy {
        JudgeApi(
            baseUrl = config.apiBaseUrl,
            client = okHttp,
            userAgent = config.userAgent,
            tokenStore = tokenStore,
            onSignedOut = { account.onSessionExpired() },
            deviceId = deviceId,
            onAgeGate = { account.onAgeGate(it) },
        )
    }

    /** Usage events for POST /api/v1/events; [start] feeds it the setting and the server's switch. */
    val analytics: Analytics by lazy {
        Analytics(
            transport = api::sendEvents,
            context = DeviceIdentity.context(config, identity, deviceId),
            file = File(appContext.filesDir, "analytics-queue.json"),
            scope = appScope,
        )
    }

    val account: Account by lazy {
        Account(api, tokenStore, CredentialManagerGoogle(config.googleServerClientId), appScope, ageSignals = PlayAgeSignals(appContext))
    }

    private val db: HistoryDb by lazy { HistoryDb.create(appContext) }

    val history: HistoryRepository by lazy { RoomHistoryRepository(db) }

    private val _historyUser = MutableStateFlow<String?>(null)

    /**
     * Whose Verdicts list the phone shows: the signed-in account once /me
     * names it; at launch, until then, the account /me last named for the
     * same session token, so it shows offline. Null signed out.
     */
    val historyUser: StateFlow<String?> = _historyUser.asStateFlow()

    val settings: SettingsStore by lazy { DataStoreSettings(appContext) }

    /** The owner's real names per two-sided case, on this phone only. */
    val caseNames: CaseNamesStore by lazy { PrefsCaseNames(appContext) }

    /** Null without an SDK key: no store in this build. */
    val purchaseGateway: PurchaseGateway? by lazy { RevenueCatGateway.createOrNull(appContext, config.revenueCatApiKey) }

    val purchases: PurchaseController by lazy {
        PurchaseController(
            purchaseGateway, account.state, refreshAccount = { account.refresh() }, scope = appScope,
            onBought = { analytics.track("purchase_completed") },
            ageRefusal = { account.ageRefusal() },
        )
    }

    /** Keeps the Verdicts cache with the session: signing out (or deleting the account) takes the account's rows off the phone. */
    fun start() {
        account.onEndedByUser = { history.forgetAccounts() }
        account.onSignedIn = { analytics.track("sign_in_completed") }
        appScope.launch { settings.usageStats.collect { analytics.allowed = it } }
        appScope.launch {
            account.providers.collect { (it as? Account.Providers.Ready)?.let { ready -> analytics.setServerOn(ready.config.features.analytics) } }
        }
        appScope.launch {
            var launching = true
            account.state.collect { state ->
                when (state) {
                    Account.State.SignedOut -> {
                        history.setAccount(null)
                        _historyUser.value = null
                    }
                    is Account.State.SignedIn -> {
                        val id = state.me?.user?.id
                        if (id != null) {
                            history.setAccount(id)
                            _historyUser.value = id
                        } else if (launching) {
                            val known = tokenStore.user()
                            history.setAccount(known)
                            _historyUser.value = known
                        }
                    }
                }
                launching = false
            }
        }
    }

    val verdictFlow: VerdictFlow by lazy {
        VerdictFlow(
            api, history, appScope,
            onEntitlement = { account.applyEntitlement(it) },
            refreshAccount = { account.refresh() },
            caseNames = caseNames,
        )
    }
}
