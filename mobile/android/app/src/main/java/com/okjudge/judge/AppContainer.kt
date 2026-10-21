package com.okjudge.judge

import android.content.Context
import com.okjudge.judge.core.api.BotCheck
import com.okjudge.judge.core.api.JudgeApi
import com.okjudge.judge.core.api.NoBotCheck
import com.okjudge.judge.core.api.TokenStore
import com.okjudge.judge.core.api.TurnstileBotCheck
import com.okjudge.judge.core.auth.Account
import com.okjudge.judge.core.cases.CaseNamesStore
import com.okjudge.judge.core.cases.PrefsCaseNames
import com.okjudge.judge.core.auth.CredentialManagerGoogle
import com.okjudge.judge.core.auth.KeystoreTokenStore
import com.okjudge.judge.core.data.DataStoreSettings
import com.okjudge.judge.core.data.HistoryDb
import com.okjudge.judge.core.data.HistoryRepository
import com.okjudge.judge.core.data.RoomHistoryRepository
import com.okjudge.judge.core.data.SettingsStore
import com.okjudge.judge.core.session.VerdictFlow
import com.okjudge.judge.i18n.LocalizedStrings
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import okhttp3.OkHttpClient

/** Build-time configuration (BuildConfig, set from `judge.*` Gradle properties). */
data class AppConfig(
    val apiBaseUrl: String,
    val shareBaseUrl: String,
    val turnstileSiteKey: String,
    val googleServerClientId: String,
    val versionName: String,
    val versionCode: Int,
) {
    val userAgent: String get() = "Judge-Android/$versionName ($versionCode)"

    companion object {
        fun fromBuildConfig() = AppConfig(
            apiBaseUrl = BuildConfig.API_BASE_URL,
            shareBaseUrl = BuildConfig.SHARE_BASE_URL.ifBlank { BuildConfig.API_BASE_URL },
            turnstileSiteKey = BuildConfig.TURNSTILE_SITE_KEY,
            googleServerClientId = BuildConfig.GOOGLE_SERVER_CLIENT_ID,
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

    val api: JudgeApi by lazy {
        JudgeApi(
            baseUrl = config.apiBaseUrl,
            client = okHttp,
            userAgent = config.userAgent,
            tokenStore = tokenStore,
            onSignedOut = { account.onSessionExpired() },
        )
    }

    val account: Account by lazy {
        Account(api, tokenStore, CredentialManagerGoogle(config.googleServerClientId), appScope)
    }

    val botCheck: BotCheck by lazy {
        if (config.turnstileSiteKey.isBlank()) NoBotCheck
        else TurnstileBotCheck(appContext, config.turnstileSiteKey, pageBaseUrl = config.apiBaseUrl.trimEnd('/') + "/")
    }

    private val db: HistoryDb by lazy { HistoryDb.create(appContext) }

    val history: HistoryRepository by lazy { RoomHistoryRepository(db.history()) }

    val settings: SettingsStore by lazy { DataStoreSettings(appContext) }

    /** The owner's real names per two-sided case, on this phone only. */
    val caseNames: CaseNamesStore by lazy { PrefsCaseNames(appContext) }

    val verdictFlow: VerdictFlow by lazy {
        VerdictFlow(
            api, botCheck, history, appScope,
            onEntitlement = { account.applyEntitlement(it) },
            refreshAccount = { account.refresh() },
            caseNames = caseNames,
        )
    }
}
