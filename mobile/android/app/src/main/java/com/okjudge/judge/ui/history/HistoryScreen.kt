package com.okjudge.judge.ui.history

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.selection.toggleable
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
import androidx.compose.runtime.saveable.Saver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.okjudge.judge.core.data.HistoryRepository
import com.okjudge.judge.core.data.SavedVerdict
import com.okjudge.judge.core.model.CaseSummary
import com.okjudge.judge.core.display.PartyNames
import com.okjudge.judge.core.display.RestoreNames
import com.okjudge.judge.core.display.SealSide
import com.okjudge.judge.core.display.VerdictDisplay
import com.okjudge.judge.i18n.AppLang
import com.okjudge.judge.ui.cases.CaseListFailed
import com.okjudge.judge.ui.cases.CaseListState
import com.okjudge.judge.ui.cases.CaseRow
import com.okjudge.judge.i18n.LocalLang
import com.okjudge.judge.i18n.LocalStrings
import com.okjudge.judge.ui.components.JudgeIcons
import com.okjudge.judge.ui.components.TextAction
import com.okjudge.judge.ui.components.TintedIcon
import com.okjudge.judge.ui.components.TopBar
import com.okjudge.judge.ui.theme.JudgeShapes
import com.okjudge.judge.ui.theme.JudgeType
import com.okjudge.judge.ui.theme.LocalSides
import com.okjudge.judge.ui.theme.Palette
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException
import java.time.format.FormatStyle

class HistoryViewModel(private val history: HistoryRepository) : ViewModel() {
    /** Null until the first read from the database. */
    val items: StateFlow<List<SavedVerdict>?> = history.observeAll()
        .map<List<SavedVerdict>, List<SavedVerdict>?> { it }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    fun delete(id: String) {
        viewModelScope.launch { history.delete(id) }
    }
}

object HistoryTags {
    const val LIST = "history.list"
    const val EMPTY = "history.empty"
    const val SELECT = "history.select"
    const val CANCEL = "history.cancel"
    const val SELECT_ALL = "history.selectAll"
    const val DELETE = "history.delete"
    const val CONFIRM_DELETE = "history.confirmDelete"
    fun row(id: String) = "history.row.$id"
}

/**
 * The rows picked in select mode. Only verdicts saved on this phone can be
 * picked: a case has no delete in the app.
 */
data class HistorySelection(val ids: Set<String> = emptySet()) {
    fun toggle(id: String) = HistorySelection(if (id in ids) ids - id else ids + id)

    fun allOf(selectable: List<String>) = selectable.isNotEmpty() && ids.containsAll(selectable)

    fun toggleAll(selectable: List<String>) = HistorySelection(if (allOf(selectable)) emptySet() else selectable.toSet())

    companion object {
        fun selectable(entries: List<HistoryEntry>): List<String> = entries.mapNotNull { (it as? HistoryEntry.Saved)?.verdict?.id }

        /** Null (not selecting) is not saved, so it restores as null too. */
        val Saver = Saver<HistorySelection?, ArrayList<String>>(
            save = { it?.let { s -> ArrayList(s.ids) } },
            restore = { HistorySelection(it.toSet()) },
        )
    }
}

/** A row of the Verdicts list: a verdict saved on this phone or one of the account's cases. */
sealed interface HistoryEntry {
    val key: String
    val at: Long

    data class Saved(val verdict: SavedVerdict) : HistoryEntry {
        override val key: String get() = "v:${verdict.id}"
        override val at: Long get() = verdict.createdAt
    }

    data class Case(val summary: CaseSummary) : HistoryEntry {
        override val key: String get() = "c:${summary.id}"
        override val at: Long = try {
            Instant.parse(summary.createdAt).toEpochMilli()
        } catch (_: DateTimeParseException) {
            0L
        }
    }
}

/** Both kinds in one list, newest first (mergeHistory in components/shell/useHistory.ts). */
fun mergeHistory(saved: List<SavedVerdict>, cases: List<CaseSummary>): List<HistoryEntry> =
    (saved.map { HistoryEntry.Saved(it) } + cases.map { HistoryEntry.Case(it) }).sortedByDescending { it.at }

/**
 * "Verdicts": the ones saved on this phone and, signed in with cases on, the
 * account's two-sided cases with their state, newest first. Swipe or
 * long-press a verdict to delete it from the phone, or pick several in
 * select mode.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun HistoryScreen(
    items: List<SavedVerdict>?,
    onOpen: (String) -> Unit,
    onDelete: (String) -> Unit,
    onNew: (() -> Unit)?,
    modifier: Modifier = Modifier,
    /** The account's two-sided cases; null leaves them out (cases off, signed out). */
    cases: CaseListState? = null,
    onOpenCase: (String) -> Unit = {},
    onRetryCases: () -> Unit = {},
) {
    val s = LocalStrings.current
    var confirmOne by rememberSaveable { mutableStateOf<String?>(null) }
    var selection by rememberSaveable(stateSaver = HistorySelection.Saver) { mutableStateOf<HistorySelection?>(null) }
    var confirmSelected by rememberSaveable { mutableStateOf(false) }
    val caseList = (cases as? CaseListState.Ready)?.cases.orEmpty()
    val entries = remember(items, caseList) { mergeHistory(items.orEmpty(), caseList) }
    val selectable = remember(entries) { HistorySelection.selectable(entries) }
    val picked = selection

    BackHandler(enabled = picked != null) { selection = null }

    Column(modifier.fillMaxSize()) {
        if (picked == null) {
            TopBar(onBack = null, onNew = onNew)
        } else {
            SelectBar(
                count = picked.ids.size,
                allSelected = picked.allOf(selectable),
                onCancel = { selection = null },
                onToggleAll = { selection = picked.toggleAll(selectable) },
                onDelete = { confirmSelected = true },
            )
        }
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(s.navVerdicts, style = JudgeType.sectionTitle.copy(fontSize = JudgeType.sectionTitle.fontSize * 1.3f), modifier = Modifier.weight(1f))
            if (picked == null && selectable.isNotEmpty()) {
                TextAction(s.appHistorySelect, { selection = HistorySelection() }, Modifier.testTag(HistoryTags.SELECT))
            }
        }
        when {
            items == null -> Unit
            entries.isEmpty() && cases == CaseListState.Loading -> Box(Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.TopCenter) {
                Text(s.caseLoading, style = JudgeType.body.copy(color = Palette.muted))
            }
            entries.isEmpty() && cases != CaseListState.Error -> Box(Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) {
                Text(s.appHistoryEmpty, style = JudgeType.lead, textAlign = TextAlign.Center, modifier = Modifier.testTag(HistoryTags.EMPTY))
            }
            else -> LazyColumn(
                Modifier.fillMaxSize().testTag(HistoryTags.LIST),
                contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                if (cases == CaseListState.Error) item { CaseListFailed(onRetryCases) }
                items(entries, key = { it.key }) { e ->
                    when (e) {
                        is HistoryEntry.Saved -> {
                            val item = e.verdict
                            if (picked != null) {
                                SelectableRow(item, item.id in picked.ids) { selection = picked.toggle(item.id) }
                            } else {
                                SwipeRow(item, onOpen = { onOpen(item.id) }, onDelete = { onDelete(item.id) }, onLongPress = { confirmOne = item.id })
                            }
                        }
                        is HistoryEntry.Case -> if (picked != null) {
                            Box(Modifier.alpha(0.4f)) { CaseRow(e.summary, onOpenCase, enabled = false) }
                        } else {
                            CaseRow(e.summary, onOpenCase)
                        }
                    }
                }
                if (items.isNotEmpty()) {
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
    }

    if (confirmSelected && picked != null) {
        AlertDialog(
            onDismissRequest = { confirmSelected = false },
            text = { Text(s.appHistoryDeleteConfirm(picked.ids.size), style = JudgeType.body) },
            confirmButton = {
                TextButton(
                    onClick = {
                        confirmSelected = false
                        picked.ids.forEach(onDelete)
                        selection = null
                    },
                    modifier = Modifier.testTag(HistoryTags.CONFIRM_DELETE),
                ) { Text(s.appHistoryDelete, color = Palette.danger) }
            },
            dismissButton = { TextButton(onClick = { confirmSelected = false }) { Text(s.appCancel, color = Palette.ink) } },
            containerColor = Palette.paper,
        )
    }
    confirmOne?.let { id ->
        AlertDialog(
            onDismissRequest = { confirmOne = null },
            text = { Text(items?.firstOrNull { it.id == id }?.let { restoredHeadline(it, LocalLang.current) } ?: "", style = JudgeType.body) },
            confirmButton = {
                TextButton(onClick = { confirmOne = null; onDelete(id) }) { Text(s.appHistoryDelete, color = Palette.danger) }
            },
            dismissButton = { TextButton(onClick = { confirmOne = null }) { Text(s.appCancel, color = Palette.ink) } },
            containerColor = Palette.paper,
        )
    }
}

/** The headline the row shows, with real names restored (display only), for the delete prompt. */
private fun restoredHeadline(item: SavedVerdict, lang: AppLang): String =
    RestoreNames.headline(item.translations[lang]?.result ?: item.original.result, item.nameMap, item.lang)

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
        HistoryRow(
            item,
            Modifier
                .combinedClickable(onClick = onOpen, onLongClick = onLongPress)
                .semantics { customActions = listOf(CustomAccessibilityAction(s.appHistoryDelete) { onDelete(); true }) },
        )
    }
}

/** A verdict in select mode: a tap picks it instead of opening it. */
@Composable
private fun SelectableRow(item: SavedVerdict, selected: Boolean, onToggle: () -> Unit) {
    val s = LocalStrings.current
    HistoryRow(
        item,
        Modifier
            .toggleable(value = selected, role = Role.Checkbox, onValueChange = { onToggle() })
            .semantics { stateDescription = if (selected) s.appHistoryRowSelected else s.appHistoryRowNotSelected },
        selected = selected,
    )
}

/** [selected] is null outside select mode, where the row has no check circle. */
@Composable
private fun HistoryRow(item: SavedVerdict, interaction: Modifier, selected: Boolean? = null) {
    val s = LocalStrings.current
    val lang = LocalLang.current
    val result = item.original.result
    val parties = PartyNames.partyNames(item.nameMap, item.lang, s)
    val label = VerdictDisplay.verdictLabel(result, parties, s)
    val shown = item.translations[lang]?.result ?: result
    val headline = remember(shown, item.nameMap, item.lang) { RestoreNames.headline(shown, item.nameMap, item.lang) }
    val date = remember(item.createdAt, lang) {
        DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(lang.locale)
            .format(Instant.ofEpochMilli(item.createdAt).atZone(ZoneId.systemDefault()))
    }
    val sealColor = when (VerdictDisplay.sealOf(result)) {
        SealSide.A -> LocalSides.current.a.ink
        SealSide.B -> LocalSides.current.b.ink
        SealSide.NONE -> Palette.ink
    }
    Row(
        Modifier
            .fillMaxWidth()
            .clip(JudgeShapes.card)
            .background(if (selected == true) Palette.terraTint else Palette.paper)
            .border(1.dp, if (selected == true) Palette.terra else Palette.line, JudgeShapes.card)
            .then(interaction)
            .testTag(HistoryTags.row(item.id))
            .padding(16.dp),
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        if (selected != null) SelectCircle(selected, Modifier.align(Alignment.CenterVertically))
        Box(Modifier.padding(top = 4.dp).size(14.dp).clip(CircleShape).background(sealColor))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(label, style = JudgeType.slotTitle.copy(fontSize = JudgeType.slotTitle.fontSize * 1.1f))
            Text(headline, style = JudgeType.headline, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text(date, style = JudgeType.footnote)
        }
    }
}

@Composable
private fun SelectCircle(selected: Boolean, modifier: Modifier = Modifier) {
    Box(
        modifier
            .size(22.dp)
            .clip(CircleShape)
            .then(if (selected) Modifier.background(Palette.terraInk) else Modifier.border(1.5.dp, Palette.line2, CircleShape)),
        contentAlignment = Alignment.Center,
    ) {
        if (selected) TintedIcon(remember { JudgeIcons.check() }, 14)
    }
}

/** Select mode's top bar: leave it, the count, pick or drop every verdict, delete. */
@Composable
private fun SelectBar(count: Int, allSelected: Boolean, onCancel: () -> Unit, onToggleAll: () -> Unit, onDelete: () -> Unit) {
    val s = LocalStrings.current
    Row(
        Modifier.fillMaxWidth().height(56.dp).padding(horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier
                .size(44.dp)
                .clip(CircleShape)
                .semantics {
                    role = Role.Button
                    contentDescription = s.appCancel
                }
                .clickable(onClick = onCancel)
                .testTag(HistoryTags.CANCEL),
            contentAlignment = Alignment.Center,
        ) {
            TintedIcon(remember { JudgeIcons.close(Palette.ink) }, 18)
        }
        Text(
            s.appHistorySelected(count),
            style = JudgeType.slotTitle.copy(fontSize = 17.sp),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f).padding(start = 8.dp).semantics { liveRegion = LiveRegionMode.Polite },
        )
        TextAction(
            if (allSelected) s.appHistoryDeselectAll else s.appHistorySelectAll,
            onToggleAll,
            Modifier.testTag(HistoryTags.SELECT_ALL),
        )
        TextAction(
            s.appHistoryDeleteCount(count.toString()),
            onDelete,
            Modifier.testTag(HistoryTags.DELETE),
            color = Palette.danger,
            enabled = count > 0,
        )
    }
}
