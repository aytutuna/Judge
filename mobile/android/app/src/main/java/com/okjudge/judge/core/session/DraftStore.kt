package com.okjudge.judge.core.session

import android.content.SharedPreferences

/** What was typed on Home and not sent: kept so a back-exit or a killed process does not lose it. */
data class Draft(
    val argument: String = "",
    val other: String = "",
    val otherName: String = "",
    val name: String? = null,
    val theirsOpen: Boolean = false,
    val moreText: List<String> = emptyList(),
    val moreName: List<String> = emptyList(),
)

interface DraftStore {
    fun load(): Draft?

    /** Null drops the draft. */
    fun save(draft: Draft?)
}

class MemoryDraft(private var draft: Draft? = null) : DraftStore {
    override fun load() = draft

    override fun save(draft: Draft?) {
        this.draft = draft
    }
}

class PrefsDraft(
    private val prefs: SharedPreferences,
    private val clock: () -> Long = System::currentTimeMillis,
) : DraftStore {
    override fun load(): Draft? {
        if (!prefs.contains(ARGUMENT)) return null
        // A draft with no time (from before drafts expired) counts as old.
        if (clock() - prefs.getLong(SAVED_AT, 0L) > MAX_AGE_MS) {
            save(null)
            return null
        }
        return Draft(
            argument = prefs.getString(ARGUMENT, "").orEmpty(),
            other = prefs.getString(OTHER, "").orEmpty(),
            otherName = prefs.getString(OTHER_NAME, "").orEmpty(),
            name = prefs.getString(NAME, null),
            theirsOpen = prefs.getBoolean(THEIRS_OPEN, false),
            moreText = split(prefs.getString(MORE_TEXT, null)),
            moreName = split(prefs.getString(MORE_NAME, null)),
        )
    }

    override fun save(draft: Draft?) {
        prefs.edit().clear().apply {
            if (draft != null) {
                putString(ARGUMENT, draft.argument)
                putString(OTHER, draft.other)
                putString(OTHER_NAME, draft.otherName)
                putString(NAME, draft.name)
                putBoolean(THEIRS_OPEN, draft.theirsOpen)
                putString(MORE_TEXT, join(draft.moreText))
                putString(MORE_NAME, join(draft.moreName))
                putLong(SAVED_AT, clock())
            }
        }.apply()
    }

    // The side's own text can hold any character but NUL. No key at all is no extra sides; an empty value is one empty side.
    private fun join(list: List<String>): String? = if (list.isEmpty()) null else list.joinToString(SEP)

    private fun split(joined: String?): List<String> = joined?.split(SEP).orEmpty()

    private companion object {
        const val SEP = "\u0000"
        const val MAX_AGE_MS = 24L * 60 * 60 * 1000
        const val SAVED_AT = "saved_at"
        const val ARGUMENT = "argument"
        const val OTHER = "other"
        const val OTHER_NAME = "other_name"
        const val NAME = "name"
        const val THEIRS_OPEN = "theirs_open"
        const val MORE_TEXT = "more_text"
        const val MORE_NAME = "more_name"
    }
}
