package com.okjudge.judge.core.display

import android.content.SharedPreferences
import android.content.res.AssetManager
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json
import kotlin.math.min

/**
 * The places the court can be drawn in. The ids are assets/venues.json (written from
 * lib/venues.ts); the pick rule is `pickVenue` there. A missing or unknown id is the court.
 */
object Venues {
    const val COURT = "court"

    /** Any id but [last] (unless there is only one), at index min(floor(random * count), count - 1). [random] is in [0, 1). */
    fun pick(ids: List<String>, last: String?, random: Double): String {
        if (ids.isEmpty()) return COURT
        val pool = ids.filter { it != last || ids.size == 1 }
        return pool[min((random * pool.size).toInt(), pool.size - 1)]
    }
}

/** The bundled list of venues, and which of them this phone showed last. */
class VenueBook(private val assets: AssetManager, private val prefs: SharedPreferences) {
    /** The shared list, else just the court when the file can't be read. */
    fun load(): List<String> {
        val read = runCatching {
            assets.open("venues.json").use { Json.decodeFromString(ListSerializer(String.serializer()), it.readBytes().decodeToString()) }
        }.getOrNull()
        return read?.takeIf { it.isNotEmpty() } ?: listOf(Venues.COURT)
    }

    /** A fresh pick, remembered as the last one shown. */
    fun pickNew(random: Double = Math.random()): String {
        val id = Venues.pick(load(), prefs.getString(LAST, null), random)
        prefs.edit().putString(LAST, id).apply()
        return id
    }

    companion object {
        const val LAST = "judge-venue-last"
        const val FILE = "venues"
    }
}
