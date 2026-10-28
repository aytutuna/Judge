package com.okjudge.judge.core.premium

import com.okjudge.judge.core.model.Entitlement
import com.okjudge.judge.i18n.AppLang
import com.okjudge.judge.i18n.Strings
import java.text.NumberFormat
import java.util.Currency

/** What is left to spend right now: the monthly allowance first, then credits (premiumRemaining). */
data class PremiumRemaining(val monthly: Boolean, val n: Int)

/** Ports of premiumRemaining (lib/tier.ts) and formatPrice (lib/pricing.ts), and the balance line. */
object Tiers {
    fun remaining(e: Entitlement?): PremiumRemaining? {
        if (e == null) return null
        val sub = e.subscription
        if (sub != null && sub.cap - sub.used > 0) return PremiumRemaining(monthly = true, n = sub.cap - sub.used)
        if (e.credits > 0) return PremiumRemaining(monthly = false, n = e.credits)
        return null
    }

    /** "3 verdicts left", "12 of 35 left this month" or "No verdicts left"; null while the account loads. */
    fun balance(s: Strings, e: Entitlement?): String? {
        if (e == null) return null
        val left = remaining(e) ?: return s.appBalanceNone
        val cap = e.subscription?.cap ?: 0
        return if (left.monthly) s.appBalanceMonthly(left.n.toString(), cap.toString()) else s.appBalanceLeft(left.n)
    }

    /** US dollars in the language's number format: "$7.50" in English, "$7,50" in Turkish (formatPrice). */
    fun formatPrice(usd: Double, lang: AppLang, currency: String = "USD"): String {
        val nf = NumberFormat.getCurrencyInstance(lang.locale)
        runCatching { nf.currency = Currency.getInstance(currency) }
        nf.minimumFractionDigits = 2
        nf.maximumFractionDigits = 2
        // A price ending on a neutral "$" ("7.50 US$") would move to the front
        // of a right-to-left line; a closing LRM keeps it in place.
        return if (lang.rtl) nf.format(usd) + "\u200E" else nf.format(usd)
    }

    /** Premium's feature list keys, plus the extras this deployment offers (premiumFeatureKeys). */
    fun premiumFeatureKeys(cases: Boolean, evidence: Boolean): List<String> = buildList {
        add("pricing.premium.f1")
        add("pricing.premium.f2")
        add("pricing.premium.f3")
        if (evidence) add("pricing.premium.f5")
        if (cases) add("pricing.premium.f6")
    }
}
