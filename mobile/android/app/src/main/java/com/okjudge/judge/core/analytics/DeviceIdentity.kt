package com.okjudge.judge.core.analytics

import android.annotation.SuppressLint
import android.content.Context
import android.content.SharedPreferences
import android.os.Build
import android.provider.Settings
import com.okjudge.judge.AppConfig
import java.util.Locale
import java.util.UUID

/**
 * The ids the server sees from this install: the device id (sign-in and
 * events) and a random anon id made once per install for signed-out events.
 */
object DeviceIdentity {
    private const val DEVICE_KEY = "device_id"
    private const val ANON_KEY = "anon_id"
    private val DEVICE_ID = Regex("^[0-9A-Za-z_-]{8,64}$")
    private val LOCALE = Regex("^[A-Za-z]{2,3}([_-][0-9A-Za-z]{2,8}){0,3}$")

    fun prefs(context: Context): SharedPreferences = context.getSharedPreferences("identity", Context.MODE_PRIVATE)

    /** ANDROID_ID (per app signing key and user), or an id kept from the first launch when there is none. */
    @SuppressLint("HardwareIds")
    fun deviceId(context: Context, prefs: SharedPreferences): String {
        val android = Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID)
        if (android != null && DEVICE_ID.matches(android)) return android
        return stored(prefs, DEVICE_KEY)
    }

    fun anonId(prefs: SharedPreferences): String = stored(prefs, ANON_KEY)

    private fun stored(prefs: SharedPreferences, key: String): String {
        prefs.getString(key, null)?.let { return it }
        val id = UUID.randomUUID().toString()
        prefs.edit().putString(key, id).apply()
        return id
    }

    fun context(config: AppConfig, prefs: SharedPreferences, deviceId: String): AnalyticsContext {
        val locale = Locale.getDefault().toLanguageTag()
        return AnalyticsContext(
            appVersion = token("${config.versionName}_${config.versionCode}", 32) ?: "0",
            anonId = anonId(prefs),
            deviceId = deviceId,
            osVersion = token(Build.VERSION.RELEASE.orEmpty(), 32),
            deviceModel = token(Build.MODEL.orEmpty(), 64),
            locale = locale.takeIf { LOCALE.matches(it) },
        )
    }

    private val OUTSIDE_TOKEN = Regex("[^A-Za-z0-9_.:/-]")

    /** [text] in the server's token set: anything outside it becomes "_" ("Pixel 8" is sent as Pixel_8), cut to [max]; null when empty. */
    fun token(text: String, max: Int): String? = text.replace(OUTSIDE_TOKEN, "_").take(max).ifEmpty { null }
}
