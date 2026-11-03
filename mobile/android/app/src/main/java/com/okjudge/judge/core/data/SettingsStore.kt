package com.okjudge.judge.core.data

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.okjudge.judge.i18n.LangPref
import kotlinx.coroutines.flow.Flow
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
}

private val Context.settingsDataStore: DataStore<Preferences> by preferencesDataStore(name = "settings")

class DataStoreSettings(context: Context) : SettingsStore {
    private val store = context.applicationContext.settingsDataStore

    override val langPref: Flow<LangPref> = store.data.map { LangPref.fromStored(it[LANG]) }

    override suspend fun setLangPref(pref: LangPref) {
        store.edit { it[LANG] = pref.stored }
    }

    override val appearance: Flow<Appearance> = store.data.map { Appearance.fromStored(it[APPEARANCE]) }

    override suspend fun setAppearance(appearance: Appearance) {
        store.edit { it[APPEARANCE] = appearance.stored }
    }

    override val usageStats: Flow<Boolean> = store.data.map { it[USAGE_STATS] ?: true }

    override suspend fun setUsageStats(on: Boolean) {
        store.edit { it[USAGE_STATS] = on }
    }

    private companion object {
        val LANG = stringPreferencesKey("lang")
        val APPEARANCE = stringPreferencesKey("appearance")
        val USAGE_STATS = booleanPreferencesKey("usage_stats")
    }
}
