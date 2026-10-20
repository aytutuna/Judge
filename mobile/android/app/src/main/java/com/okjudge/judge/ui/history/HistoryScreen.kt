package com.okjudge.judge.ui.history

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.SwipeToDismissBox
import androidx.compose.material3.SwipeToDismissBoxValue
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberSwipeToDismissBoxState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.okjudge.judge.core.data.HistoryRepository
import com.okjudge.judge.core.data.SavedVerdict
import com.okjudge.judge.core.display.PartyNames
import com.okjudge.judge.core.display.RestoreNames
import com.okjudge.judge.core.display.SealSide
import com.okjudge.judge.core.display.VerdictDisplay
import com.okjudge.judge.i18n.LocalLang
import com.okjudge.judge.i18n.LocalStrings
import com.okjudge.judge.ui.components.JudgeIcons
import com.okjudge.judge.ui.components.TextAction
import com.okjudge.judge.ui.components.TintedIcon
import com.okjudge.judge.ui.components.TopBar
import com.okjudge.judge.ui.theme.JudgeShapes
import com.okjudge.judge.ui.theme.JudgeType
import com.okjudge.judge.ui.theme.Palette
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

class HistoryViewModel(private val history: HistoryRepository) : ViewModel() {
    /** Null until the first read from the database. */
    val items: StateFlow<List<SavedVerdict>?> = history.observeAll()
        .map<List<SavedVerdict>, List<SavedVerdict>?> { it }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    fun delete(id: String) {
        viewModelScope.launch { history.delete(id) }
    }

    fun deleteAll() {
        viewModelScope.launch { history.deleteAll() }
    }
}

object HistoryTags {
    const val LIST = "history.list"
    const val EMPTY = "history.empty"
    fun row(id: String) = "history.row.$id"
}

/** "My verdicts": saved on this phone, newest first; swipe or long-press to delete. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun HistoryScreen(
    items: List<SavedVerdict>?,
    onOpen: (String) -> Unit,
    onDelete: (String) -> Unit,
    onDeleteAll: () -> Unit,
    onToggleLang: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val s = LocalStrings.current
    var confirmAll by rememberSaveable { mutableStateOf(false) }
    var confirmOne by rememberSaveable { mutableStateOf<String?>(null) }

    Column(modifier.fillMaxSize()) {
        TopBar(onBack = null, onToggleLang = onToggleLang)
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(s.appHistoryTitle, style = JudgeType.sectionTitle.copy(fontSize = JudgeType.sectionTitle.fontSize * 1.3f), modifier = Modifier.weight(1f))
            if (!items.isNullOrEmpty()) TextAction(s.appHistoryClearAll, { confirmAll = true })
        }
        when {
            items == null -> Unit
            items.isEmpty() -> Box(Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) {
                Text(s.appHistoryEmpty, style = JudgeType.lead, textAlign = TextAlign.Center, modifier = Modifier.testTag(HistoryTags.EMPTY))
            }
            else -> LazyColumn(
                Modifier.fillMaxSize().testTag(HistoryTags.LIST),
                contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                items(items, key = { it.id }) { item ->
                    SwipeRow(item, onOpen = { onOpen(item.id) }, onDelete = { onDelete(item.id) }, onLongPress = { confirmOne = item.id })
                }
                item {
                    Text(
                        s.appHistoryDeviceOnly,
                        style = JudgeType.footnote,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.fillMaxWidth().padding(vertical = 16.dp, horizontal = 12.dp),
                    )
                }
            }
        }
    }

    if (confirmAll) {
        AlertDialog(
            onDismissRequest = { confirmAll = false },
            text = { Text(s.appHistoryClearConfirm, style = JudgeType.body) },
            confirmButton = {
                TextButton(onClick = { confirmAll = false; onDeleteAll() }) { Text(s.appHistoryClearYes, color = Palette.danger) }
            },
            dismissButton = { TextButton(onClick = { confirmAll = false }) { Text(s.appCancel, color = Palette.ink) } },
            containerColor = Palette.paper,
        )
    }
    confirmOne?.let { id ->
        AlertDialog(
            onDismissRequest = { confirmOne = null },
            text = { Text(items?.firstOrNull { it.id == id }?.let(::restoredOriginalHeadline) ?: "", style = JudgeType.body) },
            confirmButton = {
                TextButton(onClick = { confirmOne = null; onDelete(id) }) { Text(s.appHistoryDelete, color = Palette.danger) }
            },
            dismissButton = { TextButton(onClick = { confirmOne = null }) { Text(s.appCancel, color = Palette.ink) } },
            containerColor = Palette.paper,
        )
    }
}

/** The original headline with real names restored (display only), for the delete prompt. */
private fun restoredOriginalHeadline(item: SavedVerdict): String =
    RestoreNames.headline(item.original.result, item.nameMap, item.lang)

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun SwipeRow(item: SavedVerdict, onOpen: () -> Unit, onDelete: () -> Unit, onLongPress: () -> Unit) {
    val s = LocalStrings.current
    val state = rememberSwipeToDismissBoxState()
    if (state.currentValue == SwipeToDismissBoxValue.EndToStart) {
        LaunchedEffect(item.id) { onDelete() }
    }
    SwipeToDismissBox(
        state = state,
        enableDismissFromStartToEnd = false,
        backgroundContent = {
            Row(
                Modifier.fillMaxSize().clip(JudgeShapes.card).background(Palette.terraTint).padding(horizontal = 24.dp),
                horizontalArrangement = Arrangement.End,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                TintedIcon(remember { JudgeIcons.trash(Palette.danger) }, 18)
                Spacer(Modifier.size(8.dp))
                Text(s.appHistoryDelete, style = JudgeType.small.copy(color = Palette.danger))
            }
        },
    ) {
        HistoryRow(item, onOpen, onLongPress, onDelete)
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun HistoryRow(item: SavedVerdict, onOpen: () -> Unit, onLongPress: () -> Unit, onDelete: () -> Unit) {
    val s = LocalStrings.current
    val lang = LocalLang.current
    val result = item.original.result
    val parties = PartyNames.partyNames(item.nameMap, item.lang, s)
    val label = VerdictDisplay.verdictLabel(result, parties, s)
    val shown = item.translations[lang]?.result ?: result
    val headline = remember(shown, item.nameMap) { RestoreNames.headline(shown, item.nameMap, item.lang) }
    val date = remember(item.createdAt, lang) {
        DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(lang.locale)
            .format(Instant.ofEpochMilli(item.createdAt).atZone(ZoneId.systemDefault()))
    }
    val sealColor = when (VerdictDisplay.sealOf(result)) {
        SealSide.A -> Palette.terraInk
        SealSide.B -> Palette.sageInk
        SealSide.NONE -> Palette.ink
    }
    Row(
        Modifier
            .fillMaxWidth()
            .clip(JudgeShapes.card)
            .background(Palette.paper)
            .border(1.dp, Palette.line, JudgeShapes.card)
            .combinedClickable(onClick = onOpen, onLongClick = onLongPress)
            .semantics { customActions = listOf(CustomAccessibilityAction(s.appHistoryDelete) { onDelete(); true }) }
            .testTag(HistoryTags.row(item.id))
            .padding(16.dp),
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Box(Modifier.padding(top = 4.dp).size(14.dp).clip(CircleShape).background(sealColor))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(label, style = JudgeType.slotTitle.copy(fontSize = JudgeType.slotTitle.fontSize * 1.1f))
            Text(headline, style = JudgeType.headline, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text(date, style = JudgeType.footnote)
        }
    }
}
