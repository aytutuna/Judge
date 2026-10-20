package com.okjudge.judge.i18n

import android.content.Context
import android.content.res.Configuration
import android.content.res.Resources
import androidx.compose.runtime.staticCompositionLocalOf
import java.util.EnumMap
import java.util.Locale

/**
 * The two languages the app speaks. Passed explicitly to every string
 * lookup (like the web's `t(lang, key)`), so the in-app toggle switches the
 * whole UI at once without recreating the Activity.
 */
enum class AppLang(val tag: String) {
    EN("en"),
    TR("tr");

    val locale: Locale get() = Locale.forLanguageTag(tag)

    companion object {
        fun fromTag(tag: String?): AppLang? = entries.firstOrNull { it.tag == tag }

        /** Same rule as lib/lang.ts: Turkish when the device language starts with "tr". */
        fun fromDeviceTag(languageTag: String?): AppLang =
            if (languageTag?.lowercase(Locale.ROOT)?.startsWith("tr") == true) TR else EN
    }
}

/** What the user picked in Settings. SYSTEM follows the phone. */
enum class LangPref(val stored: String) {
    SYSTEM("system"),
    EN("en"),
    TR("tr");

    fun resolve(deviceLanguageTag: String?): AppLang = when (this) {
        SYSTEM -> AppLang.fromDeviceTag(deviceLanguageTag)
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
