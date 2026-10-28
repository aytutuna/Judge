package com.okjudge.judge.core.premium

import com.okjudge.judge.core.model.Entitlement
import com.okjudge.judge.i18n.AppLang
import com.okjudge.judge.i18n.Strings
import java.text.NumberFormat
import java.util.Currency
import java.util.Locale

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

    /** "$7.50" in English, "$7,50" in Turkish (formatPrice). */
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
        if (evidence) add("pricing.premium.f5")
        if (cases) add("pricing.premium.f6")
    }

    /** Free's feature list keys, plus two-sided cases when this deployment offers them (freeFeatureKeys). */
    fun freeFeatureKeys(cases: Boolean): List<String> = buildList {
        add("pricing.free.f1")
        add("pricing.free.f2")
        add("app.pricing.free.account")
        if (cases) add("pricing.free.f4")
    }
}
