package com.okjudge.judge.core.display

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.okjudge.judge.i18n.AppLang
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** The pick rule against mobile/shared/fixtures/example-vectors.json, and the bundled example files. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class ExamplesTest {
    private val vectors: JsonObject by lazy {
        val stream = ExamplesTest::class.java.classLoader!!.getResourceAsStream("example-vectors.json")
            ?: error("example-vectors.json not on the test classpath (mobile/shared/fixtures)")
        Json.parseToJsonElement(stream.bufferedReader(Charsets.UTF_8).readText()).jsonObject
    }

    private fun strings(key: String, o: JsonObject) = o[key]!!.jsonArray.map { it.jsonPrimitive.content }

    private fun check(o: JsonObject, ids: List<String>) {
        val pick = Examples.next(ids, strings("seen", o), o["random"]!!.jsonPrimitive.double)!!
        assertEquals("$o", o["id"]!!.jsonPrimitive.content, pick.id)
        assertEquals("$o", strings("seenAfter", o), pick.seen)
    }

    @Test
    fun pick_matchesTheGoldenVectors() {
        val ids = strings("ids", vectors)
        for (case in vectors["cases"]!!.jsonArray) check(case.jsonObject, ids)
        val single = vectors["single"]!!.jsonObject
        check(single, strings("ids", single))
    }

    @Test
    fun pick_withNoExamples_picksNothing() {
        assertNull(Examples.next(emptyList(), emptyList(), 0.5))
    }

    private fun book(): ExampleBook {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val prefs = context.getSharedPreferences("examples-test", Context.MODE_PRIVATE).also { it.edit().clear().commit() }
        return ExampleBook(context.assets, prefs)
    }

    @Test
    fun everyLanguageHasTheSameExamples_withBothNamesAndBothSides() {
        val book = book()
        val english = book.load(AppLang.EN)
        assertEquals(150, english.size)
        for (lang in AppLang.entries) {
            val list = book.load(lang)
            assertEquals("${lang.tag} ids", english.map { it.id }, list.map { it.id })
            for (e in list) {
                assertTrue("${lang.tag} ${e.id}", listOf(e.title, e.aName, e.a, e.bName, e.b).all { it.isNotBlank() })
            }
        }
    }

    @Test
    fun next_showsEveryExampleOncePerRound_andRemembersWhatItShowed() {
        val book = book()
        val random = kotlin.random.Random(3)
        val round = List(150) { book.next(AppLang.EN, random.nextDouble())!!.id }
        assertEquals(150, round.toSet().size)
        val again = book.next(AppLang.EN, random.nextDouble())!!.id
        assertNotEquals("a new round never opens with the last one", round.last(), again)
        // A second book on the same preferences carries on from the same round.
        val next = book.next(AppLang.EN, 0.0)!!.id
        assertNotEquals(again, next)
    }

    @Test
    fun next_inAnotherLanguage_sharesTheRound() {
        val book = book()
        val en = book.next(AppLang.EN, 0.0)!!
        val tr = book.next(AppLang.TR, 0.0)!!
        assertNotEquals(en.id, tr.id)
    }
}
