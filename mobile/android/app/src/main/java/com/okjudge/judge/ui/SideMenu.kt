package com.okjudge.judge.ui

import android.os.Build
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
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
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.draw.scale
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.Offset
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
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.platform.LocalLayoutDirection
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
    const val PROFILE = "bar.menu.profile"
    const val SETTINGS = "bar.menu.settings"
    const val PRICING = "bar.menu.pricing"
    const val SIGN_IN = "bar.menu.signIn"
    const val SIGN_OUT = "bar.menu.signOut"
    const val VERDICTS = "bar.menu.verdicts"
    fun recent(key: String) = "bar.menu.recent.$key"
}

/** What the profile row of the side menu does, with the signed-in user (null when signed out). */
internal class AccountActions(
    val signedIn: Boolean,
    val user: Viewer?,
    val onPricing: () -> Unit,
    val onSignIn: () -> Unit,
    val onSignOut: () -> Unit,
)

/** First letter of the name (or email) for the avatar circle. */
internal fun initialOf(user: Viewer): String =
    user.name.trim().ifEmpty { user.email.trim() }.take(1).uppercase().ifEmpty { "?" }

/**
 * The bar of the three main pages: the menu button, the page's title (the New page has none), the
 * gamify button and the compose button, each on its own small round plate.
 */
@Composable
internal fun PageBar(
    title: String?,
    onMenu: () -> Unit,
    onNew: () -> Unit,
    menuFocus: FocusRequester,
    gamify: Boolean = true,
    onGamify: (Boolean) -> Unit = {},
) {
    val s = LocalStrings.current
    Row(
        Modifier
            .fillMaxWidth()
            .windowInsetsPadding(WindowInsets.systemBars.union(WindowInsets.displayCutout).only(WindowInsetsSides.Top + WindowInsetsSides.Horizontal))
            .heightIn(min = 56.dp)
            .padding(horizontal = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        BarButton(s.navTabs, JudgeIcons.menu(Palette.ink), onMenu, Modifier.focusRequester(menuFocus))
        if (title != null) {
            Text(
                title,
                style = JudgeType.sectionTitle,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f).padding(horizontal = 8.dp).semantics { heading() },
            )
        } else {
            Spacer(Modifier.weight(1f))
        }
        GamifyButton(gamify, onGamify)
        BarButton(s.shellNew, JudgeIcons.plus(Palette.ink), onNew)
    }
}

/** Bar buttons are round plates 48dp across with 22dp icons. */
private val BarTarget = 48.dp
private val BarPlate = 48.dp

@Composable
private fun GamifyButton(on: Boolean, onChange: (Boolean) -> Unit) {
    val s = LocalStrings.current
    val spec = if (rememberReducedMotion()) snap<Color>() else tween(150)
    val tint by animateColorAsState(if (on) Palette.terraTint else Palette.ink.copy(alpha = 0.08f), spec, label = "tint")
    val glow by animateDpAsState(if (on && Build.VERSION.SDK_INT >= 28) 8.dp else 0.dp, if (rememberReducedMotion()) snap() else tween(150), label = "glow")
    Box(
        Modifier
            .size(BarTarget)
            .semantics { contentDescription = s.shellGamify }
            .toggleable(value = on, role = Role.Switch, onValueChange = onChange)
            .testTag(PageBarTags.GAMIFY),
        contentAlignment = Alignment.Center,
    ) {
        Box(
            Modifier
                .size(BarPlate)
                .shadow(glow, CircleShape, ambientColor = Palette.terra, spotColor = Palette.terra)
                .clip(CircleShape)
                .background(tint),
            contentAlignment = Alignment.Center,
        ) {
            TintedIcon(JudgeIcons.gamepad(if (on) Palette.terraInk else Palette.muted), 22)
        }
    }
}

@Composable
private fun BarButton(label: String, icon: ImageVector, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Box(
        modifier
            .size(BarTarget)
            .clip(CircleShape)
            .semantics {
                role = Role.Button
                contentDescription = label
            }
            .focusProperties { canFocus = true }
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Box(Modifier.size(BarPlate).background(Palette.ink.copy(alpha = 0.08f), CircleShape), contentAlignment = Alignment.Center) {
            TintedIcon(icon, 22)
        }
    }
}

/**
 * The drawer's sheet: New, a Verdicts heading over the newest [recent] as separate cards, and at the
 * bottom the profile above Settings.
 */
@Composable
internal fun MenuPanel(
    selected: Tab,
    recent: List<HistoryEntry>,
    hidden: Boolean,
    firstRow: FocusRequester,
    onSelect: (Tab) -> Unit,
    onOpen: (HistoryEntry) -> Unit,
    onClose: () -> Unit,
    account: AccountActions = AccountActions(false, null, {}, {}, {}),
) {
    val s = LocalStrings.current
    val width = minOf(300.dp, (LocalConfiguration.current.screenWidthDp * 0.85f).dp)
    var profileOpen by remember { mutableStateOf(false) }
    LaunchedEffect(hidden) { if (hidden) profileOpen = false }
    val now = remember(recent) { System.currentTimeMillis() }
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
            Column(Modifier.weight(1f).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                MenuRow(s.appTabNew, selected == Tab.NEW, { onSelect(Tab.NEW) }, Modifier.focusRequester(firstRow))
                VerdictsHeading(s.navVerdicts, selected == Tab.HISTORY) { onSelect(Tab.HISTORY) }
                recent.forEach { RecentCard(it, now) { onOpen(it) } }
            }
            Column(Modifier.padding(top = 12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                if (profileOpen) {
                    ProfileItem(s.navPricing, PageBarTags.PRICING) { onClose(); account.onPricing() }
                    if (account.signedIn) {
                        ProfileItem(s.navSignOut, PageBarTags.SIGN_OUT, Palette.danger) { onClose(); account.onSignOut() }
                    } else {
                        ProfileItem(s.navSignIn, PageBarTags.SIGN_IN) { onClose(); account.onSignIn() }
                    }
                }
                ProfileRow(account, profileOpen) { profileOpen = !profileOpen }
                MenuRow(
                    s.appTabSettings, selected == Tab.SETTINGS, { onSelect(Tab.SETTINGS) },
                    Modifier.testTag(PageBarTags.SETTINGS),
                    icon = JudgeIcons.settings(Palette.ink),
                )
            }
        }
    }
}

@Composable
private fun MenuRow(label: String, on: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier, icon: ImageVector? = null) {
    Row(
        modifier
            .fillMaxWidth()
            .heightIn(min = 56.dp)
            .clip(CircleShape)
            .background(if (on) Palette.sageTint else Color.Transparent)
            .semantics { selected = on }
            .focusProperties { canFocus = true }
            .clickable(role = Role.Button, onClick = onClick)
            .padding(start = if (icon != null) 19.dp else 12.dp, end = 12.dp, top = 8.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        // The gear centres under the profile picture (36dp at 12dp) and the label lines up with the name.
        horizontalArrangement = Arrangement.spacedBy(if (icon != null) 19.dp else 12.dp),
    ) {
        if (icon != null) TintedIcon(icon, 22)
        Text(label, style = JudgeType.slotTitle.copy(color = if (on) Palette.sageInk else Palette.ink))
    }
}

/** A section heading over the recent verdicts that still opens the list. */
@Composable
private fun VerdictsHeading(label: String, on: Boolean, onClick: () -> Unit) {
    val rtl = LocalLayoutDirection.current == LayoutDirection.Rtl
    val line = Palette.line
    Row(
        Modifier
            .padding(top = 8.dp)
            .fillMaxWidth()
            .heightIn(min = 48.dp)
            .semantics {
                selected = on
                heading()
            }
            .focusProperties { canFocus = true }
            .clickable(role = Role.Button, onClick = onClick)
            .drawBehind { drawLine(line, Offset(0f, size.height), Offset(size.width, size.height), 1.dp.toPx()) }
            .padding(horizontal = 12.dp)
            .testTag(PageBarTags.VERDICTS),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            label,
            style = JudgeType.small.copy(fontWeight = FontWeight.Bold, color = if (on) Palette.ink else Palette.muted),
            modifier = Modifier.weight(1f),
        )
        TintedIcon(JudgeIcons.chevron(Palette.muted), 12, Modifier.scale(if (rtl) -1f else 1f, 1f))
    }
}

/**
 * One verdict as its own card: green when the ruling went the viewer's way, red when it went the
 * other's, plain otherwise. The result words stay under the title, so colour is never the only
 * signal, and a screen reader reads them with the title.
 */
@Composable
private fun RecentCard(entry: HistoryEntry, now: Long, onClick: () -> Unit) {
    val s = LocalStrings.current
    val lang = LocalLang.current
    val title = remember(entry, lang) { HistoryLabels.title(entry, s, lang) }
    val status = HistoryLabels.status(entry, s, now)
    val (fill, edge, words) = when (HistoryLabels.tone(entry, now)) {
        HistoryLabels.Tone.YOURS -> Triple(Palette.sageTint, Palette.sageStrong, Palette.sageInk)
        HistoryLabels.Tone.THEIRS -> Triple(Palette.terraTint, Palette.terra, Palette.terraInk)
        else -> Triple(Palette.paper, Palette.line2, Palette.muted)
    }
    val shape = RoundedCornerShape(12.dp)
    Column(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 52.dp)
            .clip(shape)
            .background(fill)
            .border(1.dp, edge, shape)
            .semantics(mergeDescendants = true) {}
            .clickable(role = Role.Button, onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 8.dp)
            .testTag(PageBarTags.recent(entry.key)),
        verticalArrangement = Arrangement.spacedBy(2.dp, Alignment.CenterVertically),
    ) {
        Text(title, style = JudgeType.body.copy(fontSize = 14.sp), maxLines = 2, overflow = TextOverflow.Ellipsis)
        if (status != null) {
            Text(
                status,
                style = JudgeType.small.copy(fontSize = 12.5.sp, fontWeight = FontWeight.SemiBold, color = words),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

/** The picture and name of the account; it opens Pricing, Sign in or Sign out. */
@Composable
private fun ProfileRow(account: AccountActions, open: Boolean, onClick: () -> Unit) {
    val s = LocalStrings.current
    val user = account.user
    val name = user?.let { it.name.trim().ifEmpty { it.email.trim() } }.orEmpty().ifEmpty { s.navAccount }
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 56.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(if (open) Palette.ivory2 else Color.Transparent)
            .semantics(mergeDescendants = true) {
                role = Role.Button
                contentDescription = s.navAccountMenu
                if (user != null) stateDescription = name
                if (open) collapse { onClick(); true } else expand { onClick(); true }
            }
            .focusProperties { canFocus = true }
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 8.dp)
            .testTag(PageBarTags.PROFILE),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(Modifier.size(48.dp).background(if (user == null) Palette.line else Palette.sageTint, CircleShape), contentAlignment = Alignment.Center) {
            if (user == null) {
                TintedIcon(JudgeIcons.person(Palette.ink2), 22)
            } else {
                Text(initialOf(user), style = JudgeType.slotTitle.copy(color = Palette.sageInk, fontSize = 15.sp))
                AvatarImage(user.image)
            }
        }
        Text(name, style = JudgeType.slotTitle, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
        TintedIcon(JudgeIcons.caret(Palette.muted), 14, Modifier.rotate(if (open) 180f else 0f))
    }
}

@Composable
private fun ProfileItem(label: String, tag: String, color: Color = Palette.ink, onClick: () -> Unit) {
    Box(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 44.dp)
            .clip(RoundedCornerShape(12.dp))
            .clickable(role = Role.Button, onClick = onClick)
            .padding(start = 60.dp, end = 12.dp)
            .testTag(tag),
        contentAlignment = Alignment.CenterStart,
    ) {
        Text(label, style = JudgeType.slotTitle.copy(color = color))
    }
}
