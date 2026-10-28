package com.okjudge.judge.core.data

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.okjudge.judge.core.display.Preset
import com.okjudge.judge.i18n.LangPref
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

/** App settings: language choice and the last framework preset. */
interface SettingsStore {
    val langPref: Flow<LangPref>
    val lastPreset: Flow<Preset>
    suspend fun setLangPref(pref: LangPref)
    suspend fun setLastPreset(preset: Preset)
}

private val Context.settingsDataStore: DataStore<Preferences> by preferencesDataStore(name = "settings")

class DataStoreSettings(context: Context) : SettingsStore {
    private val store = context.applicationContext.settingsDataStore

    override val langPref: Flow<LangPref> = store.data.map { LangPref.fromStored(it[LANG]) }
    override val lastPreset: Flow<Preset> = store.data.map { Preset.of(it[PRESET]) }

    override suspend fun setLangPref(pref: LangPref) {
        store.edit { it[LANG] = pref.stored }
    }

    override suspend fun setLastPreset(preset: Preset) {
        store.edit { it[PRESET] = preset.id }
    }

    private companion object {
        val LANG = stringPreferencesKey("lang")
        val PRESET = stringPreferencesKey("last_preset")
    }
}
