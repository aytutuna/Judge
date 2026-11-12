package com.okjudge.judge.core.session

import android.content.SharedPreferences

/**
 * What a verdict request leaves behind, so a resubmit after the system killed
 * the app reuses its venue and Idempotency-Key (the server replays instead of
 * charging again) and the accepted verdict can be picked up again. Only hashes
 * of the request text are kept.
 */
data class SavedRequest(
    val venueHash: String?,
    val venue: String?,
    val keyHash: String?,
    val key: String?,
    val acceptedId: String?,
    val savedAt: Long,
)

interface PendingStore {
    fun load(): SavedRequest?
    fun save(saved: SavedRequest?)
}

class MemoryPending : PendingStore {
    private var saved: SavedRequest? = null

    override fun load() = saved

    override fun save(saved: SavedRequest?) {
        this.saved = saved
    }
}

class PrefsPending(private val prefs: SharedPreferences) : PendingStore {
    override fun load(): SavedRequest? {
        val at = prefs.getLong(AT, 0L).takeIf { it > 0 } ?: return null
        return SavedRequest(
            venueHash = prefs.getString(VENUE_HASH, null),
            venue = prefs.getString(VENUE, null),
            keyHash = prefs.getString(KEY_HASH, null),
            key = prefs.getString(KEY, null),
            acceptedId = prefs.getString(ACCEPTED, null),
            savedAt = at,
        )
    }

    override fun save(saved: SavedRequest?) {
        prefs.edit().clear().apply {
            if (saved != null) {
                putString(VENUE_HASH, saved.venueHash)
                putString(VENUE, saved.venue)
                putString(KEY_HASH, saved.keyHash)
                putString(KEY, saved.key)
                putString(ACCEPTED, saved.acceptedId)
                putLong(AT, saved.savedAt)
            }
        }.apply()
    }

    private companion object {
        const val VENUE_HASH = "venue_hash"
        const val VENUE = "venue"
        const val KEY_HASH = "key_hash"
        const val KEY = "key"
        const val ACCEPTED = "accepted"
        const val AT = "at"
    }
}
