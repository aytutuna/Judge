package com.okjudge.judge.core.display

import android.content.SharedPreferences
import android.content.res.AssetManager
import com.okjudge.judge.i18n.AppLang
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json
import kotlin.math.min

/**
 * "Try an example": both names and both sides of a made-up argument. Each language has one
 * assets/examples/<tag>.json (made by mobile/shared/examples, the same ids in the same order in
 * all of them); the pick rule is lib/example-pick.ts.
 */
object Examples {
    @Serializable
    data class Example(val id: String, val title: String, val aName: String, val a: String, val bName: String, val b: String)

    data class Pick(val id: String, val seen: List<String>)

    /**
     * [seen] lists the ids shown in the current round, oldest first; its last entry is the example
     * on screen. Unseen ids are picked at random until all have been shown, then a new round starts
     * that never opens with the one just shown. [random] is in [0, 1).
     */
    fun next(ids: List<String>, seen: List<String>, random: Double): Pick? {
        if (ids.isEmpty()) return null
        val known = seen.filter { it in ids }
        val last = known.lastOrNull()
        val unseen = ids.filter { it !in known }
        val fresh = unseen.isEmpty()
        val pool = (if (fresh) ids else unseen).filter { it != last || ids.size == 1 }
        val id = pool[min((random * pool.size).toInt(), pool.size - 1)]
        return Pick(id, if (fresh) listOf(id) else known + id)
    }
}

/** The bundled examples, and which of them this phone has shown. */
class ExampleBook(private val assets: AssetManager, private val prefs: SharedPreferences) {
    private val json = Json { ignoreUnknownKeys = true }
    private val list = ListSerializer(Examples.Example.serializer())
    private val ids = ListSerializer(String.serializer())

    /** The language's examples, else English; empty when neither can be read. */
    fun load(lang: AppLang): List<Examples.Example> {
        for (tag in listOf(lang.tag, AppLang.EN.tag)) {
            val read = runCatching {
                assets.open("examples/$tag.json").use { json.decodeFromString(list, it.readBytes().decodeToString()) }
            }.getOrNull()
            if (!read.isNullOrEmpty()) return read
        }
        return emptyList()
    }

    /** The next example this phone has not shown in the current round; remembers it. */
    fun next(lang: AppLang, random: Double): Examples.Example? {
        val examples = load(lang)
        val seen = prefs.getString(SEEN, null)?.let { runCatching { json.decodeFromString(ids, it) }.getOrNull() }.orEmpty()
        val pick = Examples.next(examples.map { it.id }, seen, random) ?: return null
        prefs.edit().putString(SEEN, json.encodeToString(ids, pick.seen)).apply()
        return examples.first { it.id == pick.id }
    }

    companion object {
        const val SEEN = "judge-examples-seen"
        const val FILE = "examples"
    }
}
