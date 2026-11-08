package com.okjudge.judge.core.display

import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray

/** What the bundled court page shows (components/court/engine.ts Scene). */
sealed interface CourtScene {
    data class Home(val busy: Boolean) : CourtScene
    data class Judging(val beat: Story.Beat, val summary: Story.Summary?) : CourtScene

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
        }
    }.toString()
}
