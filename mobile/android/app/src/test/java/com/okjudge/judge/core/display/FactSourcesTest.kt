package com.okjudge.judge.core.display

import com.okjudge.judge.core.model.FactSource
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class FactSourcesTest {
    @Test
    fun safe_keepsOnlyHttpAndHttps() {
        assertEquals("https://www.bbc.co.uk/news" to "bbc.co.uk", FactSources.safe("https://www.bbc.co.uk/news"))
        assertEquals("http://example.org/" to "example.org", FactSources.safe("http://Example.org"))
        for (bad in listOf(
            "javascript:alert(1)",
            "file:///data/data/com.okjudge.judge/databases/history.db",
            "content://com.okjudge.judge.provider/x",
            "intent://scan/#Intent;scheme=zxing;end",
            "data:text/html,hi",
            "/relative/path",
            "www.example.org",
            "",
        )) {
            assertNull(bad, FactSources.safe(bad))
        }
    }

    @Test
    fun shown_dropsUnsafeAndDuplicates_capsAtThree_andFallsBackToTheDomain() {
        val shown = FactSources.shown(
            listOf(
                FactSource("Evil", "javascript:alert(1)"),
                FactSource("  ", "https://www.a.com/x"),
                FactSource("A again", "https://www.a.com/x"),
                FactSource("B", "https://b.com/"),
                FactSource("C", "http://c.com/page"),
                FactSource("D", "https://d.com/"),
            ),
        )
        assertEquals(listOf("a.com", "b.com", "c.com"), shown.map { it.domain })
        assertEquals("a.com", shown[0].title)
        assertEquals("B", shown[1].title)
        assertEquals("https://www.a.com/x", shown[0].href)
    }
}
