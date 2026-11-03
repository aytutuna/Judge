package com.okjudge.judge.core.auth

import com.okjudge.judge.core.api.JudgeApi
import com.okjudge.judge.core.display.UiError
import com.okjudge.judge.core.model.AgeStatus
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AgeCheckTest {
    private val unconfirmed = AgeStatus(confirmed = false, blocked = false)
    private val confirmed = AgeStatus(confirmed = true, blocked = false)
    private val blocked = AgeStatus(confirmed = false, blocked = true)

    @Test
    fun playRanges_minorAdultOrUnknown() {
        // Supervised and declared bands below 18 (Play's defaults: 0-12, 13-15, 16-17).
        assertEquals(PlatformAge.MINOR, AgeCheck.fromRange(0, 12))
        assertEquals(PlatformAge.MINOR, AgeCheck.fromRange(13, 15))
        assertEquals(PlatformAge.MINOR, AgeCheck.fromRange(16, 17))
        // 18+ is the top band: no upper bound.
        assertEquals(PlatformAge.ADULT, AgeCheck.fromRange(18, null))
        assertEquals(PlatformAge.ADULT, AgeCheck.fromRange(21, null))
        // Not shared, or a custom band that straddles 18.
        assertEquals(PlatformAge.UNKNOWN, AgeCheck.fromRange(null, null))
        assertEquals(PlatformAge.UNKNOWN, AgeCheck.fromRange(16, null))
        assertEquals(PlatformAge.UNKNOWN, AgeCheck.fromRange(15, 20))
    }

    @Test
    fun report_platformUnder18_isSentEvenForAConfirmedAccount() {
        assertEquals(AgeCheck.Report(adult = false, source = "platform"), AgeCheck.report(PlatformAge.MINOR, unconfirmed, ticked = true))
        assertEquals(AgeCheck.Report(adult = false, source = "platform"), AgeCheck.report(PlatformAge.MINOR, confirmed, ticked = false))
        // Already blocked: nothing more to say.
        assertNull(AgeCheck.report(PlatformAge.MINOR, blocked, ticked = false))
    }

    @Test
    fun report_platformAdult_beatsTheCheckbox() {
        assertEquals(AgeCheck.Report(adult = true, source = "platform"), AgeCheck.report(PlatformAge.ADULT, unconfirmed, ticked = true))
        assertEquals(AgeCheck.Report(adult = true, source = "platform"), AgeCheck.report(PlatformAge.ADULT, unconfirmed, ticked = false))
        assertNull(AgeCheck.report(PlatformAge.ADULT, confirmed, ticked = false))
    }

    @Test
    fun report_unknownPlatform_fallsBackToTheCheckbox() {
        assertEquals(AgeCheck.Report(adult = true, source = "checkbox"), AgeCheck.report(PlatformAge.UNKNOWN, unconfirmed, ticked = true))
        assertEquals(AgeCheck.Report(adult = true, source = "checkbox"), AgeCheck.report(null, unconfirmed, ticked = true))
        assertNull(AgeCheck.report(PlatformAge.UNKNOWN, unconfirmed, ticked = false))
        assertNull(AgeCheck.report(PlatformAge.UNKNOWN, confirmed, ticked = true))
    }

    @Test
    fun report_serverWithoutTheAgeCheck_isNeverSent() {
        assertNull(AgeCheck.report(PlatformAge.MINOR, null, ticked = true))
        assertNull(AgeCheck.report(PlatformAge.ADULT, null, ticked = true))
    }

    @Test
    fun gate() {
        assertEquals(AgeGate.BLOCKED, AgeCheck.gate(PlatformAge.MINOR, signedIn = false, age = null, posting = false))
        assertEquals(AgeGate.BLOCKED, AgeCheck.gate(PlatformAge.MINOR, signedIn = true, age = confirmed, posting = false))
        assertEquals(AgeGate.BLOCKED, AgeCheck.gate(PlatformAge.ADULT, signedIn = true, age = blocked, posting = false))
        assertEquals(AgeGate.CONFIRM, AgeCheck.gate(PlatformAge.UNKNOWN, signedIn = true, age = unconfirmed, posting = false))
        // Waits for the phone and for a report in flight.
        assertEquals(AgeGate.NONE, AgeCheck.gate(null, signedIn = true, age = unconfirmed, posting = false))
        assertEquals(AgeGate.NONE, AgeCheck.gate(PlatformAge.ADULT, signedIn = true, age = unconfirmed, posting = true))
        assertEquals(AgeGate.NONE, AgeCheck.gate(PlatformAge.UNKNOWN, signedIn = true, age = confirmed, posting = false))
        assertEquals(AgeGate.NONE, AgeCheck.gate(PlatformAge.UNKNOWN, signedIn = true, age = null, posting = false))
        assertEquals(AgeGate.NONE, AgeCheck.gate(PlatformAge.UNKNOWN, signedIn = false, age = null, posting = false))
    }

    @Test
    fun checkbox_hiddenOnlyWhenThePhoneSaid18Plus() {
        assertFalse(AgeCheck.needsCheckbox(PlatformAge.ADULT))
        assertTrue(AgeCheck.needsCheckbox(PlatformAge.UNKNOWN))
        assertTrue(AgeCheck.needsCheckbox(null))
        assertEquals("platform", AgeCheck.confirmation(PlatformAge.ADULT).source)
        assertEquals("checkbox", AgeCheck.confirmation(PlatformAge.UNKNOWN).source)
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
