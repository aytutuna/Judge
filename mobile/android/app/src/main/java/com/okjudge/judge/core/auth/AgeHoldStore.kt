package com.okjudge.judge.core.auth

import android.content.SharedPreferences

/**
 * Whether this install is held behind the parental approval cover. Only that one derived flag is kept,
 * never the range Play reported, so a cold start without a network keeps the hold until Play says otherwise.
 */
interface AgeHoldStore {
    var held: Boolean

    class Memory : AgeHoldStore {
        override var held = false
    }

    class Prefs(private val prefs: SharedPreferences) : AgeHoldStore {
        override var held: Boolean
            get() = prefs.getBoolean(HELD, false)
            set(value) = prefs.edit().putBoolean(HELD, value).apply()
    }

    companion object {
        const val FILE = "age_hold"
        private const val HELD = "held"
    }
}
