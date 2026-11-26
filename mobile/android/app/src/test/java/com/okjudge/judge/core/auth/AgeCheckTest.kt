package com.okjudge.judge.core.auth

import com.okjudge.judge.core.api.JudgeApi
import com.okjudge.judge.core.display.UiError
import com.okjudge.judge.core.model.AgeStatus
import com.okjudge.judge.core.model.MeResponse
import com.okjudge.judge.core.model.WireJson
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.time.LocalDate

class AgeCheckTest {
    private val needsDate = AgeStatus(confirmed = false, blocked = false, needsDob = true)
    private val done = AgeStatus(confirmed = true)
    private val finalBlock = AgeStatus(blocked = true)
    private val oldBlock = AgeStatus(blocked = true, needsDob = true)

    private fun at(iso: String) = Instant.parse(iso).toEpochMilli()

    @Test
    fun playRanges_underThirteenMinorAdultOrUnknown() {
        assertEquals(PlatformAge.UNDER13, AgeCheck.fromRange(0, 12))
        assertEquals(PlatformAge.MINOR, AgeCheck.fromRange(13, 15))
        assertEquals(PlatformAge.MINOR, AgeCheck.fromRange(16, 17))
        assertEquals(PlatformAge.ADULT, AgeCheck.fromRange(18, null))
        assertEquals(PlatformAge.ADULT, AgeCheck.fromRange(21, null))
        assertEquals(PlatformAge.UNKNOWN, AgeCheck.fromRange(null, null))
        assertEquals(PlatformAge.UNKNOWN, AgeCheck.fromRange(16, null))
        assertEquals(PlatformAge.UNKNOWN, AgeCheck.fromRange(15, 20))
    }

    @Test
    fun report_mapsTheStoreAnswer() {
        assertEquals(AgeCheck.Report(adult = true), AgeCheck.report(PlatformAge.ADULT, needsDate))
        assertEquals(AgeCheck.Report(adult = false), AgeCheck.report(PlatformAge.MINOR, needsDate))
        assertEquals(AgeCheck.Report(adult = false, under13 = true), AgeCheck.report(PlatformAge.UNDER13, needsDate))
        assertNull(AgeCheck.report(PlatformAge.UNKNOWN, needsDate))
        assertNull(AgeCheck.report(null, needsDate))
    }

    @Test
    fun report_isSentForAConfirmedAccountToo() {
        assertEquals(AgeCheck.Report(adult = true), AgeCheck.report(PlatformAge.ADULT, done))
        assertEquals(AgeCheck.Report(adult = false), AgeCheck.report(PlatformAge.MINOR, done.copy(teen = true)))
    }

    @Test
    fun report_notAfterAFinalBlock_orForAServerWithoutTheCheck() {
        assertNull(AgeCheck.report(PlatformAge.ADULT, finalBlock))
        assertNull(AgeCheck.report(PlatformAge.MINOR, null))
        // An old 18+ block still takes a date, so it still takes the signal.
        assertEquals(AgeCheck.Report(adult = true), AgeCheck.report(PlatformAge.ADULT, oldBlock))
    }

    @Test
    fun gate_followsTheServerState() {
        assertEquals(AgeGate.NONE, AgeCheck.gate(signedIn = false, age = needsDate))
        assertEquals(AgeGate.NONE, AgeCheck.gate(signedIn = true, age = null))
        assertEquals(AgeGate.DATE, AgeCheck.gate(signedIn = true, age = needsDate))
        assertEquals(AgeGate.DATE, AgeCheck.gate(signedIn = true, age = oldBlock))
        assertEquals(AgeGate.BLOCKED, AgeCheck.gate(signedIn = true, age = finalBlock))
        assertEquals(AgeGate.NONE, AgeCheck.gate(signedIn = true, age = done))
        assertEquals(AgeGate.NONE, AgeCheck.gate(signedIn = true, age = done.copy(teen = true)))
    }

    @Test
    fun ageState_decodesNewAndOldServers() {
        val full = WireJson.json.decodeFromString(
            MeResponse.serializer(),
            """{"user":null,"entitlement":null,"age":{"confirmed":true,"blocked":false,"teen":true,"needsDob":false}}""",
        )
        assertEquals(AgeStatus(confirmed = true, teen = true), full.age)
        val old = WireJson.json.decodeFromString(MeResponse.serializer(), """{"user":null,"age":{"confirmed":false,"blocked":true}}""")
        assertEquals(AgeStatus(blocked = true), old.age)
    }

    @Test
    fun underThirteen_boundary() {
        // 10:00 UTC is already the 26th at UTC+14.
        val now = at("2026-11-25T10:00:00Z")
        assertEquals(LocalDate.of(2026, 11, 26), AgeCheck.latestDate(now))
        assertFalse(AgeCheck.underThirteen(LocalDate.of(2013, 11, 26), now))
        assertTrue(AgeCheck.underThirteen(LocalDate.of(2013, 11, 27), now))
        // One second before, the latest date is still the 25th.
        val before = at("2026-11-25T09:59:59Z")
        assertEquals(LocalDate.of(2026, 11, 25), AgeCheck.latestDate(before))
        assertTrue(AgeCheck.underThirteen(LocalDate.of(2013, 11, 26), before))
        assertFalse(AgeCheck.underThirteen(LocalDate.of(2013, 11, 25), before))
    }

    @Test
    fun underThirteen_onTheLeapDay() {
        val now = at("2028-02-29T00:00:00Z")
        assertFalse(AgeCheck.underThirteen(LocalDate.of(2015, 2, 28), now))
        assertTrue(AgeCheck.underThirteen(LocalDate.of(2015, 3, 1), now))
        // Born on a leap day: still under on 28 February of a common year, 13 on 1 March (the web's rule).
        val common = at("2029-02-28T00:00:00Z")
        assertTrue(AgeCheck.underThirteen(LocalDate.of(2016, 2, 29), common))
        assertFalse(AgeCheck.underThirteen(LocalDate.of(2016, 2, 28), common))
        assertFalse(AgeCheck.underThirteen(LocalDate.of(2016, 2, 29), at("2029-03-01T00:00:00Z")))
        assertFalse(AgeCheck.underThirteen(LocalDate.of(1990, 1, 1), now))
    }

    @Test
    fun serverErrors_asCodeOrBareError() {
        val bare = JudgeApi.errorFor(403, """{"error":"age_blocked"}""", null) as UiError.Api
        assertEquals("age_blocked", bare.code)
        val coded = JudgeApi.errorFor(403, """{"error":"Confirm your age first","code":"age_unconfirmed"}""", null) as UiError.Api
        assertEquals("age_unconfirmed", coded.code)
        assertTrue(AgeCheck.isAgeError(bare))
        assertTrue(AgeCheck.isAgeError(coded))
        // Other 403s keep their own codes.
        val other = JudgeApi.errorFor(403, """{"error":"Not your case","code":"not_party"}""", null) as UiError.Api
        assertEquals("not_party", other.code)
        assertFalse(AgeCheck.isAgeError(other))
        assertNull(AgeCheck.errorCode(400, null, "age_blocked"))
    }
}
