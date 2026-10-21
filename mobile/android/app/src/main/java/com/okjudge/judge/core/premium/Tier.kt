package com.okjudge.judge.core.premium

import com.okjudge.judge.core.display.Errors
import com.okjudge.judge.core.model.Entitlement
import com.okjudge.judge.core.model.ServerConfig
import com.okjudge.judge.i18n.AppLang
import com.okjudge.judge.i18n.Strings
import java.text.NumberFormat
import java.util.Currency
import java.util.Locale

enum class Tier(val raw: String) {
    FREE("free"), PREMIUM("premium");

    companion object {
        fun of(raw: String?): Tier = if (raw == PREMIUM.raw) PREMIUM else FREE
    }
}

/**
 * What the Free / Premium switch may offer (TierAvailability in lib/tier.ts):
 * - HIDDEN: premium is off (or /config not loaded), or the viewer is signed
 *   out with no sign-in method on offer: no switch at all.
 * - SIGNED_OUT: switch shown, Premium locked behind sign-in.
 * - LOCKED: signed in, nothing to spend right now (or the account is still loading).
 * - AVAILABLE: both options selectable.
 */
enum class TierAvailability { HIDDEN, SIGNED_OUT, LOCKED, AVAILABLE }

/** Where the note's link goes. */
enum class NoteLink { SIGN_IN, PRICING }

data class TierNote(val text: String, val link: NoteLink? = null, val linkLabel: String? = null)

/** What is left to spend right now: the monthly allowance first, then credits (premiumRemaining). */
data class PremiumRemaining(val monthly: Boolean, val n: Int)

/** Ports of lib/tier.ts and tierNote (components/TierSwitch.tsx), plus formatPrice (lib/pricing.ts). */
object Tiers {
    fun availability(config: ServerConfig?, signedIn: Boolean, entitlement: Entitlement?): TierAvailability {
        if (config?.premiumEnabled != true) return TierAvailability.HIDDEN
        if (!signedIn) return if (config.signInOffered) TierAvailability.SIGNED_OUT else TierAvailability.HIDDEN
        return if (entitlement?.canUsePremium == true) TierAvailability.AVAILABLE else TierAvailability.LOCKED
    }

    /** The remembered choice becomes a premium request only while premium can be used. */
    fun effective(availability: TierAvailability, choice: Tier): Tier =
        if (availability == TierAvailability.AVAILABLE && choice == Tier.PREMIUM) Tier.PREMIUM else Tier.FREE

    fun remaining(e: Entitlement?): PremiumRemaining? {
        if (e == null) return null
        val sub = e.subscription
        if (sub != null && sub.cap - sub.used > 0) return PremiumRemaining(monthly = true, n = sub.cap - sub.used)
        if (e.credits > 0) return PremiumRemaining(monthly = false, n = e.credits)
        return null
    }

    /**
     * The line under the switch, or null. [nudged]: a signed-out viewer has
     * reached for the locked Premium option. A locked account whose
     * entitlement has not loaded yet gets no line (rather than the invite).
     */
    fun note(
        s: Strings,
        lang: AppLang,
        availability: TierAvailability,
        value: Tier,
        entitlement: Entitlement?,
        nudged: Boolean,
    ): TierNote? = when (availability) {
        TierAvailability.HIDDEN -> null
        TierAvailability.SIGNED_OUT -> if (nudged) TierNote("", NoteLink.SIGN_IN, s.tierSignInToUse) else null
        TierAvailability.LOCKED -> when {
            entitlement == null -> null
            entitlement.blockedReason == "fair_use" -> TierNote(
                Errors.formatDate(lang, entitlement.resetsAt)?.let { s.tierFairUse(it) } ?: s.tierFairUseSoon,
                NoteLink.PRICING,
                s.tierGetPremium,
            )
            entitlement.blockedReason == "no_credits" -> TierNote(s.tierOutOfCredits, NoteLink.PRICING, s.tierGetPremium)
            else -> TierNote(s.tierInvite, NoteLink.PRICING, s.tierGetPremium)
        }
        TierAvailability.AVAILABLE -> if (value == Tier.FREE) {
            TierNote(s.tierFreeHint)
        } else {
            val left = remaining(entitlement)
            val count = when {
                left == null -> ""
                left.monthly -> s.tierMonthlyLeft(left.n.toString())
                else -> s.tierCreditsLeft(left.n)
            }
            TierNote(listOf(s.tierPremiumHint, count).filter { it.isNotEmpty() }.joinToString(" "))
        }
    }

    /** "$1.99" in English, "$1,99" in Turkish (formatPrice). */
    fun formatPrice(usd: Double, lang: AppLang, currency: String = "USD"): String {
        val locale = if (lang == AppLang.TR) Locale.forLanguageTag("tr-TR") else Locale.US
        val nf = NumberFormat.getCurrencyInstance(locale)
        runCatching { nf.currency = Currency.getInstance(currency) }
        nf.minimumFractionDigits = 2
        nf.maximumFractionDigits = 2
        return nf.format(usd)
    }

    /** Premium's feature list keys, plus the extras this deployment offers (premiumFeatureKeys). */
    fun premiumFeatureKeys(cases: Boolean, evidence: Boolean): List<String> = buildList {
        add("pricing.premium.f1")
        add("pricing.premium.f2")
        add("pricing.premium.f3")
        if (cases) add("pricing.premium.f4")
        if (evidence) add("pricing.premium.f5")
        if (cases) add("pricing.premium.f6")
    }

    val FREE_FEATURE_KEYS = listOf("pricing.free.f1", "pricing.free.f2", "app.pricing.free.account")
}
