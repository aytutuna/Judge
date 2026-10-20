package com.okjudge.judge.core.display

/**
 * The value-framework presets of lib/frameworks.ts. Labels and blurbs come
 * from the shared strings (`preset.<id>.label` / `.blurb`); the emoji are a
 * hand-copied table pinned by a test against display-vectors.json.
 */
enum class Preset(val id: String, val emoji: String) {
    BALANCED("balanced", "⚖️"),
    OUTCOMES("outcomes", "🎯"),
    PRINCIPLES("principles", "📜"),
    FAIRNESS("fairness", "🤝"),
    LOYALTY("loyalty", "❤️");

    val labelKey: String get() = "preset.$id.label"
    val blurbKey: String get() = "preset.$id.blurb"

    companion object {
        val DEFAULT = BALANCED
        fun of(id: String?): Preset = entries.firstOrNull { it.id == id } ?: DEFAULT
    }
}

/** Example chips under the text box (`example.<id>.label` / `.text`). */
enum class Example(val id: String) {
    HOTDOG("hotdog"), TOMATO("tomato"), WHITE_LIE("whiteLie"), KNUCKLES("knuckles"), PINEAPPLE("pineapple");

    val labelKey: String get() = "example.$id.label"
    val textKey: String get() = "example.$id.text"
}

/** Limits shared with the server (lib/types.ts ArgumentText). */
object ArgumentRules {
    const val MIN = 20
    const val MAX = 6000

    /** The counter turns terracotta above this. */
    const val WARN_AT = 5700

    fun canSubmit(argument: String): Boolean = argument.jsTrim().length >= MIN && argument.length <= MAX
}
