package com.okjudge.judge

import android.app.Application
import androidx.test.core.app.ApplicationProvider
import io.sentry.Sentry
import org.junit.Assert.assertFalse
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class CrashReportingTest {
    private val app = ApplicationProvider.getApplicationContext<Application>()
    private val config = AppConfig(
        apiBaseUrl = "https://okjudge.com",
        shareBaseUrl = "https://okjudge.com",
        googleServerClientId = "",
        versionName = "0.1.0-debug",
        versionCode = 1,
    )

    @Test
    fun noDsn_staysOff() {
        CrashReporting.start(app, config)
        assertFalse(Sentry.isEnabled())
    }

    @Test
    fun unitTests_neverStartSentry() {
        CrashReporting.start(app, config.copy(sentryDsn = "https://key@o0.ingest.sentry.io/0"))
        assertFalse(Sentry.isEnabled())
    }
}
