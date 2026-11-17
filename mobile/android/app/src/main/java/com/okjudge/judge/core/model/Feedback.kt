package com.okjudge.judge.core.model

import kotlinx.serialization.Serializable

/** GET and POST /api/v1/me/consent: whether the person has been asked, and what they chose. */
enum class ConsentState(val wire: String) {
    NOT_ASKED("not_asked"),
    ON("on"),
    OFF("off");

    companion object {
        fun fromWire(value: String?): ConsentState? = entries.firstOrNull { it.wire == value }
    }
}

@Serializable
data class ConsentResponse(val state: String? = null, val ask: Boolean = false, val sensitiveAgreed: Boolean = false)

/** [ask]: the server wants the "Help improve Judge" card shown now; [sensitiveAgreed]: the private details tick is on file. */
data class ConsentStatus(val state: ConsentState, val ask: Boolean, val sensitiveAgreed: Boolean)

/** The viewer's "Fair verdict?" answer, kept with the verdict. */
enum class Rating(val wire: String) {
    UP("up"),
    DOWN("down");

    companion object {
        fun fromWire(value: String?): Rating? = entries.firstOrNull { it.wire == value }
    }
}
