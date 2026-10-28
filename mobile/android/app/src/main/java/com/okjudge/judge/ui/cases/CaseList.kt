package com.okjudge.judge.ui.cases

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.okjudge.judge.core.api.ApiResult
import com.okjudge.judge.core.api.JudgeApi
import com.okjudge.judge.core.cases.CaseLogic
import com.okjudge.judge.core.display.Errors
import com.okjudge.judge.core.model.CaseSummary
import com.okjudge.judge.i18n.LocalLang
import com.okjudge.judge.i18n.LocalStrings
import com.okjudge.judge.ui.components.GhostButton
import com.okjudge.judge.ui.theme.JudgeShapes
import com.okjudge.judge.ui.theme.JudgeType
import com.okjudge.judge.ui.theme.Palette
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

sealed interface CaseListState {
    data object Loading : CaseListState
    data class Ready(val cases: List<CaseSummary>) : CaseListState
    data object Error : CaseListState
}

/** GET /api/v1/cases?limit=20 for the signed-in account (useCaseList). */
class CaseListViewModel(private val api: JudgeApi) : ViewModel() {
    private val _state = MutableStateFlow<CaseListState>(CaseListState.Loading)
    val state: StateFlow<CaseListState> = _state.asStateFlow()

    init {
        reload()
    }

    fun reload() {
        viewModelScope.launch {
            if (_state.value !is CaseListState.Ready) _state.value = CaseListState.Loading
            _state.value = when (val res = api.listCases(LIMIT)) {
                is ApiResult.Ok -> CaseListState.Ready(res.value.cases)
                is ApiResult.Err -> if (_state.value is CaseListState.Ready) _state.value else CaseListState.Error
            }
        }
    }

    companion object {
        const val LIMIT = 20
    }
}

object CaseListTags {
    const val ERROR = "cases.error"
    fun row(id: String) = "cases.row.$id"
}

/**
 * A case in the Verdicts list: titled by the anonymized verdict headline,
 * else the first words of your side, else the start date, with its state
 * or the removed mark.
 */
@Composable
fun CaseRow(c: CaseSummary, onOpen: (String) -> Unit) {
    val s = LocalStrings.current
    val lang = LocalLang.current
    val date = Errors.formatDate(lang, c.createdAt)
    val title = c.headline
        ?: c.excerpt?.let { CaseLogic.localizeLabelsAuto(it) }
        ?: (date?.let { s.caseListUntitled(it) } ?: s.caseListUntitledSoon)
    Column(
        Modifier
            .fillMaxWidth()
            .clip(JudgeShapes.card)
            .background(Palette.paper)
            .border(1.dp, Palette.line, JudgeShapes.card)
            .clickable(role = Role.Button) { onOpen(c.id) }
            .testTag(CaseListTags.row(c.id))
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(title, style = JudgeType.headline.copy(color = Palette.ink), maxLines = 2, overflow = TextOverflow.Ellipsis)
        if (date != null) Text(s.caseListStarted(date), style = JudgeType.footnote)
        if (c.removed) {
            Text(
                s.accountVerdictsRemoved,
                style = JudgeType.small.copy(fontSize = 12.sp),
                modifier = Modifier
                    .clip(JudgeShapes.chip)
                    .border(1.dp, Palette.line2, JudgeShapes.chip)
                    .padding(horizontal = 10.dp, vertical = 5.dp),
            )
        } else {
            StatusChip(c.status)
        }
    }
}

/** The account's cases could not be loaded: said above the rest of the list. */
@Composable
fun CaseListFailed(onRetry: () -> Unit) {
    val s = LocalStrings.current
    Column(
        Modifier.fillMaxWidth().padding(vertical = 8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(s.caseListLoadFailed, style = JudgeType.body.copy(color = Palette.danger), modifier = Modifier.testTag(CaseListTags.ERROR))
        GhostButton(s.appRetry, null, onRetry)
    }
}
