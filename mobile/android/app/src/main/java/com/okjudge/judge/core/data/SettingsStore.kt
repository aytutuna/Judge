package com.okjudge.judge.core.data

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.okjudge.judge.i18n.LangPref
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

/** App settings: the language choice. */
interface SettingsStore {
    val langPref: Flow<LangPref>
    suspend fun setLangPref(pref: LangPref)
}

private val Context.settingsDataStore: DataStore<Preferences> by preferencesDataStore(name = "settings")

class DataStoreSettings(context: Context) : SettingsStore {
    private val store = context.applicationContext.settingsDataStore

    override val langPref: Flow<LangPref> = store.data.map { LangPref.fromStored(it[LANG]) }

    override suspend fun setLangPref(pref: LangPref) {
        store.edit { it[LANG] = pref.stored }
    }

    private companion object {
        val LANG = stringPreferencesKey("lang")
    }
}
