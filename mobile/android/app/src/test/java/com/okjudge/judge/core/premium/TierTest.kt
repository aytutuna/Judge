package com.okjudge.judge.core.premium

import com.okjudge.judge.Fixtures
import com.okjudge.judge.core.display.Errors
import com.okjudge.judge.core.display.UiError
import com.okjudge.judge.core.model.Entitlement
import com.okjudge.judge.core.model.MeResponse
import com.okjudge.judge.core.model.PricingInfo
import com.okjudge.judge.core.model.ServerConfig
import com.okjudge.judge.core.model.SubscriptionView
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

/** lib/tier.ts, the balance line, prices and the new error codes, against the fixtures. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class TierTest {
    private val en = UiTestSupport.s(AppLang.EN)
    private val tr = UiTestSupport.s(AppLang.TR)

    private fun config(name: String): ServerConfig =
        WireJson.json.decodeFromString(ServerConfig.serializer(), Fixtures.verdicts["config"]!!.jsonObject[name].toString())

    private fun me(name: String): MeResponse =
        WireJson.json.decodeFromString(MeResponse.serializer(), Fixtures.verdicts["me"]!!.jsonObject[name].toString())

    @Test
    fun config_carriesPricingAndFeatures() {
        val full = config("full")
        assertEquals(true, full.features.cases && full.features.evidence)
        assertEquals(listOf("pack_1", "pack_10"), full.pricing.packs.map { it.id })
        assertEquals(listOf(1.0, 7.5), full.pricing.packs.map { it.priceUsd })
        assertEquals(35, full.pricing.monthly.fairUseCap)
        assertEquals("the defaults mirror lib/pricing.ts", PricingInfo(), full.pricing)
    }

    @Test
    fun balance_monthlyFirst_thenCredits_thenNone() {
        val sub = me("subscriber").entitlement!!.subscription!!
        assertEquals(en.appBalanceMonthly("23", sub.cap.toString()), Tiers.balance(en, me("subscriber").entitlement))
        assertEquals("7 verdicts left", Tiers.balance(en, me("credits7").entitlement))
        assertEquals("1 verdict left", Tiers.balance(en, Entitlement(canUsePremium = true, credits = 1)))
        assertEquals("12 of 35 left this month", Tiers.balance(en, Entitlement(subscription = SubscriptionView(used = 23, cap = 35))))
        assertEquals(en.appBalanceNone, Tiers.balance(en, me("fair_use").entitlement))
        assertEquals(en.appBalanceNone, Tiers.balance(en, me("no_credits").entitlement))
        assertNull("still loading: no line", Tiers.balance(en, null))
        assertEquals(tr.appBalanceLeft(3), Tiers.balance(tr, Entitlement(credits = 3)))
    }

    @Test
    fun outOfUnits_andSignedOut_openAScreen() {
        for (code in listOf("no_credits", "fair_use", "premium_required")) {
            assertEquals(code, Errors.Opens.PRICING, Errors.opens(UiError.Api(code, 402)))
        }
        assertEquals(Errors.Opens.SIGN_IN, Errors.opens(UiError.Api("sign_in_required", 401)))
        assertEquals(Errors.Opens.SIGN_IN, Errors.opens(UiError.Api("signin_required", 401)))
        assertNull(Errors.opens(UiError.Api("rate_limited", 429)))
        assertNull(Errors.opens(UiError.Offline))
        assertEquals(en.errorSigninRequired, Errors.apiErrorMessage(en, AppLang.EN, "sign_in_required", 401, null, null, "x"))
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
            listOf("pricing.premium.f1", "pricing.premium.f2", "pricing.premium.f3", "pricing.premium.f5", "pricing.premium.f6"),
            Tiers.premiumFeatureKeys(cases = true, evidence = true),
        )
        assertEquals(listOf("pricing.premium.f1", "pricing.premium.f2", "pricing.premium.f3", "pricing.premium.f5"), Tiers.premiumFeatureKeys(cases = false, evidence = true))
        assertEquals(listOf("pricing.free.f1", "pricing.free.f2", "app.pricing.free.account"), Tiers.freeFeatureKeys(cases = false))
        assertEquals("pricing.free.f4", Tiers.freeFeatureKeys(cases = true).last())
        for (k in Tiers.premiumFeatureKeys(cases = true, evidence = true) + Tiers.freeFeatureKeys(cases = true)) {
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
