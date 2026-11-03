package com.okjudge.judge

import android.app.Application
import android.os.Build
import io.sentry.android.core.SentryAndroid

/**
 * Crash and error reports to Sentry. Off without a DSN, and separate from
 * the usage statistics setting.
 */
object CrashReporting {
    fun start(app: Application, config: AppConfig) {
        // Robolectric runs JudgeApp.onCreate for every unit test.
        if (config.sentryDsn.isBlank() || Build.FINGERPRINT == "robolectric") return
        SentryAndroid.init(app) { options ->
            options.dsn = config.sentryDsn
            options.environment = if (BuildConfig.DEBUG) "debug" else "production"
            options.release = "judge-android@${config.versionName}+${config.versionCode}"
            options.isSendDefaultPii = false
            options.sessionReplay.sessionSampleRate = 0.0
            options.sessionReplay.onErrorSampleRate = 0.0
            // The screens show the user's case text.
            options.isAttachScreenshot = false
            options.isAttachViewHierarchy = false
            options.isEnableUserInteractionBreadcrumbs = false
            options.logs.isEnabled = false
        }
    }
}
