package com.okjudge.judge.core.data

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.okjudge.judge.core.display.Preset
import com.okjudge.judge.core.premium.Tier
import com.okjudge.judge.i18n.LangPref
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

/** App settings: language choice, the last framework preset and the Free / Premium choice. */
interface SettingsStore {
    val langPref: Flow<LangPref>
    val lastPreset: Flow<Preset>
    /** Only a preference (lib/tier.ts): it asks for premium only while premium can be used. Default free. */
    val tierChoice: Flow<Tier>
    suspend fun setLangPref(pref: LangPref)
    suspend fun setLastPreset(preset: Preset)
    suspend fun setTierChoice(tier: Tier)
}

private val Context.settingsDataStore: DataStore<Preferences> by preferencesDataStore(name = "settings")

class DataStoreSettings(context: Context) : SettingsStore {
    private val store = context.applicationContext.settingsDataStore

    override val langPref: Flow<LangPref> = store.data.map { LangPref.fromStored(it[LANG]) }
    override val lastPreset: Flow<Preset> = store.data.map { Preset.of(it[PRESET]) }
    override val tierChoice: Flow<Tier> = store.data.map { Tier.of(it[TIER]) }

    override suspend fun setLangPref(pref: LangPref) {
        store.edit { it[LANG] = pref.stored }
    }

    override suspend fun setLastPreset(preset: Preset) {
        store.edit { it[PRESET] = preset.id }
    }

    override suspend fun setTierChoice(tier: Tier) {
        store.edit { it[TIER] = tier.raw }
    }

    private companion object {
        val LANG = stringPreferencesKey("lang")
        val PRESET = stringPreferencesKey("last_preset")
        val TIER = stringPreferencesKey("tier")
    }
}
