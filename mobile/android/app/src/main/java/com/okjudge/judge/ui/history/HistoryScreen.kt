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
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.SwipeToDismissBox
import androidx.compose.material3.SwipeToDismissBoxValue
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberSwipeToDismissBoxState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
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
import androidx.compose.ui.graphics.Color
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
import com.okjudge.judge.core.data.SavedVerdict
import com.okjudge.judge.core.data.parseIso
import com.okjudge.judge.core.display.PartyNames
import com.okjudge.judge.core.display.RestoreNames
import com.okjudge.judge.core.display.SealSide
import com.okjudge.judge.core.display.VerdictDisplay
import com.okjudge.judge.core.model.HistoryItem
import com.okjudge.judge.i18n.AppLang
import com.okjudge.judge.i18n.LocalLang
import com.okjudge.judge.i18n.LocalStrings
import com.okjudge.judge.i18n.Strings
import com.okjudge.judge.ui.components.GhostButton
import com.okjudge.judge.ui.components.JudgeIcons
import com.okjudge.judge.ui.components.TextAction
import com.okjudge.judge.ui.components.TintedIcon
import com.okjudge.judge.ui.components.TopBar
import com.okjudge.judge.ui.theme.JudgeShapes
import com.okjudge.judge.ui.theme.JudgeType
import com.okjudge.judge.ui.theme.LocalSides
import com.okjudge.judge.ui.theme.Palette
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

object HistoryTags {
    const val LIST = "history.list"
    const val EMPTY = "history.empty"
    const val ERROR = "history.error"
    const val NOTICE = "history.notice"
    const val SELECT = "history.select"
    const val CANCEL = "history.cancel"
    const val SELECT_ALL = "history.selectAll"
    const val DELETE = "history.delete"
    const val CONFIRM_DELETE = "history.confirmDelete"
    const val MORE = "history.more"
    const val PHONE_NOTE = "history.phoneNote"
    fun row(key: String) = "history.row.$key"
}

/** The rows picked in select mode, by entry key. */
data class HistorySelection(val ids: Set<String> = emptySet()) {
    fun toggle(id: String) = HistorySelection(if (id in ids) ids - id else ids + id)

    fun allOf(selectable: List<String>) = selectable.isNotEmpty() && ids.containsAll(selectable)

    fun toggleAll(selectable: List<String>) = HistorySelection(if (allOf(selectable)) emptySet() else selectable.toSet())

    companion object {
        /** Phone rows, and account rows whose own page offers Remove (the website's case tools). */
        fun selectable(entries: List<HistoryEntry>): List<String> = entries.filter { it.selectable }.map { it.key }

        /** Null (not selecting) is not saved, so it restores as null too. */
        val Saver = Saver<HistorySelection?, ArrayList<String>>(
            save = { it?.let { s -> ArrayList(s.ids) } },
            restore = { HistorySelection(it.toSet()) },
        )
    }
}

/**
 * "Verdicts": the account's verdicts and cases (started or answered) with
 * where each one stands, and verdicts kept only on this phone, newest
 * first. More load near the end, or with Show more. Swipe or long-press a
 * row to remove it, or pick several in select mode.
 */
@Composable
fun HistoryScreen(
    entries: List<HistoryEntry>?,
    onOpen: (HistoryEntry) -> Unit,
    /** Removes the picked rows and reports the keys that failed (they stay picked). */
    onRemove: (List<HistoryEntry>, (Set<String>) -> Unit) -> Unit,
    onNew: (() -> Unit)?,
    modifier: Modifier = Modifier,
    paging: HistoryPaging = HistoryPaging(),
    notice: HistoryNotice? = null,
    onLoadMore: () -> Unit = {},
    onRetry: () -> Unit = {},
    /** For invites whose time ran out since the list was loaded. */
    now: Long = System.currentTimeMillis(),
) {
    val s = LocalStrings.current
    var confirmOne by rememberSaveable { mutableStateOf<String?>(null) }
    var selection by rememberSaveable(stateSaver = HistorySelection.Saver) { mutableStateOf<HistorySelection?>(null) }
    var confirmSelected by rememberSaveable { mutableStateOf(false) }
    val list = entries.orEmpty()
    val selectable = remember(list) { HistorySelection.selectable(list) }
    val picked = selection
    val listState = rememberLazyListState()
    val nearEnd by remember {
        derivedStateOf {
            val info = listState.layoutInfo
            val last = info.visibleItemsInfo.lastOrNull()?.index ?: return@derivedStateOf false
            last >= info.totalItemsCount - 3
        }
    }
    LaunchedEffect(nearEnd, paging.next) {
        if (nearEnd && paging.next != null) onLoadMore()
    }

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
        if (notice != null) {
            Text(
                noticeText(notice, s),
                style = JudgeType.body.copy(color = Palette.danger, fontSize = 15.sp),
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp, vertical = 6.dp)
                    .testTag(HistoryTags.NOTICE)
                    .semantics { liveRegion = LiveRegionMode.Polite },
            )
        }
        when {
            entries == null -> Unit
            list.isEmpty() && paging.loading -> Box(Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.TopCenter) {
                Text(s.caseLoading, style = JudgeType.body.copy(color = Palette.muted))
            }
            list.isEmpty() && paging.failed -> Box(Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.TopCenter) {
                LoadFailed(onRetry)
            }
            list.isEmpty() -> Box(Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) {
                Text(s.appHistoryEmpty, style = JudgeType.lead, textAlign = TextAlign.Center, modifier = Modifier.testTag(HistoryTags.EMPTY))
            }
            else -> LazyColumn(
                Modifier.fillMaxSize().testTag(HistoryTags.LIST),
                state = listState,
                contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                if (paging.failed) item { LoadFailed(onRetry) }
                items(list, key = { it.key }) { e ->
                    when {
                        picked != null && e.selectable -> {
                            val on = e.key in picked.ids
                            EntryRow(
                                e,
                                now,
                                Modifier
                                    .toggleable(value = on, role = Role.Checkbox, onValueChange = { selection = picked.toggle(e.key) })
                                    .semantics { stateDescription = if (on) s.appHistoryRowSelected else s.appHistoryRowNotSelected },
                                selected = on,
                            )
                        }
                        picked != null -> Box(Modifier.alpha(0.4f)) { EntryRow(e, now, Modifier) }
                        e.selectable -> SwipeRow(e, now, onOpen = { onOpen(e) }, onAskRemove = { confirmOne = e.key })
                        else -> EntryRow(e, now, if (opens(e)) Modifier.clickable(role = Role.Button) { onOpen(e) } else Modifier)
                    }
                }
                if (paging.next != null) {
                    item {
                        Box(Modifier.fillMaxWidth().padding(vertical = 8.dp), contentAlignment = Alignment.Center) {
                            if (paging.loadingMore) {
                                CircularProgressIndicator(Modifier.size(22.dp), color = Palette.muted, strokeWidth = 2.dp)
                            } else {
                                GhostButton(s.shellLoadMore, null, onLoadMore, Modifier.testTag(HistoryTags.MORE))
                            }
                        }
                    }
                }
                if (list.any { it is HistoryEntry.Phone }) {
                    item {
                        Text(
                            s.appHistoryPhoneOnlyNote,
                            style = JudgeType.footnote,
                            textAlign = TextAlign.Center,
                            modifier = Modifier.fillMaxWidth().padding(vertical = 16.dp, horizontal = 12.dp).testTag(HistoryTags.PHONE_NOTE),
                        )
                    }
                }
            }
        }
    }

    if (confirmSelected && picked != null) {
        RemoveDialog(
            text = HistoryLabels.removeConfirm(list.filter { it.key in picked.ids }, s),
            onDismiss = { confirmSelected = false },
            onConfirm = {
                confirmSelected = false
                onRemove(list.filter { it.key in picked.ids }) { failed -> selection = if (failed.isEmpty()) null else HistorySelection(failed) }
            },
        )
    }
    confirmOne?.let { key ->
        RemoveDialog(
            text = HistoryLabels.removeConfirm(list.filter { it.key == key }, s),
            onDismiss = { confirmOne = null },
            onConfirm = {
                confirmOne = null
                onRemove(list.filter { it.key == key }) {}
            },
        )
    }
}

private fun opens(e: HistoryEntry) = when (e) {
    is HistoryEntry.Account -> HistoryLabels.openable(e.item)
    is HistoryEntry.Phone -> true
}

private fun noticeText(notice: HistoryNotice, s: Strings) = when (notice) {
    HistoryNotice.Offline -> s.appHistoryOfflineRemove
    is HistoryNotice.RemoveFailed -> s.appHistoryRemoveFailed(notice.count)
    HistoryNotice.OpenFailed -> s.errorFallback
}

@Composable
private fun RemoveDialog(text: String, onDismiss: () -> Unit, onConfirm: () -> Unit) {
    val s = LocalStrings.current
    AlertDialog(
        onDismissRequest = onDismiss,
        text = { Text(text, style = JudgeType.body) },
        confirmButton = {
            TextButton(onClick = onConfirm, modifier = Modifier.testTag(HistoryTags.CONFIRM_DELETE)) { Text(s.appHistoryDelete, color = Palette.danger) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(s.appCancel, color = Palette.ink) } },
        containerColor = Palette.paper,
    )
}

/** The list could not be loaded: said above whatever the phone has. */
@Composable
private fun LoadFailed(onRetry: () -> Unit) {
    val s = LocalStrings.current
    Column(
        Modifier.fillMaxWidth().padding(vertical = 8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(s.shellLoadFailed, style = JudgeType.body.copy(color = Palette.danger), modifier = Modifier.testTag(HistoryTags.ERROR))
        GhostButton(s.appRetry, null, onRetry)
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun SwipeRow(entry: HistoryEntry, now: Long, onOpen: () -> Unit, onAskRemove: () -> Unit) {
    val s = LocalStrings.current
    val state = rememberSwipeToDismissBoxState()
    // A swipe asks first: removing from the account can't be undone.
    LaunchedEffect(state.currentValue) {
        if (state.currentValue == SwipeToDismissBoxValue.EndToStart) {
            onAskRemove()
            state.reset()
        }
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
        EntryRow(
            entry,
            now,
            Modifier
                .combinedClickable(enabled = opens(entry), onClick = onOpen, onLongClick = onAskRemove)
                .semantics { customActions = listOf(CustomAccessibilityAction(s.appHistoryDelete) { onAskRemove(); true }) },
        )
    }
}

/** [selected] is null outside select mode, where the row has no check circle. */
@Composable
private fun EntryRow(entry: HistoryEntry, now: Long, interaction: Modifier, selected: Boolean? = null) {
    when (entry) {
        is HistoryEntry.Account -> AccountRow(entry.item, now, interaction, selected)
        is HistoryEntry.Phone -> PhoneRow(entry.verdict, interaction, selected)
    }
}

@Composable
private fun RowFrame(
    key: String,
    interaction: Modifier,
    selected: Boolean?,
    dot: Color,
    muted: Boolean = false,
    content: @Composable () -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(JudgeShapes.card)
            .background(if (selected == true) Palette.terraTint else if (muted) Palette.ivory2 else Palette.paper)
            .border(1.dp, if (selected == true) Palette.terra else Palette.line, JudgeShapes.card)
            .then(interaction)
            .testTag(HistoryTags.row(key))
            .padding(16.dp),
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        if (selected != null) SelectCircle(selected, Modifier.align(Alignment.CenterVertically))
        Box(Modifier.padding(top = 4.dp).size(14.dp).clip(CircleShape).background(dot))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) { content() }
    }
}

@Composable
private fun AccountRow(item: HistoryItem, now: Long, interaction: Modifier, selected: Boolean?) {
    val s = LocalStrings.current
    val lang = LocalLang.current
    val sides = LocalSides.current
    val title = remember(item, lang) { HistoryLabels.title(item, s, lang) }
    val status = HistoryLabels.status(item, s, now)
    val muted = HistoryLabels.muted(item, now)
    val dot = when (HistoryLabels.tone(item, now)) {
        HistoryLabels.Tone.YOURS -> sides.mine.ink
        HistoryLabels.Tone.THEIRS -> sides.theirs.ink
        HistoryLabels.Tone.NEUTRAL -> Palette.ink
        HistoryLabels.Tone.THINKING -> Palette.stone
        HistoryLabels.Tone.WAITING -> Palette.terra
        HistoryLabels.Tone.ATTENTION -> Palette.danger
        HistoryLabels.Tone.MUTED -> Palette.muted
    }
    val meta = (listOfNotNull(parseIso(item.at)?.let { formatDate(it, lang) }) + HistoryLabels.tags(item, s)).joinToString(" · ")
    RowFrame(item.key, interaction, selected, dot, muted) {
        if (status != null || item.yourMove) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (status != null) {
                    Text(
                        status,
                        style = JudgeType.slotTitle.copy(fontSize = JudgeType.slotTitle.fontSize * 1.1f, color = if (muted) Palette.muted else Palette.ink),
                        modifier = Modifier.weight(1f, fill = false),
                    )
                }
                if (item.yourMove) YourMove(s.historyYourMove)
            }
        }
        Text(title, style = JudgeType.headline.copy(color = if (muted) Palette.muted else Palette.ink2), maxLines = 2, overflow = TextOverflow.Ellipsis)
        if (meta.isNotEmpty()) Text(meta, style = JudgeType.footnote)
    }
}

/** "Your turn": something waits on the viewer. */
@Composable
private fun YourMove(text: String) {
    Text(
        text,
        style = JudgeType.small.copy(fontSize = 12.sp, color = Palette.terraInk),
        modifier = Modifier
            .clip(JudgeShapes.chip)
            .background(Palette.terraTint)
            .padding(horizontal = 9.dp, vertical = 3.dp),
    )
}

@Composable
private fun PhoneRow(item: SavedVerdict, interaction: Modifier, selected: Boolean?) {
    val s = LocalStrings.current
    val lang = LocalLang.current
    val result = item.original.result
    val parties = PartyNames.partyNames(item.nameMap, item.lang, s)
    val label = VerdictDisplay.verdictLabel(result, parties, s)
    val shown = item.translations[lang]?.result ?: result
    val headline = remember(shown, item.nameMap, item.lang) { RestoreNames.headline(shown, item.nameMap, item.lang) }
    val date = remember(item.createdAt, lang) { formatDate(item.createdAt, lang) }
    val dot = when (VerdictDisplay.sealOf(result)) {
        SealSide.A -> LocalSides.current.a.ink
        SealSide.B -> LocalSides.current.b.ink
        SealSide.NONE -> Palette.ink
    }
    RowFrame("v:${item.id}", interaction, selected, dot) {
        Text(label, style = JudgeType.slotTitle.copy(fontSize = JudgeType.slotTitle.fontSize * 1.1f))
        Text(headline, style = JudgeType.headline, maxLines = 2, overflow = TextOverflow.Ellipsis)
        Text("$date · ${s.appHistoryPhoneOnly}", style = JudgeType.footnote)
    }
}

private fun formatDate(epochMs: Long, lang: AppLang): String =
    DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(lang.locale)
        .format(Instant.ofEpochMilli(epochMs).atZone(ZoneId.systemDefault()))

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

/** Select mode's top bar: leave it, the count, pick or drop every row, delete. */
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
