package com.okjudge.judge.core.feedback

import com.okjudge.judge.core.api.ApiResult
import com.okjudge.judge.core.api.JudgeApi
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.time.LocalDate

/** "Download my data": fetches the JSON, then hands it to the screen to save where the person picks. */
class DataExport(private val api: JudgeApi, private val scope: CoroutineScope, private val today: () -> LocalDate = LocalDate::now) {
    sealed interface State {
        data object Idle : State
        data object Busy : State
        data object Failed : State

        /** The file is fetched; [picking] once the screen has opened the picker for where it goes. */
        data class Ready(val name: String, val json: String, val picking: Boolean = false) : State
    }

    private val _state = MutableStateFlow<State>(State.Idle)
    val state: StateFlow<State> = _state.asStateFlow()

    fun start() {
        if (_state.value == State.Busy) return
        _state.value = State.Busy
        scope.launch {
            _state.value = when (val res = api.exportData()) {
                is ApiResult.Ok -> State.Ready("judge-data-${today()}.json", res.value)
                is ApiResult.Err -> State.Failed
            }
        }
    }

    fun picking() {
        (_state.value as? State.Ready)?.let { _state.value = it.copy(picking = true) }
    }

    /** The file was saved, or the picker was left. */
    fun done() {
        _state.value = State.Idle
    }

    fun failed() {
        _state.value = State.Failed
    }
}
