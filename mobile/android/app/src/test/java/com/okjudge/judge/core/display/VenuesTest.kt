package com.okjudge.judge.core.display

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.okjudge.judge.Fixtures
import com.okjudge.judge.core.model.CaseSummary
import com.okjudge.judge.core.model.CaseView
import com.okjudge.judge.core.model.VerdictRequest
import com.okjudge.judge.core.model.WireJson
import com.okjudge.judge.core.model.decodeHistoryPage
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** The pick rule against mobile/shared/fixtures/venue-vectors.json, the bundled list, and the venue on the wire. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class VenuesTest {
    private val vectors: JsonObject by lazy {
        val stream = VenuesTest::class.java.classLoader!!.getResourceAsStream("venue-vectors.json")
            ?: error("venue-vectors.json not on the test classpath (mobile/shared/fixtures)")
        Json.parseToJsonElement(stream.bufferedReader(Charsets.UTF_8).readText()).jsonObject
    }

    private fun strings(o: JsonObject) = o["ids"]!!.jsonArray.map { it.jsonPrimitive.content }

    private fun check(ids: List<String>, o: JsonObject) {
        val last = o["last"]?.jsonPrimitive?.takeIf { it.isString }?.content
        assertEquals("$o", o["id"]!!.jsonPrimitive.content, Venues.pick(ids, last, o["random"]!!.jsonPrimitive.double))
    }

    @Test
    fun pick_matchesTheGoldenVectors() {
        val ids = strings(vectors)
        for (case in vectors["cases"]!!.jsonArray) check(ids, case.jsonObject)
        val single = vectors["single"]!!.jsonObject
        check(strings(single), single)
    }

    @Test
    fun pick_withNoVenues_isTheCourt() {
        assertEquals("court", Venues.pick(emptyList(), null, 0.5))
    }

    private fun book(): VenueBook {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val prefs = context.getSharedPreferences("venues-test", Context.MODE_PRIVATE).also { it.edit().clear().commit() }
        return VenueBook(context.assets, prefs)
    }

    @Test
    fun theBundledListIsTheSharedOne() {
        assertEquals(strings(vectors), book().load())
    }

    @Test
    fun aPickIsRememberedAndNeverRepeats() {
        val book = book()
        assertEquals("court", book.pickNew(random = 0.0))
        assertEquals("beach", book.pickNew(random = 0.0))
        val context = ApplicationProvider.getApplicationContext<Context>()
        assertEquals("beach", context.getSharedPreferences("venues-test", Context.MODE_PRIVATE).getString("judge-venue-last", null))
    }

    @Test
    fun theCourtSceneCarriesTheVenue() {
        assertEquals("""{"kind":"home","venue":"ice","busy":false}""", CourtScene.Home(false, "ice").json())
        assertEquals(
            """{"kind":"judging","venue":"farm","beat":"bothSides","votes":[],"extra":0,"winner":null,"trial":null}""",
            CourtScene.Judging(Story.Beat.BOTH_SIDES, null, venue = "farm").json(),
        )
    }

    @Test
    fun theRequestsLeaveTheVenueOutUnlessSet() {
        assertFalse("venue" in WireJson.json.encodeToString(VerdictRequest.serializer(), VerdictRequest("x")))
        val sent = WireJson.json.encodeToString(VerdictRequest.serializer(), VerdictRequest("x", venue = "farm"))
        assertEquals("farm", Json.parseToJsonElement(sent).jsonObject["venue"]!!.jsonPrimitive.content)
    }

    @Test
    fun responsesDecodeTheVenue() {
        assertEquals("beach", Fixtures.sample("win_b_named").venue)
        assertNull(Fixtures.sample("win_a_self").venue)
        assertEquals("beach", WireJson.decodeStoredVerdict(Fixtures.verdicts["storedVerdictResponse"].toString()).venue)

        val page = decodeHistoryPage(Fixtures.verdicts["history"].toString())
        assertEquals("museum", page.items.first { it.id == "verdict0021" }.venue)
        assertEquals("camp", page.items.first { it.id == "case0000012" }.venue)
        assertNull(page.items.first().venue)

        val cases = Fixtures.verdicts["cases"]!!.jsonObject
        val judged = WireJson.json.decodeFromString(CaseView.serializer(), cases["views"]!!.jsonObject["judged"].toString())
        assertEquals("library", judged.venue)
        val list = cases["list"]!!.jsonObject["cases"]!!.jsonArray.map { WireJson.json.decodeFromJsonElement(CaseSummary.serializer(), it) }
        assertEquals("library", list[1].venue)
        assertNull(list[0].venue)
    }
}
