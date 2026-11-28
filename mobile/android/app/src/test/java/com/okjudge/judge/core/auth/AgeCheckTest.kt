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
    fun signals_onlyASharedAnswerCounts() {
        val shared = 1
        assertEquals(PlatformAge.ADULT, AgeCheck.fromSignals(shared, 18, null, 0))
        assertEquals(PlatformAge.MINOR, AgeCheck.fromSignals(shared, 13, 15, 0))
        assertEquals(PlatformAge.MINOR, AgeCheck.fromSignals(shared, 16, 17, 1))
        assertEquals(PlatformAge.UNDER13, AgeCheck.fromSignals(shared, 0, 12, 0))
        assertEquals("not shared", PlatformAge.UNKNOWN, AgeCheck.fromSignals(2, 18, null, 0))
        assertEquals("declining to share is not an answer", PlatformAge.UNKNOWN, AgeCheck.fromSignals(2, null, null, null))
        assertEquals("verification required", PlatformAge.UNKNOWN, AgeCheck.fromSignals(3, 18, null, 0))
        assertEquals("unspecified", PlatformAge.UNKNOWN, AgeCheck.fromSignals(0, 18, null, 0))
        assertEquals(PlatformAge.UNKNOWN, AgeCheck.fromSignals(null, 18, null, 0))
        assertEquals("shared without a usable range is an answer", PlatformAge.NO_SIGNAL, AgeCheck.fromSignals(shared, null, null, 0))
        assertEquals(PlatformAge.NO_SIGNAL, AgeCheck.fromSignals(shared, 15, 20, 0))
        assertNull("nothing to report", AgeCheck.report(PlatformAge.NO_SIGNAL, done))
        assertNull(AgeCheck.report(PlatformAge.UNKNOWN, done))
    }

    @Test
    fun signals_aMinorWithAPendingOrDeclinedChange_isHeld() {
        assertEquals(PlatformAge.MINOR_UNAPPROVED, AgeCheck.fromSignals(1, 13, 15, 2))
        assertEquals(PlatformAge.MINOR_UNAPPROVED, AgeCheck.fromSignals(1, 16, 17, 3))
        assertEquals("approved", PlatformAge.MINOR, AgeCheck.fromSignals(1, 16, 17, 1))
        assertEquals("unspecified", PlatformAge.MINOR, AgeCheck.fromSignals(1, 16, 17, 0))
        assertEquals("an adult has nothing to approve", PlatformAge.ADULT, AgeCheck.fromSignals(1, 18, null, 2))
        assertEquals("under 13 stays final", PlatformAge.UNDER13, AgeCheck.fromSignals(1, 0, 12, 3))
    }

    @Test
    fun heldMinor_isReportedAsAMinor_andGatesTheApp() {
        assertEquals(AgeCheck.Report(adult = false), AgeCheck.report(PlatformAge.MINOR_UNAPPROVED, done))
        assertEquals(AgeGate.APPROVAL, AgeCheck.gate(signedIn = true, age = done, platform = PlatformAge.MINOR_UNAPPROVED))
        assertEquals(AgeGate.NONE, AgeCheck.gate(signedIn = true, age = done, platform = PlatformAge.MINOR))
        assertEquals(AgeGate.NONE, AgeCheck.gate(signedIn = false, age = done, platform = PlatformAge.MINOR_UNAPPROVED))
        assertEquals("the date step comes first", AgeGate.DATE, AgeCheck.gate(true, needsDate, PlatformAge.MINOR_UNAPPROVED))
        assertEquals("a final block stays", AgeGate.BLOCKED, AgeCheck.gate(true, finalBlock, PlatformAge.MINOR_UNAPPROVED))
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
    fun usageStats_lockedForTeensBlockedAndUnknownAges() {
        assertFalse(AgeCheck.usageStatsLocked(null))
        assertFalse(AgeCheck.usageStatsLocked(done))
        assertTrue(AgeCheck.usageStatsLocked(done.copy(teen = true)))
        assertTrue(AgeCheck.usageStatsLocked(needsDate))
        assertTrue(AgeCheck.usageStatsLocked(finalBlock))
        assertEquals(true, AgeCheck.usageStatsOn(preference = true, locked = false))
        assertEquals(false, AgeCheck.usageStatsOn(preference = true, locked = true))
        assertEquals(false, AgeCheck.usageStatsOn(preference = false, locked = false))
        assertNull(AgeCheck.usageStatsOn(preference = true, locked = null))
        assertEquals(false, AgeCheck.usageStatsOn(preference = false, locked = null))
    }

    @Test
    fun consentCard_neverForATeen_evenWhenTheServerSaidAsk() {
        assertTrue(AgeCheck.showsConsentCard(ask = true, teen = false))
        assertFalse(AgeCheck.showsConsentCard(ask = true, teen = true))
        assertFalse(AgeCheck.showsConsentCard(ask = false, teen = false))
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

    @Test
    fun gate_regionRefusalAndParentStepComeBeforeTheDateStep() {
        assertEquals(AgeGate.RESTRICTED, AgeCheck.gate(true, AgeStatus(confirmed = true, restricted = true)))
        assertEquals(AgeGate.PARENT, AgeCheck.gate(true, AgeStatus(confirmed = true, teen = true, parent = "pending")))
        assertEquals(AgeGate.PARENT, AgeCheck.gate(true, AgeStatus(confirmed = true, teen = true, parent = "declined")))
        assertEquals(AgeGate.PARENT, AgeCheck.gate(true, AgeStatus(confirmed = true, teen = true, parent = "revoked")))
        // A final block outranks both; the region refusal outranks the parent step.
        assertEquals(AgeGate.BLOCKED, AgeCheck.gate(true, AgeStatus(blocked = true, restricted = true, parent = "pending")))
        assertEquals(AgeGate.RESTRICTED, AgeCheck.gate(true, AgeStatus(restricted = true, parent = "pending")))
        assertEquals(AgeGate.NONE, AgeCheck.gate(true, AgeStatus(confirmed = true, teen = true)))
    }

    @Test
    fun heldAccounts_lockUsageStats() {
        assertTrue(AgeCheck.usageStatsLocked(AgeStatus(restricted = true)))
        assertTrue(AgeCheck.usageStatsLocked(AgeStatus(parent = "pending")))
        assertFalse(AgeCheck.usageStatsLocked(done))
    }

    @Test
    fun ageState_decodesTheNewFieldsAndTheirAbsence() {
        val held = WireJson.json.decodeFromString(
            MeResponse.serializer(),
            """{"user":null,"age":{"confirmed":true,"blocked":false,"teen":true,"needsDob":false,"restricted":true,"parent":"pending"}}""",
        )
        assertTrue(held.age!!.restricted)
        assertEquals("pending", held.age.parent)
        val plain = WireJson.json.decodeFromString(MeResponse.serializer(), """{"user":null,"age":{"confirmed":true,"blocked":false,"teen":false,"needsDob":false}}""")
        assertFalse(plain.age!!.restricted)
        assertNull(plain.age.parent)
    }

    @Test
    fun theDateAsksWhereFor13To15_andQuebecFor13InCanada() {
        val now = at("2026-11-28T12:00:00Z")
        val thirteen = LocalDate.of(2013, 6, 1)
        val fifteen = LocalDate.of(2011, 6, 1)
        val sixteen = LocalDate.of(2010, 6, 1)
        val twelve = LocalDate.of(2014, 6, 1)
        assertTrue(AgeCheck.asksCountry(thirteen, now))
        assertTrue(AgeCheck.asksCountry(fifteen, now))
        assertFalse(AgeCheck.asksCountry(sixteen, now))
        assertFalse(AgeCheck.asksCountry(LocalDate.of(1990, 1, 1), now))
        assertFalse("under 13 is the refusal, not a question", AgeCheck.asksCountry(twelve, now))
        assertTrue(AgeCheck.asksQuebec(thirteen, "CA", now))
        assertFalse(AgeCheck.asksQuebec(thirteen, "US", now))
        assertFalse(AgeCheck.asksQuebec(thirteen, null, now))
        assertFalse("14 and 15 are not asked about Quebec", AgeCheck.asksQuebec(fifteen, "CA", now))
    }

    @Test
    fun regionAndParentRefusals_areAgeErrors() {
        for (code in listOf("age_region", "age_parent_pending")) {
            val err = JudgeApi.errorFor(403, """{"error":"x","code":"$code"}""", null) as UiError.Api
            assertEquals(code, err.code)
            assertTrue(AgeCheck.isAgeError(err))
        }
    }
}
