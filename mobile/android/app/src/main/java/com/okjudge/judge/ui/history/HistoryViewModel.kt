package com.okjudge.judge.ui.history

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.okjudge.judge.core.api.ApiResult
import com.okjudge.judge.core.api.JudgeApi
import com.okjudge.judge.core.data.HistoryRepository
import com.okjudge.judge.core.data.SavedVerdict
import com.okjudge.judge.core.data.isoMillis
import com.okjudge.judge.core.display.UiError
import com.okjudge.judge.core.model.HistoryItem
import com.okjudge.judge.core.model.HistoryOrder
import com.okjudge.judge.core.model.HistoryPage
import com.okjudge.judge.core.model.HistoryState
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** A row of the Verdicts list: one from the account, or a verdict the account doesn't have that is kept on this phone. */
sealed interface HistoryEntry {
    val key: String
    val at: String

    data class Account(val item: HistoryItem) : HistoryEntry {
        override val key: String get() = item.key
        override val at: String get() = item.at
    }

    data class Phone(val verdict: SavedVerdict) : HistoryEntry {
        override val key: String get() = "v:${verdict.id}"
        override val at: String = isoMillis(verdict.createdAt)
    }

    /** Select mode can pick it: phone rows, and account rows whose own page offers Remove. */
    val selectable: Boolean get() = when (this) {
        is Account -> item.removable
        is Phone -> true
    }
}

/**
 * The account's rows and the phone's own, newest first. A phone row older
 * than [cutoff] (the last account row loaded this session) waits until the
 * account's list is loaded that far: the account may have it.
 */
fun mergeHistory(cached: List<HistoryItem>, saved: List<SavedVerdict>, user: String?, cutoff: String? = null): List<HistoryEntry> {
    val listed = cached.map { it.key }.toSet()
    val phone = saved
        .filter { (it.ownerUserId == null || it.ownerUserId == user) && "v:${it.id}" !in listed }
        .map { HistoryEntry.Phone(it) }
        .filter { cutoff == null || it.at >= cutoff }
    return (cached.map { HistoryEntry.Account(it) } + phone).sortedWith { x, y -> HistoryOrder.compare(x.at to x.key, y.at to y.key) }
}

/** Paging of the account's list in this session. */
data class HistoryPaging(
    val loading: Boolean = false,
    val failed: Boolean = false,
    /** The cursor of the next page; null once there is none (or before the first load). */
    val next: String? = null,
    val loadingMore: Boolean = false,
    /** The last row loaded this session. */
    val last: HistoryItem? = null,
    val loadedAll: Boolean = false,
    /** When page 1 was last loaded; null: not this session. */
    val loadedAt: Long? = null,
) {
    /** Phone rows older than this wait (see [mergeHistory]); null shows them all. */
    val cutoff: String? get() = if (loadedAt == null || loadedAll) null else last?.at
}

sealed interface HistoryNotice {
    data object Offline : HistoryNotice
    data class RemoveFailed(val count: Int) : HistoryNotice
    data object OpenFailed : HistoryNotice
    data object LoadMoreFailed : HistoryNotice
}

/**
 * The Verdicts list: the account's rows from GET /api/v1/me/history, cached
 * on the phone (shown at once and offline, the server wins on refresh),
 * plus verdicts kept only on this phone. [user] is the account the list
 * belongs to (null signed out); [syncOn] says the server offers the list.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class HistoryViewModel(
    private val history: HistoryRepository,
    private val api: JudgeApi,
    private val user: StateFlow<String?>,
    private val syncOn: () -> Boolean,
    private val clock: () -> Long = System::currentTimeMillis,
) : ViewModel() {
    private val _paging = MutableStateFlow(HistoryPaging())
    val paging: StateFlow<HistoryPaging> = _paging.asStateFlow()

    private val _notice = MutableStateFlow<HistoryNotice?>(null)
    val notice: StateFlow<HistoryNotice?> = _notice.asStateFlow()

    /** Null until the first read from the database. */
    val entries: StateFlow<List<HistoryEntry>?> = user.flatMapLatest { id ->
        val cached = if (id == null) flowOf(emptyList()) else history.observeCached(id)
        combine(cached, history.observeAll(), _paging) { rows, saved, paging -> mergeHistory(rows, saved, id, paging.cutoff) }
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    init {
        viewModelScope.launch {
            var seen: String? = null
            user.collect { id ->
                if (id != seen) {
                    seen = id
                    _paging.value = HistoryPaging()
                    refresh(force = true)
                }
            }
        }
    }

    /** Page 1 again, at most once a minute unless [force]d. */
    fun refresh(force: Boolean = false) {
        val id = user.value ?: return
        val p = _paging.value
        if (!syncOn() || p.loading) return
        if (!force && p.loadedAt != null && clock() - p.loadedAt < REFRESH_MS) return
        _paging.update { it.copy(loading = true, failed = false) }
        viewModelScope.launch {
            when (val res = api.history(LIMIT)) {
                is ApiResult.Ok -> {
                    if (user.value != id) return@launch
                    val page = res.value
                    history.applyPage(id, page, above = null)
                    _paging.update { now -> afterFirstPage(now, page) }
                }
                is ApiResult.Err -> _paging.update { it.copy(loading = false, failed = true) }
            }
        }
    }

    /** Page 1 reloaded keeps what Show more loaded below it. */
    private fun afterFirstPage(now: HistoryPaging, page: HistoryPage): HistoryPaging {
        val pageLast = page.items.lastOrNull()
        val deeper = now.loadedAt != null && page.next != null &&
            (now.loadedAll || (now.last != null && pageLast != null && HistoryOrder.compare(pageLast.at to pageLast.key, now.last.at to now.last.key) < 0))
        if (deeper) return now.copy(loading = false, failed = false, loadedAt = clock())
        return HistoryPaging(next = page.next, last = pageLast, loadedAll = page.next == null, loadedAt = clock())
    }

    fun loadMore() {
        val id = user.value ?: return
        val p = _paging.value
        val cursor = p.next ?: return
        if (p.loading || p.loadingMore) return
        _paging.update { it.copy(loadingMore = true) }
        if (_notice.value == HistoryNotice.LoadMoreFailed) _notice.value = null
        viewModelScope.launch {
            when (val res = api.history(LIMIT, cursor)) {
                is ApiResult.Ok -> {
                    if (user.value != id) return@launch
                    history.applyPage(id, res.value, above = p.last)
                    _paging.update {
                        it.copy(loadingMore = false, next = res.value.next, last = res.value.items.lastOrNull() ?: it.last, loadedAll = res.value.next == null)
                    }
                }
                is ApiResult.Err -> {
                    _paging.update { it.copy(loadingMore = false) }
                    _notice.value = HistoryNotice.LoadMoreFailed
                }
            }
        }
    }

    /**
     * Removes [picked]: account rows through the server (as each one's page
     * does), phone rows from the phone. [done] gets the keys that failed, which
     * stay picked.
     */
    fun remove(picked: List<HistoryEntry>, done: (Set<String>) -> Unit = {}) {
        val id = user.value
        viewModelScope.launch {
            _notice.value = null
            picked.filterIsInstance<HistoryEntry.Phone>().forEach { history.delete(it.verdict.id) }
            val failed = linkedSetOf<String>()
            var offline = false
            var stale = false
            for (entry in picked.filterIsInstance<HistoryEntry.Account>()) {
                if (offline || id == null) {
                    failed += entry.key
                    continue
                }
                val error = removeOne(entry.item)
                when {
                    error == null -> markRemoved(id, entry.item)
                    error == UiError.Offline -> {
                        offline = true
                        failed += entry.key
                    }
                    // Removed meanwhile (or not this account's any more): the list catches up.
                    error is UiError.Api && error.code in GONE -> stale = true
                    else -> failed += entry.key
                }
            }
            _notice.value = when {
                offline -> HistoryNotice.Offline
                failed.isNotEmpty() -> HistoryNotice.RemoveFailed(failed.size)
                else -> null
            }
            if (stale) refresh(force = true)
            done(failed)
        }
    }

    private suspend fun removeOne(item: HistoryItem): UiError? {
        val res: ApiResult<*> = when {
            !item.isCase -> api.removeVerdict(item.id)
            item.isRespondent -> item.inviteToken?.let { api.removeAnsweredCase(it) } ?: return UiError.Unknown
            else -> api.removeCase(item.id)
        }
        return (res as? ApiResult.Err)?.error
    }

    private suspend fun markRemoved(user: String, item: HistoryItem) {
        val removed = item.copy(
            state = HistoryState.REMOVED.raw,
            removed = true,
            removable = false,
            yourMove = false,
            verdict = null,
            contextAdded = false,
            headline = null,
            excerpt = null,
            nameMap = emptyList(),
            expiresAt = null,
        )
        history.updateCached(user, removed)
        if (!item.isCase) history.delete(item.id)
    }

    /** An account verdict: opens from the phone when kept there, else it is read from the account first. */
    fun openVerdict(item: HistoryItem, onReady: (String) -> Unit) {
        val id = user.value ?: return
        viewModelScope.launch {
            _notice.value = null
            if (history.observe(item.id).first() != null) return@launch onReady(item.id)
            val mine = api.mineVerdict(item.id)
            if (mine is ApiResult.Ok && mine.value.result != null) {
                history.keep(id, item, mine.value)
                onReady(item.id)
            } else {
                _notice.value = HistoryNotice.OpenFailed
            }
        }
    }

    fun clearNotice() {
        _notice.value = null
    }

    companion object {
        const val LIMIT = 20
        const val REFRESH_MS = 60_000L
        const val POLL_MS = 20_000L
        private val GONE = setOf("not_found", "removed")
    }
}
