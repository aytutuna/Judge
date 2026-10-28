package com.okjudge.judge.i18n

import android.app.LocaleManager
import android.content.Context
import android.content.res.Configuration
import android.content.res.Resources
import android.os.Build
import androidx.compose.runtime.staticCompositionLocalOf
import java.util.EnumMap
import java.util.Locale

/** What the user picked in Settings: a language, or none to follow the phone. */
data class LangPref(val fixed: AppLang?) {
    /** "system" or the language's code, as stored. */
    val stored: String get() = fixed?.tag ?: "system"

    /** Following the phone takes the first of its languages the app speaks,
     * like the website (matchLang in lib/langs.ts). */
    fun resolve(deviceTags: List<String>): AppLang = fixed ?: matchLang(deviceTags)

    companion object {
        val SYSTEM = LangPref(null)

        /** Anything but an enabled language's code, "system" included, follows the phone. */
        fun fromStored(value: String?): LangPref = LangPref(AppLang.fromTag(value)?.takeIf { it in AppLang.enabled })
    }
}

/**
 * The language a BCP-47 tag means, as langOfTag in lib/langs.ts reads it:
 * Chinese goes by script, then region; Portuguese is Brazilian unless another
 * region is given; every Norwegian tag means Bokmål. Android's old codes for
 * Hebrew and Indonesian count too.
 */
fun langOfTag(tag: String): AppLang? {
    val parts = tag.trim().lowercase(Locale.ROOT).split('-', '_')
    val rest = parts.drop(1)
    return when (val base = parts.first()) {
        "zh" -> if ("hans" !in rest && ("hant" in rest || rest.any { it == "tw" || it == "hk" || it == "mo" })) AppLang.ZH_HANT else AppLang.ZH_HANS
        "pt" -> if (rest.isEmpty() || "br" in rest) AppLang.PT_BR else AppLang.PT_PT
        "no", "nn", "nb" -> AppLang.NB
        "iw" -> AppLang.HE
        "in" -> AppLang.ID
        else -> AppLang.fromTag(base)
    }
}

/** The first of [tags] the app speaks, else English. */
fun matchLang(tags: List<String>): AppLang =
    tags.firstNotNullOfOrNull { tag -> langOfTag(tag)?.takeIf { it in AppLang.enabled } } ?: AppLang.EN

/** The name of [of] in the words of [ui] ("Turkish", "İngilizce"), as
 * languageName in lib/i18n.ts: English and Turkish from the strings, the
 * rest from the system. */
fun languageName(of: AppLang, ui: AppLang, s: Strings): String = when (of) {
    AppLang.EN -> s.respondLangEn
    AppLang.TR -> s.respondLangTr
    else -> of.locale.getDisplayName(ui.locale).ifEmpty { of.nativeName }
}

/**
 * The phone's preferred languages, in order: the one picked for this app in
 * the system settings (Android 13+), else the system's own list. Never the
 * app's resource configuration, which follows the in-app choice.
 */
fun deviceLanguageTags(context: Context): List<String> {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        val picked = context.getSystemService(LocaleManager::class.java)?.applicationLocales
        if (picked != null && !picked.isEmpty) return picked.toLanguageTags().split(',')
    }
    return Resources.getSystem().configuration.locales.toLanguageTags().split(',').filter { it.isNotEmpty() }
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
