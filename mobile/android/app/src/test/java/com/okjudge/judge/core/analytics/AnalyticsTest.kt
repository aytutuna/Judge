package com.okjudge.judge.core.analytics

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

@OptIn(ExperimentalCoroutinesApi::class)
class AnalyticsTest {
    @get:Rule
    val tmp = TemporaryFolder()

    private val context = AnalyticsContext(
        appVersion = "0.1.0_1",
        anonId = "0b0e4a8e-4d55-4c6a-9e3a-2f6f0a1c9d11",
        deviceId = "3f2a9c1d0e4b5a68",
        osVersion = "15",
        deviceModel = "Pixel_8",
        locale = "en-US",
    )

    /** Records each body and answers with [answer]. */
    private class Stub(var answer: Delivery = Delivery.SENT) : AnalyticsTransport {
        val bodies = mutableListOf<JsonObject>()
        override suspend fun send(body: String): Delivery {
            bodies += Json.parseToJsonElement(body).jsonObject
            return answer
        }

        val sizes get() = bodies.map { it["events"]!!.jsonArray.size }
    }

    private var clock = 1_800_000_000_000L

    private fun TestScope.analytics(stub: Stub, file: File? = null, allowed: Boolean? = true) =
        Analytics(stub, context, file, backgroundScope, io = UnconfinedTestDispatcher(testScheduler), now = { clock }, log = {})
            .also { it.allowed = allowed }

    @Test
    fun events_waitForTheServerSwitch() = runTest {
        val stub = Stub()
        val a = analytics(stub)
        a.track("app_open")
        a.track("screen_view", mapOf("screen" to "home"))
        a.flush()
        assertTrue(stub.bodies.isEmpty())

        a.setServerOn(true)
        runCurrent()
        assertEquals(listOf(2), stub.sizes)
        assertTrue(a.queue.isEmpty())
    }

    @Test
    fun body_matchesTheEventsRoute() = runTest {
        val stub = Stub()
        val a = analytics(stub)
        a.setServerOn(true)
        a.track("buy_tapped", mapOf("product" to "pack_10"))
        a.track("case_submitted")
        a.flush()

        val body = stub.bodies.single()
        assertEquals(setOf("context", "events"), body.keys)
        val ctx = body["context"]!!.jsonObject.mapValues { it.value.jsonPrimitive.content }
        assertEquals(
            mapOf(
                "platform" to "android", "app_version" to "0.1.0_1", "anon_id" to "0b0e4a8e-4d55-4c6a-9e3a-2f6f0a1c9d11",
                "device_id" to "3f2a9c1d0e4b5a68", "os_version" to "15", "device_model" to "Pixel_8", "locale" to "en-US",
            ),
            ctx,
        )
        val events = body["events"]!!.jsonArray.map { it.jsonObject }
        assertEquals(setOf("name", "at", "props"), events[0].keys)
        assertEquals("buy_tapped", events[0]["name"]!!.jsonPrimitive.content)
        assertEquals(clock, events[0]["at"]!!.jsonPrimitive.content.toLong())
        assertEquals("pack_10", events[0]["props"]!!.jsonObject["product"]!!.jsonPrimitive.content)
        // An event without props sends none.
        assertEquals(setOf("name", "at"), events[1].keys)
    }

    @Test
    fun batches_holdAtMostFifty() = runTest {
        val stub = Stub()
        val a = analytics(stub)
        repeat(120) { a.track("evidence_added") }
        a.setServerOn(true)
        runCurrent()
        assertEquals(listOf(50, 50, 20), stub.sizes)
        assertTrue(a.queue.isEmpty())
    }

    @Test
    fun twentyQueuedEvents_sendThemselves() = runTest {
        val stub = Stub()
        val a = analytics(stub)
        a.setServerOn(true)
        runCurrent()
        repeat(19) { a.track("question_answered") }
        runCurrent()
        assertTrue(stub.bodies.isEmpty())
        a.track("question_answered")
        runCurrent()
        assertEquals(listOf(20), stub.sizes)
    }

    @Test
    fun queue_keepsTheNewestFiveHundred() = runTest {
        val a = analytics(Stub())
        repeat(510) { a.track("screen_view", mapOf("screen" to "s$it")) }
        assertEquals(Analytics.CAP, a.queue.size)
        assertEquals("s10", a.queue.first().props?.get("screen"))
        assertEquals("s509", a.queue.last().props?.get("screen"))
    }

    @Test
    fun refusedBatch_isDropped() = runTest {
        val stub = Stub(Delivery.REJECTED)
        val a = analytics(stub)
        a.setServerOn(true)
        a.track("share_tapped")
        a.flush()
        assertEquals(1, stub.bodies.size)
        assertTrue(a.queue.isEmpty())
        assertNull(a.retryAt)
    }

    @Test
    fun failedSend_keepsTheEvents_andBacksOff() = runTest {
        val stub = Stub(Delivery.FAILED)
        val a = analytics(stub)
        a.setServerOn(true)
        a.track("verdict_viewed")
        a.flush()
        assertEquals(1, stub.bodies.size)
        assertEquals(1, a.queue.size)
        assertEquals(clock + 60_000, a.retryAt)

        // Not again within the minute.
        clock += 30_000
        a.flush()
        assertEquals(1, stub.bodies.size)

        clock += 31_000
        a.flush()
        assertEquals(2, stub.bodies.size)
        assertEquals(clock + 120_000, a.retryAt)

        stub.answer = Delivery.SENT
        clock += 121_000
        a.flush()
        assertTrue(a.queue.isEmpty())
        assertNull(a.retryAt)
    }

    @Test
    fun queue_survivesARestart() = runTest {
        val file = File(tmp.root, "queue.json")
        val first = analytics(Stub(), file)
        first.track("app_open")
        first.track("screen_view", mapOf("screen" to "settings"))
        assertTrue(file.exists())

        val again = analytics(Stub(), file, allowed = null)
        // Tracked before the setting was read: memory only, then joined to the saved ones.
        again.track("case_started")
        again.allowed = true
        assertEquals(listOf("app_open", "screen_view", "case_started"), again.queue.map { it.name })
        assertEquals(listOf(1L, 2L, 3L), again.queue.map { it.seq })
    }

    @Test
    fun unreadSetting_neverWritesOrSends() = runTest {
        val file = File(tmp.root, "queue.json")
        val stub = Stub()
        val a = analytics(stub, file, allowed = null)
        a.setServerOn(true)
        a.track("app_open")
        a.flush()
        assertFalse(file.exists())
        assertTrue(stub.bodies.isEmpty())

        a.allowed = false
        assertTrue(a.queue.isEmpty())
    }

    @Test
    fun serverOff_beforeTheSettingIsRead_dropsTheSavedQueue() = runTest {
        val file = File(tmp.root, "queue.json")
        analytics(Stub(), file).track("app_open")
        assertTrue(file.exists())

        val again = analytics(Stub(), file, allowed = null)
        again.setServerOn(false)
        again.allowed = true
        assertTrue(again.queue.isEmpty())
        assertFalse(file.exists())
    }

    @Test
    fun settingOff_clearsTheQueueAndTheFile() = runTest {
        val file = File(tmp.root, "queue.json")
        val stub = Stub()
        val a = analytics(stub, file)
        a.track("app_open")
        assertTrue(file.exists())

        a.allowed = false
        assertTrue(a.queue.isEmpty())
        assertFalse(file.exists())
        a.track("app_open")
        a.setServerOn(true)
        runCurrent()
        assertTrue(a.queue.isEmpty())
        assertTrue(stub.bodies.isEmpty())
    }

    @Test
    fun serverOff_dropsTheQueue() = runTest {
        val a = analytics(Stub())
        a.track("app_open")
        a.setServerOn(false)
        assertTrue(a.queue.isEmpty())
        a.track("app_open")
        assertTrue(a.queue.isEmpty())
    }

    @Test
    fun appOpen_onLaunchAndAfterHalfAnHourAway() = runTest {
        val a = analytics(Stub())
        a.becameActive()
        a.enteredBackground()
        clock += 10 * 60_000
        a.becameActive()
        assertEquals(listOf("app_open"), a.queue.map { it.name })

        a.enteredBackground()
        clock += 31 * 60_000
        a.becameActive()
        a.enteredBackground()
        assertEquals(listOf("app_open", "app_open"), a.queue.map { it.name })
    }

    @Test
    fun onlyTheListedProps_andTokenValues_pass() {
        assertNull(Analytics.problem("screen_view", mapOf("screen" to "case_detail")))
        assertNull(Analytics.problem("error_shown", mapOf("code" to "INVALID_OTP")))
        assertNull(Analytics.problem("case_submitted", emptyMap()))
        assertNotNull(Analytics.problem("case_submitted", mapOf("screen" to "home")))
        assertNotNull(Analytics.problem("screen_view", mapOf("name" to "home")))
        assertNotNull(Analytics.problem("screen_view", mapOf("screen" to "two words")))
        assertNotNull(Analytics.problem("screen_view", mapOf("screen" to "ann@example.com")))
        assertNotNull(Analytics.problem("screen_view", mapOf("screen" to "")))
        assertNotNull(Analytics.problem("screen_view", mapOf("screen" to "a".repeat(65))))
        assertNotNull(Analytics.problem("sign_in", emptyMap()))
        assertNotNull(Analytics.problem("Screen View", emptyMap()))
    }

    @Test
    fun aBadEvent_failsInDebugBuilds() = runTest {
        val a = analytics(Stub())
        assertThrows(IllegalStateException::class.java) { a.track("share_tapped", mapOf("message" to "hi")) }
        assertTrue(a.queue.isEmpty())
    }
}
