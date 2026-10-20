package com.okjudge.judge.core.display

import com.okjudge.judge.core.model.FactSource
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

/**
 * Ports of `safeSource` and `shownSources` (components/FactCheckList.tsx):
 * only http(s) links are rendered, shown by their domain, de-duplicated and
 * capped at three per claim. Anything else (javascript:, file:, content:,
 * relative, garbage) is dropped.
 */
object FactSources {
    /** Most sources shown per claim (the server caps it too). */
    const val MAX_SOURCES = 3

    data class Shown(val title: String, val href: String, val domain: String)

    /** The normalized href and its domain (host without `www.`), or null. */
    fun safe(url: String): Pair<String, String>? {
        val parsed = url.toHttpUrlOrNull() ?: return null
        return parsed.toString() to parsed.host.removePrefix("www.")
    }

    fun shown(sources: List<FactSource>): List<Shown> {
        val out = ArrayList<Shown>(MAX_SOURCES)
        for (source in sources) {
            val (href, domain) = safe(source.url) ?: continue
            if (out.any { it.href == href }) continue
            out += Shown(title = source.title.trim().ifEmpty { domain }, href = href, domain = domain)
            if (out.size == MAX_SOURCES) break
        }
        return out
    }
}
