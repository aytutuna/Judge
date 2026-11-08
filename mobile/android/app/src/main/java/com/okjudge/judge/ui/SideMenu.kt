package com.okjudge.judge.ui

import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.tween
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
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBars
import androidx.compose.foundation.layout.union
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
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
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.collapse
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.expand
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.hideFromAccessibility
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.okjudge.judge.core.model.Viewer
import com.okjudge.judge.i18n.LocalLang
import com.okjudge.judge.i18n.LocalStrings
import com.okjudge.judge.ui.components.BrandLogo
import com.okjudge.judge.ui.components.JudgeIcons
import com.okjudge.judge.ui.components.TintedIcon
import com.okjudge.judge.ui.history.HistoryEntry
import com.okjudge.judge.ui.history.HistoryLabels
import com.okjudge.judge.ui.judging.rememberReducedMotion
import com.okjudge.judge.ui.theme.JudgeType
import com.okjudge.judge.ui.theme.Palette

internal val menuScrim: Color
    @Composable get() = if (Palette.dark) Color.Black.copy(alpha = 0.5f) else Color(0xFF1C1916).copy(alpha = 0.28f)

object PageBarTags {
    const val GAMIFY = "bar.gamify"
    const val AVATAR = "bar.avatar"
    const val SETTINGS = "bar.menu.settings"
    const val PRICING = "bar.menu.pricing"
    const val SIGN_IN = "bar.menu.signIn"
    const val SIGN_OUT = "bar.menu.signOut"
}

/** What the avatar menu does, with the signed-in user (null when signed out). */
internal class AccountActions(
    val signedIn: Boolean,
    val user: Viewer?,
    val onSettings: () -> Unit,
    val onPricing: () -> Unit,
    val onSignIn: () -> Unit,
    val onSignOut: () -> Unit,
)

/** First letter of the name (or email) for the avatar circle. */
internal fun initialOf(user: Viewer): String =
    user.name.trim().ifEmpty { user.email.trim() }.take(1).uppercase().ifEmpty { "?" }

/**
 * The bar of the three main pages: the menu button, the page's title, the gamify switch, the
 * profile button and the compose button. Under 640dp the switch drops its label.
 */
@Composable
internal fun PageBar(
    title: String,
    onMenu: () -> Unit,
    onNew: () -> Unit,
    menuFocus: FocusRequester,
    gamify: Boolean = true,
    onGamify: (Boolean) -> Unit = {},
    account: AccountActions = AccountActions(false, null, {}, {}, {}, {}),
) {
    val s = LocalStrings.current
    val width = LocalConfiguration.current.screenWidthDp
    val wide = width >= 640
    val target = if (width < 400) 44.dp else 48.dp
    Row(
        Modifier
            .fillMaxWidth()
            .windowInsetsPadding(WindowInsets.systemBars.union(WindowInsets.displayCutout).only(WindowInsetsSides.Top + WindowInsetsSides.Horizontal))
            .heightIn(min = 56.dp)
            .padding(horizontal = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        BarButton(s.navTabs, JudgeIcons.menu(Palette.ink), onMenu, target, Modifier.focusRequester(menuFocus))
        Text(
            title,
            style = JudgeType.sectionTitle,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f).padding(start = 4.dp).semantics { heading() },
        )
        GamifySwitch(gamify, onGamify, wide, target)
        AvatarMenu(account, target)
        BarButton(s.shellNew, JudgeIcons.plus(Palette.ink), onNew, target)
    }
}

@Composable
private fun GamifySwitch(on: Boolean, onChange: (Boolean) -> Unit, showLabel: Boolean, target: Dp) {
    val s = LocalStrings.current
    val knob by animateDpAsState(if (on) 16.dp else 2.dp, if (rememberReducedMotion()) snap() else tween(150), label = "knob")
    Row(
        Modifier
            .heightIn(min = target)
            .clip(CircleShape)
            .semantics { contentDescription = s.shellGamify }
            .toggleable(value = on, role = Role.Switch, onValueChange = onChange)
            .testTag(PageBarTags.GAMIFY)
            .padding(horizontal = if (target < 48.dp) 4.dp else 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        TintedIcon(JudgeIcons.gamepad(if (on) Palette.ink else Palette.ink2), 20)
        if (showLabel) Text(s.shellGamify, style = JudgeType.small.copy(color = if (on) Palette.ink else Palette.ink2), maxLines = 1)
        Box(Modifier.size(32.dp, 18.dp).clip(CircleShape).background(if (on) Palette.terraInk else Palette.muted)) {
            Box(Modifier.offset(x = knob, y = 2.dp).size(14.dp).background(Palette.paper, CircleShape))
        }
    }
}

@Composable
private fun AvatarMenu(account: AccountActions, target: Dp) {
    val s = LocalStrings.current
    var open by remember { mutableStateOf(false) }
    val close = { open = false }
    val user = account.user
    Box {
        Box(
            Modifier
                .size(target)
                .clip(CircleShape)
                .semantics {
                    role = Role.Button
                    contentDescription = s.navAccountMenu
                    if (open) collapse { close(); true } else expand { open = true; true }
                }
                .clickable { open = true }
                .testTag(PageBarTags.AVATAR),
            contentAlignment = Alignment.Center,
        ) {
            Box(Modifier.size(32.dp).background(if (user == null) Palette.line else Palette.sageTint, CircleShape), contentAlignment = Alignment.Center) {
                if (user == null) {
                    TintedIcon(JudgeIcons.person(Palette.ink2), 20)
                } else {
                    Text(initialOf(user), style = JudgeType.slotTitle.copy(color = Palette.sageInk, fontSize = 15.sp))
                    AvatarImage(user.image)
                }
            }
        }
        DropdownMenu(open, close, containerColor = Palette.paper) {
            if (user != null) {
                Text(user.email, style = JudgeType.small, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp))
            }
            if (!account.signedIn) MenuItem(s.navSignIn, PageBarTags.SIGN_IN) { close(); account.onSignIn() }
            MenuItem(s.appTabSettings, PageBarTags.SETTINGS) { close(); account.onSettings() }
            MenuItem(s.navPricing, PageBarTags.PRICING) { close(); account.onPricing() }
            if (account.signedIn) MenuItem(s.navSignOut, PageBarTags.SIGN_OUT) { close(); account.onSignOut() }
        }
    }
}

@Composable
private fun MenuItem(label: String, tag: String, onClick: () -> Unit) {
    DropdownMenuItem(text = { Text(label, style = JudgeType.body) }, onClick = onClick, modifier = Modifier.testTag(tag))
}

@Composable
private fun BarButton(label: String, icon: ImageVector, onClick: () -> Unit, target: Dp, modifier: Modifier = Modifier) {
    Box(
        modifier
            .size(target)
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
            Row(
                Modifier.padding(start = 22.dp, bottom = 16.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                BrandLogo(32.dp)
                Text(s.appName, style = JudgeType.sectionTitle)
            }
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
