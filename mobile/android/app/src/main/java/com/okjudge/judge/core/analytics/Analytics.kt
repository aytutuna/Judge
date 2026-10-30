package com.okjudge.judge.core.analytics

import android.util.Log
import com.okjudge.judge.BuildConfig
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import java.io.File
import java.io.IOException

/** One queued event; [seq] only identifies it on this phone. [at] is epoch milliseconds. */
@Serializable
data class AnalyticsEvent(val seq: Long, val name: String, val at: Long, val props: Map<String, String>? = null)

/** `context` of POST /api/v1/events. */
@Serializable
data class AnalyticsContext(
    val platform: String = "android",
    @SerialName("app_version") val appVersion: String,
    @SerialName("anon_id") val anonId: String,
    @SerialName("device_id") val deviceId: String? = null,
    @SerialName("os_version") val osVersion: String? = null,
    @SerialName("device_model") val deviceModel: String? = null,
    val locale: String? = null,
)

enum class Delivery {
    SENT,

    /** The server refused the batch (400): sending it again would not help. */
    REJECTED,

    /** Offline, rate limited or a server error: try again later. */
    FAILED,
}

fun interface AnalyticsTransport {
    suspend fun send(body: String): Delivery
}

/**
 * First-party usage events (lib/analytics/track.ts lists the names). They
 * queue in memory and in [file], so a crash loses none, and go out in
 * batches: once 20 are waiting, every 30 s while the app is in front and when
 * it goes to the background. Nothing is queued while the user's setting is
 * off or the server's `features.analytics` is false; until /api/v1/config has
 * answered they wait. Main thread only, apart from the file writes on [io].
 */
class Analytics(
    private val transport: AnalyticsTransport,
    private val context: AnalyticsContext,
    private val file: File?,
    private val scope: CoroutineScope,
    private val io: CoroutineDispatcher = Dispatchers.IO.limitedParallelism(1),
    private val now: () -> Long = System::currentTimeMillis,
    private val log: (String) -> Unit = { if (BuildConfig.DEBUG) Log.w("Analytics", it) },
) {
    private val events = ArrayList<AnalyticsEvent>()
    private var nextSeq = 1L
    private var sending = false
    private var backoffMs = 0L
    private var ticker: Job? = null
    private var opened = false
    private var leftAt: Long? = null

    /** `features.analytics` once /api/v1/config answered. */
    var serverOn: Boolean? = null
        private set

    /** While the last send failed: when to try again. */
    var retryAt: Long? = null
        private set

    val queue: List<AnalyticsEvent> get() = events.toList()

    /**
     * The "Usage statistics" setting; null until it has been read. Until then
     * events wait in memory only, so an opted-out install never writes one.
     */
    var allowed: Boolean? = null
        set(value) {
            val first = field == null
            field = value
            if (value == false) {
                clear()
            } else if (value == true && first) {
                val saved = read()
                events.addAll(0, saved)
                trim()
                // Events from the last run and this one may share numbers.
                events.forEachIndexed { i, e -> events[i] = e.copy(seq = i + 1L) }
                nextSeq = events.size + 1L
                save()
            }
        }

    fun setServerOn(on: Boolean) {
        serverOn = on
        if (on) scope.launch { flush() } else clear()
    }

    fun track(name: String, props: Map<String, String> = emptyMap()) {
        if (allowed == false || serverOn == false) return
        problem(name, props)?.let {
            if (BuildConfig.DEBUG) error("analytics: $it")
            return
        }
        events += AnalyticsEvent(nextSeq++, name, now(), props.ifEmpty { null })
        trim()
        save()
        if (events.size >= FLUSH_AT) scope.launch { flush() }
    }

    /** Sends what is queued, a batch at a time, unless a failed send is still waiting out its backoff. */
    suspend fun flush() {
        if (allowed != true || serverOn != true || sending) return
        retryAt?.let { if (now() < it) return }
        sending = true
        try {
            while (allowed == true && serverOn == true && events.isNotEmpty()) {
                val batch = events.take(BATCH_SIZE)
                val body = json.encodeToString(Batch.serializer(), Batch(context, batch.map { WireEvent(it.name, it.at, it.props) }))
                when (transport.send(body)) {
                    Delivery.SENT -> {
                        backoffMs = 0
                        retryAt = null
                        remove(batch)
                    }
                    Delivery.REJECTED -> {
                        log("events refused by the server: ${batch.joinToString(",") { it.name }}")
                        remove(batch)
                    }
                    Delivery.FAILED -> {
                        backoffMs = (backoffMs * 2).coerceIn(MIN_BACKOFF_MS, MAX_BACKOFF_MS)
                        retryAt = now() + backoffMs
                        return
                    }
                }
            }
        } finally {
            sending = false
        }
    }

    /** The app came to the front: app_open on a cold start or after a long absence, and the 30 s flushes. */
    fun becameActive() {
        val away = leftAt?.let { now() - it > SESSION_GAP_MS } ?: !opened
        opened = true
        leftAt = null
        if (away) track("app_open")
        ticker?.cancel()
        ticker = scope.launch {
            while (isActive) {
                delay(INTERVAL_MS)
                flush()
            }
        }
    }

    fun enteredBackground() {
        leftAt = now()
        ticker?.cancel()
        ticker = null
        if (events.isNotEmpty()) scope.launch { flush() }
    }

    private fun trim() {
        if (events.size > CAP) events.subList(0, events.size - CAP).clear()
    }

    private fun remove(batch: List<AnalyticsEvent>) {
        val sent = batch.mapTo(HashSet()) { it.seq }
        events.removeAll { it.seq in sent }
        save()
    }

    private fun clear() {
        events.clear()
        retryAt = null
        backoffMs = 0
        val file = file ?: return
        scope.launch(io) { file.delete() }
    }

    private fun save() {
        val file = file ?: return
        if (allowed != true) return
        val text = if (events.isEmpty()) null else json.encodeToString(ListSerializer(AnalyticsEvent.serializer()), events.toList())
        scope.launch(io) {
            try {
                if (text == null) {
                    file.delete()
                } else {
                    val tmp = File(file.path + ".tmp")
                    tmp.writeText(text)
                    if (!tmp.renameTo(file)) tmp.delete()
                }
            } catch (_: IOException) {
            }
        }
    }

    private fun read(): List<AnalyticsEvent> {
        val text = try {
            file?.takeIf { it.exists() }?.readText()
        } catch (_: IOException) {
            null
        } ?: return emptyList()
        return try {
            json.decodeFromString(ListSerializer(AnalyticsEvent.serializer()), text)
        } catch (_: SerializationException) {
            emptyList()
        } catch (_: IllegalArgumentException) {
            emptyList()
        }
    }

    @Serializable
    private data class WireEvent(val name: String, val at: Long, val props: Map<String, String>? = null)

    @Serializable
    private data class Batch(val context: AnalyticsContext, val events: List<WireEvent>)

    companion object {
        const val BATCH_SIZE = 50
        const val FLUSH_AT = 20
        const val CAP = 500
        const val INTERVAL_MS = 30_000L

        /** Back after longer than this, the app counts as opened again. */
        const val SESSION_GAP_MS = 30 * 60_000L

        /** The rate limit is per hour, so a failed send waits at least a minute. */
        const val MIN_BACKOFF_MS = 60_000L
        const val MAX_BACKOFF_MS = 15 * 60_000L

        private val json = Json {
            encodeDefaults = true
            explicitNulls = false
            ignoreUnknownKeys = true
        }

        /** The one prop each event may have; the rest send none. Values are short tokens, never anything a user wrote. */
        val ALLOWED_PROPS = mapOf(
            "screen_view" to "screen",
            "buy_tapped" to "product",
            "sign_in_started" to "provider",
            "settings_changed" to "key",
            "error_shown" to "code",
        )

        /** Sent by the server only; it refuses them from the app. */
        val SERVER_EVENTS = setOf("case_created", "verdict_ready", "verdict_failed", "case_claimed", "purchase_granted", "sign_in")

        private val NAME = Regex("^[a-z][a-z0-9_]{0,63}$")
        private val TOKEN = Regex("^[A-Za-z0-9_.:/-]{1,64}$")

        /** Why the server would refuse this event, or null. */
        fun problem(name: String, props: Map<String, String>): String? {
            if (!NAME.matches(name)) return "bad event name $name"
            if (name in SERVER_EVENTS) return "$name is sent by the server"
            for ((key, value) in props) {
                if (ALLOWED_PROPS[name] != key) return "$name takes no prop $key"
                if (!TOKEN.matches(value)) return "value of $key is not a token"
            }
            return null
        }
    }
}
