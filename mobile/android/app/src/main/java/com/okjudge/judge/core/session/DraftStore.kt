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

class PrefsDraft(private val prefs: SharedPreferences) : DraftStore {
    override fun load(): Draft? {
        if (!prefs.contains(ARGUMENT)) return null
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
                putString(MORE_TEXT, draft.moreText.joinToString(SEP))
                putString(MORE_NAME, draft.moreName.joinToString(SEP))
            }
        }.apply()
    }

    // The side's own text can hold any character but NUL.
    private fun split(joined: String?): List<String> = if (joined.isNullOrEmpty()) emptyList() else joined.split(SEP)

    private companion object {
        const val SEP = "\u0000"
        const val ARGUMENT = "argument"
        const val OTHER = "other"
        const val OTHER_NAME = "other_name"
        const val NAME = "name"
        const val THEIRS_OPEN = "theirs_open"
        const val MORE_TEXT = "more_text"
        const val MORE_NAME = "more_name"
    }
}
