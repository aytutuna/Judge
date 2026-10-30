package com.okjudge.judge.core.analytics

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.okjudge.judge.AppConfig
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowBuild

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class DeviceIdentityTest {
    private val app = ApplicationProvider.getApplicationContext<Context>()
    private val config = AppConfig(
        apiBaseUrl = "https://okjudge.com",
        shareBaseUrl = "https://okjudge.com",
        googleServerClientId = "",
        versionName = "0.1.0-debug",
        versionCode = 12,
    )
    private val token = Regex("^[A-Za-z0-9_.:/-]{1,64}$")

    @Test
    fun context_isMadeOfServerTokens() {
        ShadowBuild.setModel("moto g(7) power")
        val prefs = DeviceIdentity.prefs(app)
        val built = DeviceIdentity.context(config, prefs, DeviceIdentity.deviceId(app, prefs))
        for (value in listOf(built.deviceModel, built.osVersion, built.appVersion, built.locale)) {
            assertTrue("$value", value != null && token.matches(value))
        }
        assertEquals("moto_g_7__power", built.deviceModel)
        assertEquals("0.1.0-debug_12", built.appVersion)
    }

    @Test
    fun ids_stayTheSame_forTheInstall() {
        val prefs = DeviceIdentity.prefs(app)
        assertEquals(DeviceIdentity.anonId(prefs), DeviceIdentity.anonId(prefs))
        assertEquals(DeviceIdentity.deviceId(app, prefs), DeviceIdentity.deviceId(app, prefs))
    }

    @Test
    fun token_replacesWhatTheServerRefuses() {
        assertEquals("Pixel_8", DeviceIdentity.token("Pixel 8", 64))
        assertEquals("iPhone15_2", DeviceIdentity.token("iPhone15,2", 64))
        assertEquals(64, DeviceIdentity.token("x".repeat(80), 64)?.length)
        assertNull(DeviceIdentity.token("", 64))
    }
}
