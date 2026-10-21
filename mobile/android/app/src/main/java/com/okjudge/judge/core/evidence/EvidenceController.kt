package com.okjudge.judge.core.evidence

import android.graphics.Bitmap
import com.okjudge.judge.core.api.ApiResult
import com.okjudge.judge.core.display.UiError
import com.okjudge.judge.core.model.EvidenceUploadResponse
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** Where one picked image stands (EvidenceItemStatus). */
enum class EvidenceStatus(val raw: String, val key: String) {
    READING("reading", "evidence.reading"),
    OK("ok", "evidence.ok"),
    UNREADABLE("unreadable", "evidence.status.unreadable"),
    REFUSED("refused", "evidence.status.refused"),
    UNSUPPORTED("unsupported", "evidence.status.unsupported"),
    TOO_LARGE("too_large", "evidence.status.too_large"),
    FAILED("failed", "evidence.status.failed");

    companion object {
        /** A server status; anything unknown reads as failed. */
        fun ofServer(raw: String): EvidenceStatus = entries.firstOrNull { it.raw == raw && it != READING } ?: FAILED
    }
}

data class EvidenceItem(
    val id: String,
    /** Position label shown to the user, 1-based, stable while the item lives. */
    val n: Int,
    val status: EvidenceStatus,
    val token: String? = null,
    /** The raw transcript (may contain real names), for the uploader's eyes only. */
    val preview: String? = null,
    val thumb: Bitmap? = null,
)

data class EvidenceState(
    val items: List<EvidenceItem> = emptyList(),
    val max: Int,
    /** The last whole-request failure, if any. */
    val failure: UiError? = null,
    /** True right after the user picked more images than fit. */
    val overLimit: Boolean = false,
) {
    /** Tokens of the images read successfully, in order. */
    val tokens: List<String> get() = items.filter { it.status == EvidenceStatus.OK && it.token != null }.map { it.token!! }

    /** Images still being read: a submission waits for them. */
    val busy: Boolean get() = items.any { it.status == EvidenceStatus.READING }

    val full: Boolean get() = items.size >= max
    val room: Int get() = (max - items.size).coerceAtLeast(0)
}

/**
 * Screenshot evidence (useEvidence in components/case/EvidencePicker.tsx):
 * up to [max] images, each prepared on the phone and uploaded right away,
 * so reading overlaps with writing. The server answers per image with a
 * signed token and a preview of what it read; only the tokens go with the
 * submission. Images are never kept.
 */
class EvidenceController(
    private val scope: CoroutineScope,
    val max: Int,
    private val upload: suspend (List<PreparedImage>) -> ApiResult<EvidenceUploadResponse>,
) {
    private val _state = MutableStateFlow(EvidenceState(max = max))
    val state: StateFlow<EvidenceState> = _state.asStateFlow()

    private var counter = 0
    private var seq = 0

    fun add(sources: List<ImageSource>) {
        val room = _state.value.room
        val picked = sources.take(room)
        val fresh = picked.map {
            counter += 1
            seq += 1
            EvidenceItem(id = "ev$seq", n = counter, status = EvidenceStatus.READING)
        }
        _state.update { it.copy(items = it.items + fresh, failure = null, overLimit = sources.size > room) }
        if (fresh.isEmpty()) return
        scope.launch {
            val prepared = picked.map { src -> async { runCatching { src.prepare() }.getOrDefault(Prepared.Unsupported) } }.awaitAll()
            val send = ArrayList<Pair<String, PreparedImage>>()
            val local = HashMap<String, EvidenceStatus>()
            prepared.forEachIndexed { i, p ->
                val id = fresh[i].id
                when (p) {
                    is Prepared.Ready -> send += id to p.image
                    Prepared.Unsupported -> local[id] = EvidenceStatus.UNSUPPORTED
                    Prepared.TooLarge -> local[id] = EvidenceStatus.TOO_LARGE
                }
            }
            val thumbs = send.associate { (id, img) -> id to img.thumbnail }
            _state.update { st ->
                st.copy(items = st.items.map { item ->
                    when {
                        local.containsKey(item.id) -> item.copy(status = local.getValue(item.id))
                        thumbs.containsKey(item.id) -> item.copy(thumb = thumbs[item.id])
                        else -> item
                    }
                })
            }
            if (send.isEmpty()) return@launch
            val sentIds = send.map { it.first }
            val answer = upload(send.map { it.second })
            _state.update { st ->
                val response = (answer as? ApiResult.Ok)?.value
                st.copy(
                    items = applyUploadResult(st.items, sentIds, response),
                    failure = (answer as? ApiResult.Err)?.error ?: st.failure,
                )
            }
        }
    }

    fun remove(id: String) {
        _state.update { st -> st.copy(items = st.items.filterNot { it.id == id }, overLimit = false) }
    }

    fun clear() {
        _state.update { EvidenceState(max = max) }
    }

    companion object {
        /** Maps one upload response onto the items that were sent, by index (applyUploadResult). */
        fun applyUploadResult(items: List<EvidenceItem>, sentIds: List<String>, response: EvidenceUploadResponse?): List<EvidenceItem> =
            items.map { item ->
                val index = sentIds.indexOf(item.id)
                if (index < 0) return@map item
                val result = response?.items?.firstOrNull { it.index == index }
                    ?: return@map item.copy(status = EvidenceStatus.FAILED)
                val status = EvidenceStatus.ofServer(result.status)
                if (status == EvidenceStatus.OK && result.token != null) {
                    item.copy(status = EvidenceStatus.OK, token = result.token, preview = result.preview)
                } else {
                    item.copy(status = if (status == EvidenceStatus.OK) EvidenceStatus.FAILED else status, token = null, preview = null)
                }
            }
    }
}
