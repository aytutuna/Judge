package com.okjudge.judge.core.premium

import com.okjudge.judge.Fixtures
import com.okjudge.judge.core.display.Errors
import com.okjudge.judge.core.model.Entitlement
import com.okjudge.judge.core.model.MeResponse
import com.okjudge.judge.core.model.PricingInfo
import com.okjudge.judge.core.model.ServerConfig
import com.okjudge.judge.core.model.WireJson
import com.okjudge.judge.i18n.AppLang
import com.okjudge.judge.ui.UiTestSupport
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.time.ZoneOffset
import java.util.TimeZone

/** lib/tier.ts, the tier note, prices and the new error codes, against the fixtures. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class TierTest {
    private val en = UiTestSupport.s(AppLang.EN)
    private val tr = UiTestSupport.s(AppLang.TR)

    private fun config(name: String): ServerConfig =
        WireJson.json.decodeFromString(ServerConfig.serializer(), Fixtures.verdicts["config"]!!.jsonObject[name].toString())

    private fun me(name: String): MeResponse =
        WireJson.json.decodeFromString(MeResponse.serializer(), Fixtures.verdicts["me"]!!.jsonObject[name].toString())

    private fun availability(config: ServerConfig?, me: MeResponse) =
        Tiers.availability(config, signedIn = me.user != null, entitlement = me.entitlement)

    @Test
    fun availability_followsConfigAndEntitlement() {
        val full = config("full")
        assertEquals(TierAvailability.HIDDEN, availability(null, me("credits7")))
        assertEquals(TierAvailability.HIDDEN, availability(config("minimal"), me("credits7")))
        assertEquals(TierAvailability.SIGNED_OUT, availability(full, me("signed_out")))
        assertEquals(TierAvailability.LOCKED, availability(full, me("free")))
        assertEquals(TierAvailability.LOCKED, availability(full, me("fair_use")))
        assertEquals(TierAvailability.LOCKED, availability(full, me("no_credits")))
        assertEquals(TierAvailability.AVAILABLE, availability(full, me("credits7")))
        assertEquals(TierAvailability.AVAILABLE, availability(full, me("subscriber")))
        val noSignIn = full.copy(signIn = full.signIn.copy(google = false, emailCode = false, email = false))
        assertEquals(TierAvailability.HIDDEN, availability(noSignIn, me("signed_out")))
        assertEquals("full config carries pricing and features", true, full.features.cases && full.features.evidence)
        assertEquals(listOf("pack_1", "pack_10"), full.pricing.packs.map { it.id })
        assertEquals(listOf(1.0, 7.5), full.pricing.packs.map { it.priceUsd })
        assertEquals(35, full.pricing.monthly.fairUseCap)
        assertEquals("the defaults mirror lib/pricing.ts", PricingInfo(), full.pricing)
    }

    @Test
    fun effectiveTier_isPremiumOnlyWhenAvailableAndChosen() {
        assertEquals(Tier.PREMIUM, Tiers.effective(TierAvailability.AVAILABLE, Tier.PREMIUM))
        assertEquals(Tier.FREE, Tiers.effective(TierAvailability.AVAILABLE, Tier.FREE))
        for (a in listOf(TierAvailability.HIDDEN, TierAvailability.SIGNED_OUT, TierAvailability.LOCKED)) {
            assertEquals(Tier.FREE, Tiers.effective(a, Tier.PREMIUM))
        }
    }

    @Test
    fun notes_matchTheWeb() {
        val tz = TimeZone.getDefault()
        TimeZone.setDefault(TimeZone.getTimeZone(ZoneOffset.UTC))
        try {
            fun note(a: TierAvailability, v: Tier, m: String, nudged: Boolean = false) =
                Tiers.note(en, AppLang.EN, a, v, me(m).entitlement, nudged)

            assertNull(note(TierAvailability.SIGNED_OUT, Tier.FREE, "signed_out"))
            assertEquals(TierNote("", NoteLink.SIGN_IN, en.tierSignInToUse), note(TierAvailability.SIGNED_OUT, Tier.FREE, "signed_out", nudged = true))
            assertEquals(TierNote(en.tierFairUse("October 31"), NoteLink.PRICING, en.tierGetPremium), note(TierAvailability.LOCKED, Tier.FREE, "fair_use"))
            assertEquals(TierNote(en.tierOutOfCredits, NoteLink.PRICING, en.tierGetPremium), note(TierAvailability.LOCKED, Tier.FREE, "no_credits"))
            assertEquals(TierNote(en.tierInvite, NoteLink.PRICING, en.tierGetPremium), note(TierAvailability.LOCKED, Tier.FREE, "free"))
            assertEquals(TierNote(en.tierFreeHint), note(TierAvailability.AVAILABLE, Tier.FREE, "credits7"))
            assertEquals(TierNote("${en.tierPremiumHint} ${en.tierCreditsLeft(7)}"), note(TierAvailability.AVAILABLE, Tier.PREMIUM, "credits7"))
            assertEquals(TierNote("${en.tierPremiumHint} ${en.tierMonthlyLeft("23")}"), note(TierAvailability.AVAILABLE, Tier.PREMIUM, "subscriber"))

            val noDate = Entitlement(canUsePremium = false, blockedReason = "fair_use", resetsAt = null)
            assertEquals(en.tierFairUseSoon, Tiers.note(en, AppLang.EN, TierAvailability.LOCKED, Tier.FREE, noDate, false)!!.text)
            assertEquals(tr.tierFairUse("31 Ekim"), Tiers.note(tr, AppLang.TR, TierAvailability.LOCKED, Tier.FREE, me("fair_use").entitlement, false)!!.text)
            assertNull("still loading: no line", Tiers.note(en, AppLang.EN, TierAvailability.LOCKED, Tier.FREE, null, false))
        } finally {
            TimeZone.setDefault(tz)
        }
    }

    @Test
    fun remaining_monthlyFirstThenCredits() {
        assertEquals(PremiumRemaining(monthly = true, n = 23), Tiers.remaining(me("subscriber").entitlement))
        assertEquals(PremiumRemaining(monthly = false, n = 7), Tiers.remaining(me("credits7").entitlement))
        assertNull(Tiers.remaining(me("fair_use").entitlement))
        assertNull(Tiers.remaining(null))
    }

    @Test
    fun formatPrice_likeIntl() {
        assertEquals("$7.50", Tiers.formatPrice(7.5, AppLang.EN))
        assertEquals("$15.00", Tiers.formatPrice(15.0, AppLang.EN))
        assertEquals("$0.75", Tiers.formatPrice(7.5 / 10, AppLang.EN))
        assertEquals("$7,50", Tiers.formatPrice(7.5, AppLang.TR))
        assertEquals("$1.234,50", Tiers.formatPrice(1234.5, AppLang.TR))
    }

    @Test
    fun premiumFeatures_addTheExtrasOnOffer() {
        assertEquals(3, Tiers.premiumFeatureKeys(cases = false, evidence = false).size)
        assertEquals(
            listOf("pricing.premium.f1", "pricing.premium.f2", "pricing.premium.f3", "pricing.premium.f4", "pricing.premium.f5", "pricing.premium.f6"),
            Tiers.premiumFeatureKeys(cases = true, evidence = true),
        )
        assertEquals(listOf("pricing.premium.f1", "pricing.premium.f2", "pricing.premium.f3", "pricing.premium.f5"), Tiers.premiumFeatureKeys(cases = false, evidence = true))
        for (k in Tiers.premiumFeatureKeys(cases = true, evidence = true) + Tiers.FREE_FEATURE_KEYS) {
            assert(en.text(k) != null) { "missing $k" }
        }
    }

    @Test
    fun newErrorCodes_haveTheirOwnMessage_inBothLanguages() {
        val codes = listOf(
            "in_progress", "case_closed", "case_expired", "appeal_used", "not_party", "own_case", "too_large",
            "unsupported_media", "too_many_files", "evidence_invalid", "anonymize_failed", "removed",
            "names_unavailable", "daily_cap", "not_configured",
        )
        for (s in listOf(en, tr)) {
            val lang = if (s === en) AppLang.EN else AppLang.TR
            for (code in codes) {
                val msg = Errors.apiErrorMessage(s, lang, code, 400, 60.0, null, "server words")
                assert(msg != "server words" && msg != s.errorFallback) { "$code has no message in $lang" }
                if (code != "daily_cap") assertEquals(s.text("error.$code"), msg)
            }
        }
        // The async error fixtures, as the app shows them.
        val bodies = Fixtures.verdicts["asyncErrors"]!!.jsonObject
        for ((code, e) in bodies) {
            val status = e.jsonObject["status"]!!.jsonPrimitive.content.toInt()
            val body = e.jsonObject["body"].toString()
            val err = com.okjudge.judge.core.api.JudgeApi.errorFor(status, body, null)
            val msg = Errors.message(err, en, AppLang.EN)
            assert(msg != en.errorFallback && !msg.contains("{")) { "$code -> $msg" }
        }
        assertEquals(en.refusedNote, Errors.apiErrorMessage(en, AppLang.EN, "refused", 502, null, null, "Refused."))
    }
}
