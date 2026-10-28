package com.okjudge.judge

import com.okjudge.judge.core.data.HistoryRepository
import com.okjudge.judge.core.data.SavedVerdict
import com.okjudge.judge.core.model.HistoryItem
import com.okjudge.judge.core.model.HistoryOrder
import com.okjudge.judge.core.model.HistoryPage
import com.okjudge.judge.core.model.MineVerdict
import com.okjudge.judge.core.model.ParsedResult
import com.okjudge.judge.core.model.VerdictOutcome
import com.okjudge.judge.i18n.AppLang
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update

/** In-memory history for ViewModel and flow tests. */
class FakeHistory(private var clock: Long = 1_000L) : HistoryRepository {
    val rows = MutableStateFlow<List<SavedVerdict>>(emptyList())
    val cached = mutableListOf<Pair<String, AppLang>>()

    override fun observeAll(): Flow<List<SavedVerdict>> = rows.map { list -> list.sortedByDescending { it.createdAt } }

    override fun observe(id: String): Flow<SavedVerdict?> = rows.map { list -> list.firstOrNull { it.id == id } }

    override suspend fun save(outcome: VerdictOutcome) {
        clock += 1
        val row = SavedVerdict(outcome.id, clock, outcome.result, outcome.nameMap, emptyMap())
        rows.update { list -> list.filterNot { it.id == outcome.id } + row }
    }

    override suspend fun saveRuling(id: String, ruling: VerdictOutcome) {
        rows.update { list ->
            list.map {
                if (it.id != id) it
                else it.copy(original = ruling.result, nameMap = it.nameMap + ruling.nameMap, translations = emptyMap(), rulingId = ruling.id)
            }
        }
    }

    override suspend fun cacheTranslation(id: String, lang: AppLang, translation: ParsedResult) {
        cached += id to lang
        rows.update { list -> list.map { if (it.id == id) it.copy(translations = it.translations + (lang to translation)) else it } }
    }

    override suspend fun delete(id: String) = rows.update { list -> list.filterNot { it.id == id } }

    override suspend fun deleteAll() = rows.update { emptyList() }

    /** The list cache per user; pages are merged in without the window rules of the Room store. */
    val listed = MutableStateFlow<Map<String, List<HistoryItem>>>(emptyMap())

    override fun observeCached(user: String): Flow<List<HistoryItem>> =
        listed.map { all -> all[user].orEmpty().sortedWith { x, y -> HistoryOrder.compare(x.at to x.key, y.at to y.key) } }

    override suspend fun cachedUser(): String? = listed.value.keys.firstOrNull()

    override suspend fun setAccount(user: String?) {}

    override suspend fun forgetAccounts() {
        listed.value = emptyMap()
        rows.update { list -> list.filter { it.ownerUserId == null } }
    }

    override suspend fun applyPage(user: String, page: HistoryPage, above: HistoryItem?) {
        page.items.forEach { updateCached(user, it) }
    }

    override suspend fun updateCached(user: String, item: HistoryItem) = listed.update { all ->
        all + (user to (all[user].orEmpty().filterNot { it.key == item.key } + item))
    }

    override suspend fun keep(user: String, item: HistoryItem, mine: MineVerdict) {
        val result = mine.result ?: return
        rows.update { list -> list.filterNot { it.id == item.id } + SavedVerdict(item.id, clock, result, mine.nameMap, emptyMap(), ownerUserId = user) }
    }
}
