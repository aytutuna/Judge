package com.okjudge.judge.ui.premium

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.disabled
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.okjudge.judge.core.display.Errors
import com.okjudge.judge.core.model.Entitlement
import com.okjudge.judge.core.model.Features
import com.okjudge.judge.core.model.PricingInfo
import com.okjudge.judge.core.premium.Tiers
import com.okjudge.judge.i18n.LocalLang
import com.okjudge.judge.i18n.LocalStrings
import com.okjudge.judge.ui.components.JudgeIcons
import com.okjudge.judge.ui.components.Kicker
import com.okjudge.judge.ui.components.PrimaryButton
import com.okjudge.judge.ui.components.TintedIcon
import com.okjudge.judge.ui.components.TopBar
import com.okjudge.judge.ui.theme.JudgeShapes
import com.okjudge.judge.ui.theme.JudgeType
import com.okjudge.judge.ui.theme.Palette

object PricingTags {
    const val STATUS = "pricing.status"
    const val BUY = "pricing.buy"
    const val SIGN_IN = "pricing.signIn"
}

/**
 * Free and Premium (components/account/PricingView.tsx): prices from
 * /api/v1/config (lib/pricing.ts until it answers), the signed-in plan, and
 * buy buttons that stay disabled: "Coming soon" while purchases are off.
 * [premiumEnabled] is null while /config is loading.
 */
@Composable
fun PricingScreen(
    pricing: PricingInfo,
    premiumEnabled: Boolean?,
    features: Features?,
    signedIn: Boolean,
    signInOffered: Boolean,
    entitlement: Entitlement?,
    onBack: (() -> Unit)?,
    onSignIn: () -> Unit,
    onToggleLang: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val s = LocalStrings.current
    val lang = LocalLang.current
    Column(modifier.fillMaxSize()) {
        TopBar(onBack = onBack, onToggleLang = onToggleLang)
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Column(
                Modifier.widthIn(max = 640.dp).fillMaxWidth().padding(top = 8.dp, bottom = 40.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Kicker(s.navPricing)
                    Text(
                        s.pricingTitle,
                        style = JudgeType.sectionTitle.copy(fontSize = JudgeType.sectionTitle.fontSize * 1.3f),
                        modifier = Modifier.semantics { heading() },
                    )
                    Text(s.pricingLead, style = JudgeType.lead)
                }

                if (signedIn && entitlement != null) {
                    val sub = entitlement.subscription
                    Column(
                        Modifier
                            .fillMaxWidth()
                            .clip(JudgeShapes.field)
                            .background(Palette.paper)
                            .border(1.dp, Palette.line, JudgeShapes.field)
                            .testTag(PricingTags.STATUS)
                            .padding(horizontal = 16.dp, vertical = 12.dp),
                        verticalArrangement = Arrangement.spacedBy(2.dp),
                    ) {
                        Text(
                            "${s.accountPlan}: ${if (entitlement.isPremium) s.accountPlanPremium else s.accountPlanFree}",
                            style = JudgeType.bodyStrong,
                        )
                        Text("${s.accountCredits}: ${entitlement.credits}", style = JudgeType.body.copy(color = Palette.ink2))
                        if (sub != null) {
                            val date = Errors.formatDate(lang, sub.periodEnd) ?: sub.periodEnd
                            Text(
                                if (sub.willRenew) s.accountSubscriptionRenews(date) else s.accountSubscriptionUntil(date),
                                style = JudgeType.body.copy(color = Palette.ink2),
                            )
                        }
                    }
                }

                PlanCard(highlight = false) {
                    Text(s.pricingFreeTitle, style = JudgeType.sectionTitle, modifier = Modifier.semantics { heading() })
                    Text(s.pricingFreePrice, style = JudgeType.lead.copy(color = Palette.ink))
                    FeatureList(Tiers.FREE_FEATURE_KEYS)
                }

                PlanCard(highlight = true) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        TintedIcon(remember { JudgeIcons.spark(Palette.terra) }, 14)
                        Text(s.pricingPremiumTitle, style = JudgeType.sectionTitle, modifier = Modifier.semantics { heading() })
                    }
                    val shown = if (premiumEnabled == true) features else null
                    FeatureList(Tiers.premiumFeatureKeys(cases = shown?.cases == true, evidence = shown?.evidence == true))

                    Text(s.pricingPacksTitle, style = JudgeType.slotTitle.copy(color = Palette.ink), modifier = Modifier.padding(top = 8.dp))
                    Text(s.pricingPacksLead, style = JudgeType.slotText)
                    pricing.packs.forEach { pack ->
                        val price = Tiers.formatPrice(pack.priceUsd, lang, pricing.currency)
                        val each = if (pack.credits > 0) Tiers.formatPrice(pack.priceUsd / pack.credits, lang, pricing.currency) else price
                        Offer(
                            name = s.pricingPack(pack.credits.toString()),
                            meta = s.pricingPerVerdict(each),
                            price = price,
                            buyLabel = if (pricing.purchasesEnabled) price else s.pricingComingSoon,
                        )
                    }

                    Text(s.pricingMonthlyTitle, style = JudgeType.slotTitle.copy(color = Palette.ink), modifier = Modifier.padding(top = 8.dp))
                    val monthly = Tiers.formatPrice(pricing.monthly.priceUsd, lang, pricing.currency)
                    Offer(
                        name = s.pricingMonthlyCap(pricing.monthly.fairUseCap.toString()),
                        meta = s.pricingMonthlyRenews,
                        price = monthly,
                        buyLabel = if (pricing.purchasesEnabled) monthly else s.pricingComingSoon,
                    )

                    if (premiumEnabled == true && !signedIn && signInOffered) {
                        PrimaryButton(
                            text = s.navSignIn,
                            enabled = true,
                            onClick = onSignIn,
                            modifier = Modifier.fillMaxWidth().padding(top = 8.dp).testTag(PricingTags.SIGN_IN),
                        )
                    }
                }

                Text(s.pricingNote, style = JudgeType.footnote, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
            }
        }
    }
}

@Composable
private fun PlanCard(highlight: Boolean, content: @Composable () -> Unit) {
    Column(
        Modifier
            .fillMaxWidth()
            .clip(JudgeShapes.block)
            .background(if (highlight) Palette.paper else Palette.ivory)
            .border(if (highlight) 1.5.dp else 1.dp, if (highlight) Palette.terra.copy(alpha = 0.55f) else Palette.line2, JudgeShapes.block)
            .padding(18.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) { content() }
}

@Composable
private fun FeatureList(keys: List<String>) {
    val s = LocalStrings.current
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        keys.forEach { key ->
            val text = s.text(key) ?: return@forEach
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.Top) {
                Box(
                    Modifier.padding(top = 3.dp).size(18.dp).clip(CircleShape).background(Palette.sageInk),
                    contentAlignment = Alignment.Center,
                ) { TintedIcon(JudgeIcons.factCheck, 10) }
                Text(text, style = JudgeType.body.copy(color = Palette.ink2))
            }
        }
    }
}

@Composable
private fun Offer(name: String, meta: String, price: String, buyLabel: String) {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(Palette.ivory)
            .border(1.dp, Palette.line, RoundedCornerShape(16.dp))
            .padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Column(Modifier.weight(1f)) {
            Text(name, style = JudgeType.slotTitle)
            Text(meta, style = JudgeType.slotText)
        }
        Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(price, style = JudgeType.bodyStrong)
            // Disabled in every case for now: purchases arrive with the store build.
            Box(
                Modifier
                    .defaultMinSize(minHeight = 34.dp)
                    .clip(JudgeShapes.chip)
                    .border(1.dp, Palette.line2, JudgeShapes.chip)
                    .semantics {
                        role = Role.Button
                        disabled()
                    }
                    .testTag(PricingTags.BUY)
                    .padding(horizontal = 12.dp, vertical = 7.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(buyLabel, style = JudgeType.small.copy(color = Palette.muted))
            }
        }
    }
}
