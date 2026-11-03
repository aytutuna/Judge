package com.okjudge.judge.core.display

import java.util.regex.Pattern

enum class CruxFace { SERIF, SANS }

/** Port of lib/crux-style.ts: short cruxes in the display serif, long ones in the body face. */
object CruxStyle {
    const val CRUX_SERIF_MAX = 180

    private val WHITESPACE: Pattern = Pattern.compile("\\s+", Pattern.UNICODE_CHARACTER_CLASS)

    /** Counts code points of the whitespace-collapsed text. */
    fun cruxStyle(text: String): CruxFace {
        val collapsed = WHITESPACE.matcher(text).replaceAll(" ").jsTrim()
        val length = collapsed.codePointCount(0, collapsed.length)
        return if (length > CRUX_SERIF_MAX) CruxFace.SANS else CruxFace.SERIF
    }
}
