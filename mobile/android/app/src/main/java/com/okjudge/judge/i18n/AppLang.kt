package com.okjudge.judge.i18n

import android.content.Context
import android.content.res.Configuration
import android.content.res.Resources
import androidx.compose.runtime.staticCompositionLocalOf
import java.util.EnumMap
import java.util.Locale

/** What the user picked in Settings. SYSTEM follows the phone. */
enum class LangPref(val stored: String) {
    SYSTEM("system"),
    EN("en"),
    TR("tr");

    /** System is Turkish when the device language starts with "tr" (lib/lang.ts). */
    fun resolve(deviceLanguageTag: String?): AppLang = when (this) {
        SYSTEM -> if (deviceLanguageTag?.lowercase(Locale.ROOT)?.startsWith("tr") == true) AppLang.TR else AppLang.EN
        EN -> AppLang.EN
        TR -> AppLang.TR
    }

    companion object {
        fun fromStored(value: String?): LangPref = entries.firstOrNull { it.stored == value } ?: SYSTEM
    }
}

/** The phone's first preferred language, read from the system (not the app's own config). */
fun deviceLanguageTag(): String? {
    val locales = Resources.getSystem().configuration.locales
    return if (locales.isEmpty) null else locales[0].toLanguageTag()
}

/**
 * One [Strings] per language, built from a configuration context so lookups
 * never depend on the process locale.
 */
class LocalizedStrings(private val context: Context) {
    private val cache = EnumMap<AppLang, Strings>(AppLang::class.java)

    @Synchronized
    fun of(lang: AppLang): Strings = cache.getOrPut(lang) {
        val config = Configuration(context.resources.configuration).apply { setLocale(lang.locale) }
        Strings(context.createConfigurationContext(config).resources)
    }
}

val LocalLang = staticCompositionLocalOf { AppLang.EN }
val LocalStrings = staticCompositionLocalOf<Strings> { error("LocalStrings not provided") }
