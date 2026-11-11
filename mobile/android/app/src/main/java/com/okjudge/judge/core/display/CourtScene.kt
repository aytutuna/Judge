package com.okjudge.judge.core.display

import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray

/** What the bundled court page shows (components/court/engine.ts Scene). */
sealed interface CourtScene {
    data class Home(val busy: Boolean) : CourtScene

    /** [sides] is how many stand at centre court before the verdict says. */
    data class Judging(val beat: Story.Beat, val summary: Story.Summary?, val sides: Int = 2) : CourtScene

    /** The argument of `window.judgeCourt.set`. */
    fun json(): String = when (this) {
        is Home -> buildJsonObject {
            put("kind", "home")
            put("busy", busy)
        }
        is Judging -> buildJsonObject {
            put("kind", "judging")
            put("beat", beat.wire)
            putJsonArray("votes") { summary?.votes?.forEach { add(JsonPrimitive(it.wire)) } }
            put("extra", summary?.extra ?: 0)
            put("winner", summary?.winner?.wire?.let(::JsonPrimitive) ?: JsonNull)
            put("trial", summary?.trial?.raw?.let(::JsonPrimitive) ?: JsonNull)
            // Two sides are the default and stay as they were.
            val count = maxOf(sides, summary?.sides ?: 2)
            if (count > 2) put("sides", count)
        }
    }.toString()
}
