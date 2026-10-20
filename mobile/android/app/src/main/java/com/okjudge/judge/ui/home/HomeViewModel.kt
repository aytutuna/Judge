package com.okjudge.judge.ui.home

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.okjudge.judge.core.data.SettingsStore
import com.okjudge.judge.core.display.ArgumentRules
import com.okjudge.judge.core.display.Preset
import com.okjudge.judge.core.display.UiError
import com.okjudge.judge.core.session.VerdictFlow
import com.okjudge.judge.i18n.AppLang
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

data class HomeUiState(
    val argument: String = "",
    val preset: Preset = Preset.DEFAULT,
    val error: UiError? = null,
    val blockedUntil: Long? = null,
) {
    val canSubmit: Boolean get() = ArgumentRules.canSubmit(argument)
}

/**
 * The argument form. The draft survives rotation and process death through
 * [SavedStateHandle]; the request itself runs in [VerdictFlow].
 */
class HomeViewModel(
    private val saved: SavedStateHandle,
    private val settings: SettingsStore,
    private val flow: VerdictFlow,
) : ViewModel() {

    val state: StateFlow<HomeUiState> = combine(
        saved.getStateFlow(KEY_ARGUMENT, ""),
        settings.lastPreset,
        flow.lastError,
        flow.blockedUntil,
    ) { argument, preset, error, blocked ->
        HomeUiState(argument, preset, error, blocked)
    }.stateIn(viewModelScope, SharingStarted.Eagerly, HomeUiState(argument = saved[KEY_ARGUMENT] ?: ""))

    fun onArgumentChange(text: String) {
        saved[KEY_ARGUMENT] = text.take(ArgumentRules.MAX)
    }

    fun onExample(text: String) = onArgumentChange(text)

    fun onPreset(preset: Preset) {
        viewModelScope.launch { settings.setLastPreset(preset) }
    }

    /** Starts a verdict; true when the judging screen should open. */
    fun submit(lang: AppLang, now: Long = System.currentTimeMillis()): Boolean {
        val s = state.value
        if (!s.canSubmit) return false
        if ((s.blockedUntil ?: 0) > now) return false
        return flow.start(s.argument, s.preset, lang)
    }

    fun dismissError() = flow.dismissError()

    /** "Judge another": back to an empty form. */
    fun clear() {
        saved[KEY_ARGUMENT] = ""
        flow.dismissError()
    }

    private companion object {
        const val KEY_ARGUMENT = "argument"
    }
}
