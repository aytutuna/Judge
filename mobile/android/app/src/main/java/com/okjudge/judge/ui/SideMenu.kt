package com.okjudge.judge.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.displayCutout
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBars
import androidx.compose.foundation.layout.union
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.hideFromAccessibility
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.okjudge.judge.i18n.LocalLang
import com.okjudge.judge.i18n.LocalStrings
import com.okjudge.judge.ui.components.JudgeIcons
import com.okjudge.judge.ui.components.TintedIcon
import com.okjudge.judge.ui.history.HistoryEntry
import com.okjudge.judge.ui.history.HistoryLabels
import com.okjudge.judge.ui.theme.JudgeType
import com.okjudge.judge.ui.theme.Palette

internal val menuScrim: Color
    @Composable get() = if (Palette.dark) Color.Black.copy(alpha = 0.5f) else Color(0xFF1C1916).copy(alpha = 0.28f)

/** The bar of the three main pages: the menu button, the page's title and the compose button. */
@Composable
internal fun PageBar(title: String, onMenu: () -> Unit, onNew: () -> Unit, menuFocus: FocusRequester) {
    val s = LocalStrings.current
    Row(
        Modifier
            .fillMaxWidth()
            .windowInsetsPadding(WindowInsets.systemBars.union(WindowInsets.displayCutout).only(WindowInsetsSides.Top + WindowInsetsSides.Horizontal))
            .heightIn(min = 56.dp)
            .padding(horizontal = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        BarButton(s.navTabs, JudgeIcons.menu(Palette.ink), onMenu, Modifier.focusRequester(menuFocus))
        Text(title, style = JudgeType.sectionTitle, modifier = Modifier.weight(1f).semantics { heading() })
        BarButton(s.shellNew, JudgeIcons.plus(Palette.ink), onNew)
    }
}

@Composable
private fun BarButton(label: String, icon: ImageVector, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Box(
        modifier
            .size(48.dp)
            .clip(CircleShape)
            .semantics {
                role = Role.Button
                contentDescription = label
            }
            .focusProperties { canFocus = true }
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        TintedIcon(icon, 22)
    }
}

/** The drawer's sheet: New and Verdicts with the newest [recent] under them, Settings pinned to the bottom. */
@Composable
internal fun MenuPanel(
    selected: Tab,
    recent: List<HistoryEntry>,
    hidden: Boolean,
    firstRow: FocusRequester,
    onSelect: (Tab) -> Unit,
    onOpen: (HistoryEntry) -> Unit,
    onClose: () -> Unit,
) {
    val s = LocalStrings.current
    val width = minOf(300.dp, (LocalConfiguration.current.screenWidthDp * 0.85f).dp)
    ModalDrawerSheet(
        modifier = Modifier
            .width(width)
            .semantics { if (hidden) hideFromAccessibility() }
            .onKeyEvent {
                val escape = it.key == Key.Escape && it.type == KeyEventType.KeyUp
                if (escape) onClose()
                escape
            },
        drawerShape = RoundedCornerShape(topEnd = 18.dp, bottomEnd = 18.dp),
        drawerContainerColor = Palette.paper,
        drawerContentColor = Palette.ink,
        drawerTonalElevation = 0.dp,
    ) {
        Column(Modifier.fillMaxHeight().padding(horizontal = 12.dp, vertical = 24.dp)) {
            Column(Modifier.weight(1f).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                MenuRow(s.appTabNew, selected == Tab.NEW, { onSelect(Tab.NEW) }, Modifier.focusRequester(firstRow))
                MenuRow(s.navVerdicts, selected == Tab.HISTORY, { onSelect(Tab.HISTORY) })
                recent.forEach { RecentRow(it) { onOpen(it) } }
            }
            MenuRow(s.appTabSettings, selected == Tab.SETTINGS, { onSelect(Tab.SETTINGS) })
        }
    }
}

@Composable
private fun MenuRow(label: String, on: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Box(
        modifier
            .fillMaxWidth()
            .heightIn(min = 56.dp)
            .clip(CircleShape)
            .background(if (on) Palette.sageTint else Color.Transparent)
            .semantics { selected = on }
            .focusProperties { canFocus = true }
            .clickable(role = Role.Button, onClick = onClick)
            .padding(horizontal = 22.dp, vertical = 8.dp),
        contentAlignment = Alignment.CenterStart,
    ) {
        Text(label, style = JudgeType.slotTitle.copy(color = if (on) Palette.sageInk else Palette.ink))
    }
}

@Composable
private fun RecentRow(entry: HistoryEntry, onClick: () -> Unit) {
    val s = LocalStrings.current
    val lang = LocalLang.current
    val title = remember(entry, lang) { HistoryLabels.title(entry, s, lang) }
    Box(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 44.dp)
            .clickable(role = Role.Button, onClick = onClick)
            .padding(horizontal = 22.dp),
        contentAlignment = Alignment.CenterStart,
    ) {
        Text(title, style = JudgeType.body.copy(fontSize = 14.sp, color = Palette.ink2), maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}
