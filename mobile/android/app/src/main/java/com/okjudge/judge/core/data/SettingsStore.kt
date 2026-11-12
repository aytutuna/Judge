package com.okjudge.judge.core.data

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.core.handlers.ReplaceFileCorruptionHandler
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.emptyPreferences
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.okjudge.judge.i18n.LangPref
import java.io.IOException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.map

/** Light, dark, or whatever the phone is set to. */
enum class Appearance(val stored: String) {
    SYSTEM("system"),
    LIGHT("light"),
    DARK("dark");

    fun isDark(systemDark: Boolean): Boolean = when (this) {
        SYSTEM -> systemDark
        LIGHT -> false
        DARK -> true
    }

    companion object {
        fun fromStored(value: String?): Appearance = entries.firstOrNull { it.stored == value } ?: SYSTEM
    }
}

/** App settings: the language choice, the appearance and whether usage statistics are sent. */
interface SettingsStore {
    val langPref: Flow<LangPref>
    suspend fun setLangPref(pref: LangPref)

    val appearance: Flow<Appearance>
    suspend fun setAppearance(appearance: Appearance)

    /** On unless the user turned it off. */
    val usageStats: Flow<Boolean>
    suspend fun setUsageStats(on: Boolean)

    /** The street court on the home and judging screens; on unless the user turned it off. */
    val gamify: Flow<Boolean>
    suspend fun setGamify(on: Boolean)
}

private val Context.settingsDataStore: DataStore<Preferences> by preferencesDataStore(
    name = "settings",
    corruptionHandler = ReplaceFileCorruptionHandler { emptyPreferences() },
)

class DataStoreSettings(context: Context) : SettingsStore {
    private val store = context.applicationContext.settingsDataStore

    // An unreadable file that is not corrupt reads as the defaults.
    private val data: Flow<Preferences> = store.data.catch {
        if (it is IOException) emit(emptyPreferences()) else throw it
    }

    override val langPref: Flow<LangPref> = data.map { LangPref.fromStored(it[LANG]) }

    override suspend fun setLangPref(pref: LangPref) {
        store.edit { it[LANG] = pref.stored }
    }

    override val appearance: Flow<Appearance> = data.map { Appearance.fromStored(it[APPEARANCE]) }

    override suspend fun setAppearance(appearance: Appearance) {
        store.edit { it[APPEARANCE] = appearance.stored }
    }

    override val usageStats: Flow<Boolean> = data.map { it[USAGE_STATS] ?: true }

    override suspend fun setUsageStats(on: Boolean) {
        store.edit { it[USAGE_STATS] = on }
    }

    override val gamify: Flow<Boolean> = data.map { it[GAMIFY] ?: true }

    override suspend fun setGamify(on: Boolean) {
        store.edit { it[GAMIFY] = on }
    }

    private companion object {
        val LANG = stringPreferencesKey("lang")
        val APPEARANCE = stringPreferencesKey("appearance")
        val USAGE_STATS = booleanPreferencesKey("usage_stats")
        val GAMIFY = booleanPreferencesKey("gamify")
    }
}
