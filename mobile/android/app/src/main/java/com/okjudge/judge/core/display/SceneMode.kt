package com.okjudge.judge.core.display

import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject
import java.util.Locale

enum class SceneBeat {
    LIFT, SORT, DIG, CRUX, ORBS, DELIBERATE;

    val wire: String get() = name.lowercase(Locale.ROOT)
}

/** What the bundled balance scene shows (lib/scene-bridge.ts SceneMode). */
sealed interface SceneMode {
    data class Judging(val beat: SceneBeat) : SceneMode
    data class Verdict(val tugA: Int, val votes: List<Vote>) : SceneMode

    /** The argument of `window.judgeScene.setMode`. */
    fun json(): String = when (this) {
        is Judging -> buildJsonObject {
            put("kind", "judging")
            put("beat", beat.wire)
        }
        is Verdict -> buildJsonObject {
            put("kind", "verdict")
            putJsonObject("verdict") {
                put("tugA", tugA)
                putJsonArray("votes") { votes.forEach { add(JsonPrimitive(it.wire)) } }
            }
        }
    }.toString()
}
