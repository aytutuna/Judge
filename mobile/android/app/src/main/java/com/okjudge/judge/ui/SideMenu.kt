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
import androidx.compose.foundation.layout.PaddingValues
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
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
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
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalFocusManager
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
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.zIndex
import com.okjudge.judge.core.model.LiveState
import com.okjudge.judge.core.model.Viewer
import com.okjudge.judge.core.display.Errors
import com.okjudge.judge.i18n.AppLang
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

private const val SEARCH_CAP = 500

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
    const val SEARCH = "bar.menu.search"
    const val NO_MATCHES = "bar.menu.noMatches"
    const val EMPTY = "bar.menu.empty"
    const val EMPTY_SIGN_IN = "bar.menu.empty.signIn"
    const val ERROR = "bar.menu.error"
    const val NOTICE = "bar.menu.notice"
    const val MORE = "bar.menu.more"
    const val PHONE_NOTE = "bar.menu.phoneNote"
    const val CONFIRM_DELETE = "bar.menu.confirmDelete"
    fun recent(key: String) = "bar.menu.recent.$key"
    fun removeAll(heading: String) = "$heading.removeAll"
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
 * gamify button (only where there is a court) and the compose button, each on its own small round plate.
 */
@Composable
internal fun PageBar(
    title: String?,
    onMenu: () -> Unit,
    onNew: () -> Unit,
    menuFocus: FocusRequester,
    showGamify: Boolean = true,
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
        if (showGamify) GamifyButton(gamify, onGamify)
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
    val tint by animateColorAsState(if (on) Palette.ruby.copy(alpha = 0.22f) else Palette.ink.copy(alpha = 0.08f), spec, label = "tint")
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
                .shadow(glow, CircleShape, ambientColor = Palette.ruby.copy(alpha = 0.4f), spotColor = Palette.ruby.copy(alpha = 0.4f))
                .clip(CircleShape)
                .background(tint),
            contentAlignment = Alignment.Center,
        ) {
            TintedIcon(JudgeIcons.gamepad(if (on) Palette.rubyInk else Palette.muted), 22)
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
 * The drawer's sheet: the Verdicts and the Links ([entries] split by kind) as separate cards in one
 * list that scrolls under New and a search field at the top and the profile and Settings at the
 * bottom, which float over it. A card is removed by a swipe or a long press, after asking.
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
    onRemove: (List<HistoryEntry>) -> Unit = {},
    onLoadMore: () -> Unit = {},
    /** Reads every page of the account's list, so Remove all covers rows not on screen yet. */
    onLoadAll: suspend () -> Unit = {},
    onRetry: () -> Unit = {},
    /** Link rows that are being read live, by case id. */
    live: Map<String, LiveState> = emptyMap(),
    /** For invites whose time ran out since the list was loaded. */
    now: Long = System.currentTimeMillis(),
) {
    val s = LocalStrings.current
    val width = minOf(300.dp, (LocalConfiguration.current.screenWidthDp * 0.85f).dp)
    var profileOpen by remember { mutableStateOf(false) }
    var query by rememberSaveable { mutableStateOf("") }
    val focus = LocalFocusManager.current
    LaunchedEffect(hidden) {
        if (hidden) {
            profileOpen = false
            query = ""
        }
    }
    val searching = query.isNotBlank()
    val lang = LocalLang.current
    val shown = remember(entries, query, lang) { HistoryLabels.filter(entries, query, s, lang) }
    val verdicts = remember(shown) { shown.filter { !it.isCase } }
    val links = remember(shown) { shown.filter { it.isCase } }
    var confirmKey by rememberSaveable { mutableStateOf<String?>(null) }
    // Set while a Remove all waits for its confirm: false for the verdicts, true for the links.
    var confirmAll by rememberSaveable { mutableStateOf<Boolean?>(null) }
    var verdictsFolded by rememberSaveable { mutableStateOf(false) }
    var linksFolded by rememberSaveable { mutableStateOf(false) }
    var loadingAll by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val askAll: (Boolean) -> Unit = { links ->
        // A search has been reading pages already, and removes only what matches.
        if (searching) {
            confirmAll = links
        } else if (!loadingAll) {
            loadingAll = true
            scope.launch {
                try {
                    onLoadAll()
                } finally {
                    loadingAll = false
                }
                confirmAll = links
            }
        }
    }
    val listState = rememberLazyListState()
    val nearEnd by remember {
        derivedStateOf {
            val info = listState.layoutInfo
            val last = info.visibleItemsInfo.lastOrNull()?.index ?: return@derivedStateOf false
            last >= info.totalItemsCount - 3
        }
    }
    // While searching, pages keep loading, since a match can be on one not read yet.
    val reading = searching && entries.size < SEARCH_CAP
    LaunchedEffect(hidden, nearEnd, reading, paging.next, paging.loadingMore) {
        if (!hidden && (nearEnd || reading) && paging.next != null && !paging.loadingMore) onLoadMore()
    }
    var topHeight by remember { mutableStateOf(0) }
    var bottomHeight by remember { mutableStateOf(0) }
    val density = LocalDensity.current
    ModalDrawerSheet(
        modifier = Modifier
            .width(width)
            .semantics { if (hidden) hideFromAccessibility() }
            .onKeyEvent {
                val escape = it.key == Key.Escape && it.type == KeyEventType.KeyUp
                if (escape) {
                    // The first Escape clears the search, the next closes the menu.
                    if (query.isNotEmpty()) query = "" else onClose()
                }
                escape
            },
        drawerShape = RoundedCornerShape(topEnd = 18.dp, bottomEnd = 18.dp),
        drawerContainerColor = Palette.paper,
        drawerContentColor = Palette.ink,
        drawerTonalElevation = 0.dp,
    ) {
        Column(Modifier.fillMaxHeight().padding(start = 12.dp, end = 12.dp, top = 24.dp)) {
            Row(
                Modifier.padding(start = 22.dp, bottom = 16.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                BrandLogo(32.dp)
                Text(s.appName, style = JudgeType.sectionTitle)
            }
            Box(Modifier.weight(1f)) {
                Row(
                    Modifier
                        .align(Alignment.TopCenter)
                        .zIndex(1f)
                        .fillMaxWidth()
                        .onSizeChanged { topHeight = it.height }
                        .padding(vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    MenuRow(
                        s.appTabNew, selected == Tab.NEW, { onSelect(Tab.NEW) }, Modifier.focusRequester(firstRow),
                        floating = true, fill = false,
                    )
                    SearchField(query, { query = it }, Modifier.weight(1f))
                }
                Column(
                    Modifier
                        .align(Alignment.BottomCenter)
                        .zIndex(1f)
                        .onSizeChanged { bottomHeight = it.height }
                        .padding(vertical = 12.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    if (profileOpen) {
                        Column(Modifier.fillMaxWidth().floating(RoundedCornerShape(20.dp)).padding(vertical = 4.dp)) {
                            ProfileItem(s.navPricing, PageBarTags.PRICING) { onClose(); account.onPricing() }
                            if (account.signedIn) {
                                ProfileItem(s.navSignOut, PageBarTags.SIGN_OUT, Palette.danger) { onClose(); account.onSignOut() }
                            } else {
                                ProfileItem(s.navSignIn, PageBarTags.SIGN_IN) { onClose(); account.onSignIn() }
                            }
                        }
                    }
                    ProfileRow(account, profileOpen) { profileOpen = !profileOpen }
                    MenuRow(
                        s.appTabSettings, selected == Tab.SETTINGS, { onSelect(Tab.SETTINGS) },
                        Modifier.testTag(PageBarTags.SETTINGS),
                        icon = JudgeIcons.settings(Palette.ink),
                        floating = true,
                    )
                }
                LazyColumn(
                    Modifier.fillMaxSize().testTag(PageBarTags.LIST),
                    state = listState,
                    contentPadding = with(density) { PaddingValues(top = topHeight.toDp(), bottom = bottomHeight.toDp()) },
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    if (notice != null) {
                        item(key = "notice") {
                            Text(
                                noticeText(notice, s, LocalLang.current),
                                style = JudgeType.small.copy(color = Palette.danger),
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(horizontal = 12.dp)
                                    .testTag(PageBarTags.NOTICE)
                                    .semantics { liveRegion = LiveRegionMode.Polite },
                            )
                        }
                    }
                    cards(s.navVerdicts, PageBarTags.VERDICTS, verdicts, verdictsFolded, { verdictsFolded = !verdictsFolded }, { askAll(false) }, now, live, onOpen) { confirmKey = it }
                    cards(s.navLinks, PageBarTags.LINKS, links, linksFolded, { linksFolded = !linksFolded }, { askAll(true) }, now, live, onOpen) { confirmKey = it }
                    if (searching && entries.isNotEmpty() && shown.isEmpty()) {
                        item(key = "noMatches") {
                            if (paging.next != null) {
                                Box(Modifier.fillMaxWidth().padding(top = 16.dp), contentAlignment = Alignment.Center) {
                                    CircularProgressIndicator(Modifier.size(22.dp), color = Palette.muted, strokeWidth = 2.dp)
                                }
                            } else {
                                Text(
                                    s.shellNoMatches,
                                    style = JudgeType.footnote,
                                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp).testTag(PageBarTags.NO_MATCHES),
                                )
                            }
                        }
                    }
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
                    if (paging.next != null && !searching) {
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
            }
        }
    }
    if (confirmKey != null || confirmAll != null) {
        val all = confirmAll
        val picked = if (all != null) (if (searching) shown else entries).filter { it.isCase == all && it.removable } else entries.filter { it.key == confirmKey }
        val close = { confirmKey = null; confirmAll = null }
        AlertDialog(
            onDismissRequest = close,
            text = { Text(HistoryLabels.removeConfirm(picked, s), style = JudgeType.body) },
            confirmButton = {
                TextButton(
                    onClick = { close(); if (picked.isNotEmpty()) onRemove(picked) },
                    modifier = Modifier.testTag(PageBarTags.CONFIRM_DELETE),
                ) {
                    val label = when {
                        all != null -> s.appHistoryRemoveAll
                        picked.any { it is HistoryEntry.Account } -> s.verdictRemoveYes
                        else -> s.appHistoryDelete
                    }
                    Text(label, color = Palette.danger)
                }
            },
            dismissButton = { TextButton(onClick = close) { Text(s.appCancel, color = Palette.ink) } },
            containerColor = Palette.paper,
        )
    }
}

/** A heading and the cards under it; nothing at all when there are none. */
private fun LazyListScope.cards(
    heading: String,
    tag: String,
    list: List<HistoryEntry>,
    folded: Boolean,
    onFold: () -> Unit,
    onRemoveAll: () -> Unit,
    now: Long,
    live: Map<String, LiveState>,
    onOpen: (HistoryEntry) -> Unit,
    onAskRemove: (String) -> Unit,
) {
    if (list.isEmpty()) return
    item(key = tag) { SectionHeading(heading, tag, folded, onFold, onRemoveAll.takeIf { list.any { it.removable } }) }
    if (folded) return
    items(list, key = { it.key }) { e -> MenuCard(e, now, e.waitingLinkId?.let { live[it] }, { onOpen(e) }, { onAskRemove(e.key) }) }
}

/** A waiting link row says what its sides are doing: typing, or opened; plain waiting keeps the row's own words. */
internal fun liveLabel(live: LiveState?, s: Strings): String? = when (live) {
    LiveState.TYPING -> s.caseSideTyping
    LiveState.OPENED -> s.caseSideOpened
    else -> null
}

private fun noticeText(notice: HistoryNotice, s: Strings, lang: AppLang) = when (notice) {
    HistoryNotice.Offline -> s.appHistoryOfflineRemove
    is HistoryNotice.RemoveFailed -> s.appHistoryRemoveFailed(notice.count)
    is HistoryNotice.RateLimited -> Errors.message(notice.error, s, lang)
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

/** A translucent plate with a soft shadow, for the controls that sit over the list. */
@Composable
private fun Modifier.floating(shape: Shape = CircleShape): Modifier = this
    .shadow(6.dp, shape, ambientColor = Color.Black.copy(alpha = 0.12f), spotColor = Color.Black.copy(alpha = 0.2f))
    .background(Palette.paper.copy(alpha = 0.92f), shape)
    .border(1.dp, Palette.line2, shape)

@Composable
private fun SearchField(query: String, onChange: (String) -> Unit, modifier: Modifier = Modifier) {
    val s = LocalStrings.current
    val focus = LocalFocusManager.current
    val style = JudgeType.body.copy(color = Palette.ink)
    Row(
        modifier.heightIn(min = 56.dp).floating().padding(start = 18.dp, end = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        BasicTextField(
            value = query,
            onValueChange = onChange,
            textStyle = style,
            singleLine = true,
            cursorBrush = SolidColor(Palette.terraInk),
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
            keyboardActions = KeyboardActions(onSearch = { focus.clearFocus() }),
            modifier = Modifier.weight(1f).testTag(PageBarTags.SEARCH),
            decorationBox = { inner ->
                Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.CenterStart) {
                    if (query.isEmpty()) Text(s.shellSearch, style = style.copy(color = Palette.placeholder), maxLines = 1, overflow = TextOverflow.Ellipsis)
                    inner()
                }
            },
        )
        if (query.isNotEmpty()) {
            Box(
                Modifier
                    .size(48.dp)
                    .clip(CircleShape)
                    .semantics {
                        role = Role.Button
                        contentDescription = s.appCancel
                    }
                    .clickable { onChange("") },
                contentAlignment = Alignment.Center,
            ) {
                TintedIcon(JudgeIcons.close(Palette.muted), 16)
            }
        }
    }
}

@Composable
private fun MenuRow(
    label: String,
    on: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    floating: Boolean = false,
    fill: Boolean = true,
) {
    Row(
        modifier
            .then(if (floating) Modifier.floating() else Modifier)
            .then(if (fill) Modifier.fillMaxWidth() else Modifier)
            .heightIn(min = 56.dp)
            .clip(CircleShape)
            .background(if (on) Palette.sageTint else Color.Transparent)
            .semantics { selected = on }
            .focusProperties { canFocus = true }
            .clickable(role = Role.Button, onClick = onClick)
            .padding(start = if (icon != null) 19.dp else 18.dp, end = 18.dp, top = 8.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        // The gear centres under the profile picture (36dp at 12dp) and the label lines up with the name.
        horizontalArrangement = Arrangement.spacedBy(if (icon != null) 19.dp else 12.dp),
    ) {
        if (icon != null) TintedIcon(icon, 22)
        Text(label, style = JudgeType.slotTitle.copy(color = if (on) Palette.sageInk else Palette.ink))
    }
}

@Composable
private fun SectionHeading(label: String, tag: String, folded: Boolean, onFold: () -> Unit, onRemoveAll: (() -> Unit)?) {
    val s = LocalStrings.current
    val line = Palette.line
    Row(
        Modifier
            .padding(top = 8.dp)
            .fillMaxWidth()
            .heightIn(min = 48.dp)
            .drawBehind { drawLine(line, Offset(0f, size.height), Offset(size.width, size.height), 1.dp.toPx()) }
            .padding(horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(
            Modifier
                .weight(1f)
                .heightIn(min = 48.dp)
                .semantics(mergeDescendants = true) {
                    heading()
                    role = Role.Button
                    if (folded) expand { onFold(); true } else collapse { onFold(); true }
                }
                .clickable(onClick = onFold)
                .testTag(tag),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text(label, style = JudgeType.small.copy(fontWeight = FontWeight.Bold, color = Palette.muted))
            TintedIcon(JudgeIcons.caret(Palette.muted), 12, Modifier.rotate(if (folded) -90f else 0f))
        }
        if (onRemoveAll != null) {
            Box(
                Modifier
                    .heightIn(min = 48.dp)
                    .clickable(role = Role.Button, onClick = onRemoveAll)
                    .padding(start = 12.dp)
                    .testTag(PageBarTags.removeAll(tag)),
                contentAlignment = Alignment.Center,
            ) {
                Text(s.appHistoryRemoveAll, style = JudgeType.small.copy(fontWeight = FontWeight.SemiBold, color = Palette.danger))
            }
        }
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
 * A card that opens its page, and where it can be removed also swipes (from the end edge, with a trash
 * icon behind it) and asks on a long press.
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
    val state = rememberSwipeToDismissBoxState(positionalThreshold = { it * 0.6f })
    val scope = rememberCoroutineScope()
    SwipeToDismissBox(
        state = state,
        enableDismissFromStartToEnd = false,
        onDismiss = { value ->
            if (value == SwipeToDismissBoxValue.EndToStart) ask()
            scope.launch { state.reset() }
        },
        backgroundContent = {
            Row(
                Modifier.fillMaxSize().clip(RoundedCornerShape(12.dp)).background(Palette.terraTint).padding(horizontal = 16.dp),
                horizontalArrangement = Arrangement.End,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                TintedIcon(rememberIcon(Palette.danger) { JudgeIcons.trash(it) }, 18)
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
            .floating()
            .heightIn(min = 56.dp)
            .clip(CircleShape)
            .background(if (open) Palette.ivory2 else Color.Transparent)
            .semantics(mergeDescendants = true) {
                role = Role.Button
                contentDescription = s.navAccountMenu
                if (user != null) stateDescription = name
                if (open) collapse { onClick(); true } else expand { onClick(); true }
            }
            .focusProperties { canFocus = true }
            .clickable(onClick = onClick)
            .padding(start = 8.dp, end = 18.dp, top = 4.dp, bottom = 4.dp)
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
            .padding(start = 18.dp, end = 12.dp)
            .testTag(tag),
        contentAlignment = Alignment.CenterStart,
    ) {
        Text(label, style = JudgeType.slotTitle.copy(color = color))
    }
}
