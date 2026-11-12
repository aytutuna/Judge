package com.okjudge.judge.ui

import android.os.Build
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.displayCutout
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBars
import androidx.compose.foundation.layout.union
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ModalDrawerSheet
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
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
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
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.collapse
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.expand
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.hideFromAccessibility
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.okjudge.judge.core.model.LiveState
import com.okjudge.judge.core.model.Viewer
import com.okjudge.judge.i18n.LocalLang
import com.okjudge.judge.i18n.LocalStrings
import com.okjudge.judge.i18n.Strings
import com.okjudge.judge.ui.components.BrandLogo
import com.okjudge.judge.ui.components.GhostButton
import com.okjudge.judge.ui.components.JudgeIcons
import com.okjudge.judge.ui.components.TintedIcon
import com.okjudge.judge.ui.components.rememberIcon
import com.okjudge.judge.ui.history.HistoryEntry
import com.okjudge.judge.ui.history.HistoryLabels
import com.okjudge.judge.ui.history.HistoryNotice
import com.okjudge.judge.ui.history.HistoryPaging
import com.okjudge.judge.ui.judging.rememberReducedMotion
import com.okjudge.judge.ui.theme.JudgeType
import com.okjudge.judge.ui.theme.Palette
import kotlinx.coroutines.launch

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
    const val LINKS = "bar.menu.links"
    const val LIST = "bar.menu.list"
    const val EMPTY = "bar.menu.empty"
    const val EMPTY_SIGN_IN = "bar.menu.empty.signIn"
    const val ERROR = "bar.menu.error"
    const val NOTICE = "bar.menu.notice"
    const val MORE = "bar.menu.more"
    const val PHONE_NOTE = "bar.menu.phoneNote"
    const val CONFIRM_DELETE = "bar.menu.confirmDelete"
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
 * The drawer's sheet: New, the Verdicts and the Links ([entries] split by kind) as separate cards in
 * one list that scrolls, and at the bottom the profile above Settings. A card is removed by a swipe
 * or a long press, after asking.
 */
@Composable
internal fun MenuPanel(
    selected: Tab,
    entries: List<HistoryEntry>,
    hidden: Boolean,
    firstRow: FocusRequester,
    onSelect: (Tab) -> Unit,
    onOpen: (HistoryEntry) -> Unit,
    onClose: () -> Unit,
    account: AccountActions = AccountActions(false, null, {}, {}, {}),
    paging: HistoryPaging = HistoryPaging(),
    notice: HistoryNotice? = null,
    onRemove: (HistoryEntry) -> Unit = {},
    onLoadMore: () -> Unit = {},
    onRetry: () -> Unit = {},
    /** Link rows that are being read live, by case id. */
    live: Map<String, LiveState> = emptyMap(),
    /** For invites whose time ran out since the list was loaded. */
    now: Long = System.currentTimeMillis(),
) {
    val s = LocalStrings.current
    val width = minOf(300.dp, (LocalConfiguration.current.screenWidthDp * 0.85f).dp)
    var profileOpen by remember { mutableStateOf(false) }
    LaunchedEffect(hidden) { if (hidden) profileOpen = false }
    val verdicts = remember(entries) { entries.filter { !it.isCase } }
    val links = remember(entries) { entries.filter { it.isCase } }
    var confirmKey by rememberSaveable { mutableStateOf<String?>(null) }
    val listState = rememberLazyListState()
    val nearEnd by remember {
        derivedStateOf {
            val info = listState.layoutInfo
            val last = info.visibleItemsInfo.lastOrNull()?.index ?: return@derivedStateOf false
            last >= info.totalItemsCount - 3
        }
    }
    LaunchedEffect(hidden, nearEnd, paging.next) {
        if (!hidden && nearEnd && paging.next != null) onLoadMore()
    }
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
            LazyColumn(
                Modifier.weight(1f).testTag(PageBarTags.LIST),
                state = listState,
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                item(key = "new") {
                    MenuRow(s.appTabNew, selected == Tab.NEW, { onSelect(Tab.NEW) }, Modifier.focusRequester(firstRow))
                }
                if (notice != null) {
                    item(key = "notice") {
                        Text(
                            noticeText(notice, s),
                            style = JudgeType.small.copy(color = Palette.danger),
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 12.dp)
                                .testTag(PageBarTags.NOTICE)
                                .semantics { liveRegion = LiveRegionMode.Polite },
                        )
                    }
                }
                cards(s.navVerdicts, PageBarTags.VERDICTS, verdicts, now, live, onOpen) { confirmKey = it }
                cards(s.navLinks, PageBarTags.LINKS, links, now, live, onOpen) { confirmKey = it }
                if (entries.isEmpty()) {
                    when {
                        paging.loading -> item(key = "loading") {
                            Box(Modifier.fillMaxWidth().padding(top = 16.dp), contentAlignment = Alignment.Center) {
                                CircularProgressIndicator(Modifier.size(22.dp), color = Palette.muted, strokeWidth = 2.dp)
                            }
                        }
                        paging.failed -> item(key = "error") { LoadFailed(onRetry) }
                        else -> item(key = "empty") {
                            Column {
                                Text(
                                    s.appHistoryEmpty,
                                    style = JudgeType.footnote,
                                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp).testTag(PageBarTags.EMPTY),
                                )
                                if (!account.signedIn) {
                                    Box(Modifier.fillMaxWidth().padding(top = 12.dp), contentAlignment = Alignment.Center) {
                                        GhostButton(
                                            s.shellLocalSignIn, null, { onClose(); account.onSignIn() },
                                            Modifier.testTag(PageBarTags.EMPTY_SIGN_IN),
                                        )
                                    }
                                }
                            }
                        }
                    }
                } else if (paging.failed) {
                    item(key = "error") { LoadFailed(onRetry) }
                }
                if (paging.next != null) {
                    item(key = "more") {
                        Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                            if (paging.loadingMore) {
                                CircularProgressIndicator(Modifier.size(22.dp), color = Palette.muted, strokeWidth = 2.dp)
                            } else {
                                GhostButton(s.shellLoadMore, null, onLoadMore, Modifier.testTag(PageBarTags.MORE))
                            }
                        }
                    }
                }
                if (entries.any { it is HistoryEntry.Phone }) {
                    item(key = "phoneNote") {
                        Text(
                            s.appHistoryPhoneOnlyNote,
                            style = JudgeType.footnote,
                            modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp).testTag(PageBarTags.PHONE_NOTE),
                        )
                    }
                }
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
    confirmKey?.let { key ->
        val picked = entries.filter { it.key == key }
        AlertDialog(
            onDismissRequest = { confirmKey = null },
            text = { Text(HistoryLabels.removeConfirm(picked, s), style = JudgeType.body) },
            confirmButton = {
                TextButton(
                    onClick = { confirmKey = null; picked.forEach(onRemove) },
                    modifier = Modifier.testTag(PageBarTags.CONFIRM_DELETE),
                ) { Text(if (picked.any { it is HistoryEntry.Account }) s.verdictRemoveYes else s.appHistoryDelete, color = Palette.danger) }
            },
            dismissButton = { TextButton(onClick = { confirmKey = null }) { Text(s.appCancel, color = Palette.ink) } },
            containerColor = Palette.paper,
        )
    }
}

/** A heading and the cards under it; nothing at all when there are none. */
private fun LazyListScope.cards(
    heading: String,
    tag: String,
    list: List<HistoryEntry>,
    now: Long,
    live: Map<String, LiveState>,
    onOpen: (HistoryEntry) -> Unit,
    onAskRemove: (String) -> Unit,
) {
    if (list.isEmpty()) return
    item(key = tag) { SectionHeading(heading, tag) }
    items(list, key = { it.key }) { e -> MenuCard(e, now, e.waitingLinkId?.let { live[it] }, { onOpen(e) }, { onAskRemove(e.key) }) }
}

/** A waiting link row says what its sides are doing: typing, or opened; plain waiting keeps the row's own words. */
internal fun liveLabel(live: LiveState?, s: Strings): String? = when (live) {
    LiveState.TYPING -> s.caseSideTyping
    LiveState.OPENED -> s.caseSideOpened
    else -> null
}

private fun noticeText(notice: HistoryNotice, s: Strings) = when (notice) {
    HistoryNotice.Offline -> s.appHistoryOfflineRemove
    is HistoryNotice.RemoveFailed -> s.appHistoryRemoveFailed(notice.count)
    HistoryNotice.OpenFailed -> s.errorFallback
    HistoryNotice.LoadMoreFailed -> s.shellLoadFailed
}

internal fun opens(e: HistoryEntry) = when (e) {
    is HistoryEntry.Account -> HistoryLabels.openable(e.item)
    is HistoryEntry.Phone -> true
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
        Text(s.shellLoadFailed, style = JudgeType.small.copy(color = Palette.danger), modifier = Modifier.testTag(PageBarTags.ERROR))
        GhostButton(s.appRetry, null, onRetry)
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

@Composable
private fun SectionHeading(label: String, tag: String) {
    val line = Palette.line
    Row(
        Modifier
            .padding(top = 8.dp)
            .fillMaxWidth()
            .heightIn(min = 48.dp)
            .semantics { heading() }
            .drawBehind { drawLine(line, Offset(0f, size.height), Offset(size.width, size.height), 1.dp.toPx()) }
            .padding(horizontal = 12.dp)
            .testTag(tag),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, style = JudgeType.small.copy(fontWeight = FontWeight.Bold, color = Palette.muted))
    }
}

/**
 * One verdict or link as its own card: green when the ruling went the viewer's way, red when it went the
 * other's, plain otherwise. The result words stay under the title, so colour is never the only
 * signal, and a screen reader reads them with the title.
 */
@Composable
private fun RecentCard(entry: HistoryEntry, now: Long, live: LiveState?, interaction: Modifier) {
    val s = LocalStrings.current
    val lang = LocalLang.current
    val title = remember(entry, lang) { HistoryLabels.title(entry, s, lang) }
    val status = liveLabel(live, s) ?: HistoryLabels.status(entry, s, now)
    val (fill, edge, words) = when (HistoryLabels.tone(entry, now)) {
        HistoryLabels.Tone.YOURS -> Triple(Palette.sageTint, Palette.sageStrong, Palette.sageInk)
        HistoryLabels.Tone.THEIRS -> Triple(Palette.terraTint, Palette.terra, Palette.terraInk)
        else -> Triple(Palette.paper, Palette.line2, Palette.muted)
    }
    val muted = entry is HistoryEntry.Account && HistoryLabels.muted(entry.item, now)
    val shape = RoundedCornerShape(12.dp)
    Column(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 52.dp)
            .alpha(if (muted) 0.6f else 1f)
            .clip(shape)
            .background(fill)
            .border(1.dp, edge, shape)
            .semantics(mergeDescendants = true) {}
            .then(interaction)
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

/**
 * A card that opens its page, and where it can be removed also swipes (from the start edge, since a
 * swipe toward the end is what closes the drawer) and asks on a long press.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun MenuCard(entry: HistoryEntry, now: Long, live: LiveState?, onOpen: () -> Unit, onAskRemove: () -> Unit) {
    val s = LocalStrings.current
    val open = Modifier.combinedClickable(
        enabled = opens(entry),
        role = Role.Button,
        onClick = onOpen,
        onLongClick = if (entry.removable) onAskRemove else null,
    )
    if (!entry.removable) {
        RecentCard(entry, now, live, open)
        return
    }
    // A swipe asks first: removing from the account can't be undone. The row never settles open, so it
    // snaps back whether the dialog is confirmed or not.
    val ask by rememberUpdatedState(onAskRemove)
    val state = rememberSwipeToDismissBoxState()
    val scope = rememberCoroutineScope()
    SwipeToDismissBox(
        state = state,
        enableDismissFromEndToStart = false,
        onDismiss = { value ->
            if (value == SwipeToDismissBoxValue.StartToEnd) ask()
            scope.launch { state.reset() }
        },
        backgroundContent = {
            Row(
                Modifier.fillMaxSize().clip(RoundedCornerShape(12.dp)).background(Palette.terraTint).padding(horizontal = 16.dp),
                horizontalArrangement = Arrangement.Start,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                TintedIcon(rememberIcon(Palette.danger) { JudgeIcons.trash(it) }, 18)
                Spacer(Modifier.size(8.dp))
                Text(s.appHistoryDelete, style = JudgeType.small.copy(color = Palette.danger))
            }
        },
    ) {
        // Opaque, so the delete background does not show through a dimmed card.
        Box(Modifier.background(Palette.paper, RoundedCornerShape(12.dp))) {
            RecentCard(entry, now, live, open.semantics { customActions = listOf(CustomAccessibilityAction(s.appHistoryDelete) { onAskRemove(); true }) })
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
