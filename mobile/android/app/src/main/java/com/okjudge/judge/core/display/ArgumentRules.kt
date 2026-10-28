package com.okjudge.judge.core.display

/** Limits shared with the server (lib/types.ts ArgumentText). */
object ArgumentRules {
    const val MIN = 20
    const val MAX = 6000

    /** The counter turns terracotta above this. */
    const val WARN_AT = 5700

    fun canSubmit(argument: String): Boolean = argument.jsTrim().length >= MIN && argument.length <= MAX
}
