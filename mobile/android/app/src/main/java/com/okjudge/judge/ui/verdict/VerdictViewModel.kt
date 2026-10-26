package com.okjudge.judge.ui.verdict

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.okjudge.judge.core.api.ApiResult
import com.okjudge.judge.core.api.JudgeApi
import com.okjudge.judge.core.data.HistoryRepository
import com.okjudge.judge.core.data.SavedVerdict
import com.okjudge.judge.core.display.ContentLang
import com.okjudge.judge.core.display.UiError
import com.okjudge.judge.core.model.ParsedResult
import com.okjudge.judge.core.model.VerdictShape
import com.okjudge.judge.core.model.WireJson
import com.okjudge.judge.i18n.AppLang
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChangedBy
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** A translation fetched (or failed) for one language (TranslationEntry in lib/use-translation.ts). */
sealed interface TranslationEntry {
    data class Ready(val result: ParsedResult) : TranslationEntry
    /** The server said the verdict already is in that language. */
    data object SameAsOriginal : TranslationEntry
    data object Loading : TranslationEntry
    data class Failed(val offline: Boolean) : TranslationEntry
    /** Rate limited: not retried before `untilMillis`. */
    data class Blocked(val untilMillis: Long) : TranslationEntry
}

data class VerdictUiState(
    val loading: Boolean = true,
    val saved: SavedVerdict? = null,
    val view: TranslationView? = null,
)

/**
 * One saved verdict, shown in the UI language. The original and every
 * fetched translation stay available, so switching back is instant; fetched
 * translations are cached in the history row for offline use.
 */
class VerdictViewModel(
    private val id: String,
    private val history: HistoryRepository,
    private val api: JudgeApi,
    private val clock: () -> Long = System::currentTimeMillis,
) : ViewModel() {

    private val lang = MutableStateFlow<AppLang?>(null)
    private val entries = MutableStateFlow<Map<AppLang, TranslationEntry>>(emptyMap())
    private var latestSaved: SavedVerdict? = null

    val state: StateFlow<VerdictUiState> =
        combine(history.observe(id), lang, entries) { saved, lang, entries ->
            latestSaved = saved
            if (saved == null || lang == null) {
                VerdictUiState(loading = saved == null && lang == null, saved = saved)
            } else {
                VerdictUiState(loading = false, saved = saved, view = viewFor(saved, lang, entries[lang]))
            }
        }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), VerdictUiState())

    init {
        // A later ruling (context added) is translated on its own.
        viewModelScope.launch {
            history.observe(id).filterNotNull().distinctUntilChangedBy { it.rulingId }.drop(1).collect { saved ->
                entries.value = emptyMap()
                lang.value?.let { ensureTranslation(it, saved) }
            }
        }
    }

    /** Called whenever the UI language changes (and once on first show). */
    fun onLang(target: AppLang) {
        if (lang.value == target) return
        // A language change forgets retryable failures (dropRetryable).
        entries.update { map -> map.filterValues { it !is TranslationEntry.Failed } }
        lang.value = target
        viewModelScope.launch { ensureTranslation(target) }
    }

    private fun viewFor(saved: SavedVerdict, lang: AppLang, entry: TranslationEntry?): TranslationView {
        val original = saved.original.result
        val source = ContentLang.verdictLang(original)
        if (source == lang) return TranslationView(original, TranslationStatus.ORIGINAL, source)
        saved.translations[lang]?.let { return TranslationView(it.result, TranslationStatus.TRANSLATED, source) }
        return when (entry) {
            is TranslationEntry.Ready -> TranslationView(entry.result.result, TranslationStatus.TRANSLATED, source)
            TranslationEntry.SameAsOriginal -> TranslationView(original, TranslationStatus.ORIGINAL, source)
            is TranslationEntry.Failed ->
                TranslationView(original, if (entry.offline) TranslationStatus.OFFLINE else TranslationStatus.ERROR, source)
            is TranslationEntry.Blocked -> TranslationView(original, TranslationStatus.ERROR, source)
            TranslationEntry.Loading, null -> TranslationView(original, TranslationStatus.LOADING, source)
        }
    }

    private suspend fun ensureTranslation(target: AppLang, known: SavedVerdict? = null) {
        val saved = known ?: latestSaved ?: history.observeFirst(id) ?: return
        if (ContentLang.verdictLang(saved.original.result) == target) return
        if (saved.translations.containsKey(target)) return
        when (val entry = entries.value[target]) {
            TranslationEntry.Loading, is TranslationEntry.Ready, TranslationEntry.SameAsOriginal -> return
            is TranslationEntry.Blocked -> if (entry.untilMillis > clock()) return
            is TranslationEntry.Failed, null -> Unit
        }
        entries.update { it + (target to TranslationEntry.Loading) }
        val res = api.translate(saved.rulingId, target)
        // Context was added meanwhile: this is the earlier ruling's translation.
        if (history.observeFirst(id)?.rulingId != saved.rulingId) return
        val next: TranslationEntry = when (res) {
            is ApiResult.Ok -> {
                val out = res.value
                when {
                    out.lang != target.tag -> TranslationEntry.Failed(offline = false)
                    !out.translated -> TranslationEntry.SameAsOriginal
                    !VerdictShape.looksLikeVerdict(WireJson.json.parseToJsonElement(out.result.rawJson)) ->
                        TranslationEntry.Failed(offline = false)
                    else -> {
                        history.cacheTranslation(id, target, out.result)
                        TranslationEntry.Ready(out.result)
                    }
                }
            }
            is ApiResult.Err -> failureEntry(res.error)
        }
        entries.update { it + (target to next) }
    }

    private fun failureEntry(error: UiError): TranslationEntry = when {
        error == UiError.Offline -> TranslationEntry.Failed(offline = true)
        error is UiError.Api && error.status == 429 -> {
            val wait = (error.retryAfterSec ?: 60.0).coerceIn(1.0, MAX_RETRY_AFTER_SEC)
            TranslationEntry.Blocked(clock() + (wait * 1000).toLong())
        }
        else -> TranslationEntry.Failed(offline = false)
    }

    fun delete(onDone: () -> Unit) {
        viewModelScope.launch {
            history.delete(id)
            onDone()
        }
    }

    private companion object {
        const val MAX_RETRY_AFTER_SEC = 600.0
    }
}

private suspend fun HistoryRepository.observeFirst(id: String): SavedVerdict? = observe(id).first()
