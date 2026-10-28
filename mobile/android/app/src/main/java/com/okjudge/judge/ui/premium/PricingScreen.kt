package com.okjudge.judge.ui.premium

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
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
import androidx.compose.material3.CircularProgressIndicator
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
import com.okjudge.judge.core.purchases.PurchaseController
import com.okjudge.judge.core.purchases.StoreOffer
import com.okjudge.judge.core.purchases.StoreProducts
import com.okjudge.judge.i18n.LocalLang
import com.okjudge.judge.i18n.LocalStrings
import com.okjudge.judge.i18n.rememberPurchaseStrings
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
    const val NOTICE = "pricing.notice"
}

/**
 * The store's side of the pricing screen. The default is a build without a
 * store (no SDK key): buy buttons say "Coming soon".
 */
data class StoreUi(
    /** This build can sell (it has an SDK key). */
    val available: Boolean = false,
    /** What the store sells to the signed-in account, by product id; empty until it is ready. */
    val offers: Map<String, StoreOffer> = emptyMap(),
    /** The product being bought. */
    val buying: String? = null,
    val notice: PurchaseController.Notice? = null,
    /** The store has the subscription but /me does not show it yet. */
    val subscriptionPending: Boolean = false,
)

/**
 * The packs and the monthly plan (components/account/PricingView.tsx):
 * prices from /api/v1/config (lib/pricing.ts until it answers), what the
 * signed-in account has left, and the buy buttons. With purchases on and the
 * store ready ([store]) a button shows the store's own price and buys that
 * product; otherwise it stays disabled ("Coming soon" while purchases are off).
 * [features] is null while /config is loading.
 */
@Composable
fun PricingScreen(
    pricing: PricingInfo,
    features: Features?,
    signedIn: Boolean,
    signInOffered: Boolean,
    entitlement: Entitlement?,
    onBack: (() -> Unit)?,
    onSignIn: () -> Unit,
    onNew: (() -> Unit)?,
    modifier: Modifier = Modifier,
    store: StoreUi = StoreUi(),
    onBuy: (productId: String) -> Unit = {},
) {
    val s = LocalStrings.current
    val ps = rememberPurchaseStrings()
    val lang = LocalLang.current
    val storeOn = pricing.purchasesEnabled && store.available
    // The store's offer for a product, when this account can buy it now.
    fun offerFor(id: String): StoreOffer? = if (storeOn && signedIn) store.offers[id] else null
    Column(modifier.fillMaxSize()) {
        TopBar(onBack = onBack, onNew = onNew)
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
                        s.appPricingHeadline,
                        style = JudgeType.sectionTitle.copy(fontSize = JudgeType.sectionTitle.fontSize * 1.3f),
                        modifier = Modifier.semantics { heading() },
                    )
                    Text(s.appPricingSub, style = JudgeType.lead)
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
                        Tiers.balance(s, entitlement)?.let { Text(it, style = JudgeType.bodyStrong) }
                        if (sub != null) {
                            // Credits kept beside the plan need their own line; past the cap the line above counts them.
                            if (Tiers.remaining(entitlement)?.monthly == true && entitlement.credits > 0) {
                                Text("${s.accountCredits}: ${entitlement.credits}", style = JudgeType.body.copy(color = Palette.ink2))
                            }
                            val date = Errors.formatDate(lang, sub.periodEnd) ?: sub.periodEnd
                            Text(
                                if (sub.willRenew) s.accountSubscriptionRenews(date) else s.accountSubscriptionUntil(date),
                                style = JudgeType.body.copy(color = Palette.ink2),
                            )
                        }
                    }
                }

                PlanCard {
                    Text(s.pricingPacksTitle, style = JudgeType.slotTitle.copy(color = Palette.ink))
                    Text(s.pricingPacksLead, style = JudgeType.slotText)
                    pricing.packs.forEach { pack ->
                        val offer = offerFor(pack.id)
                        val price = offer?.price ?: Tiers.formatPrice(pack.priceUsd, lang, pricing.currency)
                        val each = when {
                            pack.credits <= 0 -> price
                            offer != null -> Tiers.formatPrice(offer.amountMicros / 1_000_000.0 / pack.credits, lang, offer.currencyCode)
                            else -> Tiers.formatPrice(pack.priceUsd / pack.credits, lang, pricing.currency)
                        }
                        Offer(
                            name = s.pricingPack(pack.credits),
                            meta = s.pricingPerVerdict(each),
                            price = price,
                            buyLabel = if (storeOn) price else s.pricingComingSoon,
                            enabled = offer != null && store.buying == null,
                            buying = store.buying == pack.id,
                            buyingLabel = ps.buying,
                            onBuy = { onBuy(pack.id) },
                        )
                    }

                    Text(s.pricingMonthlyTitle, style = JudgeType.slotTitle.copy(color = Palette.ink), modifier = Modifier.padding(top = 8.dp))
                    val monthlyId = pricing.monthly.id.ifEmpty { StoreProducts.MONTHLY }
                    val monthlyOffer = offerFor(monthlyId)
                    val monthly = monthlyOffer?.price ?: Tiers.formatPrice(pricing.monthly.priceUsd, lang, pricing.currency)
                    Offer(
                        name = s.pricingMonthlyCap(pricing.monthly.fairUseCap.toString()),
                        meta = s.pricingMonthlyRenews,
                        price = monthly,
                        buyLabel = if (storeOn) monthly else s.pricingComingSoon,
                        enabled = monthlyOffer != null && store.buying == null,
                        buying = store.buying == monthlyId,
                        buyingLabel = ps.buying,
                        onBuy = { onBuy(monthlyId) },
                    )

                    val notice = when (store.notice) {
                        PurchaseController.Notice.ARRIVING -> "${ps.success} ${ps.pending}"
                        PurchaseController.Notice.ARRIVED -> ps.success
                        PurchaseController.Notice.SLOW -> "${ps.success} ${ps.slow}"
                        PurchaseController.Notice.FAILED -> ps.failed
                        null -> if (store.subscriptionPending && signedIn) ps.pending else null
                    }
                    if (notice != null) {
                        PurchaseNotice(
                            text = notice,
                            working = store.notice == PurchaseController.Notice.ARRIVING,
                            failed = store.notice == PurchaseController.Notice.FAILED,
                        )
                    }

                    if (!signedIn && signInOffered) {
                        PrimaryButton(
                            text = s.navSignIn,
                            enabled = true,
                            onClick = onSignIn,
                            modifier = Modifier.fillMaxWidth().padding(top = 8.dp).testTag(PricingTags.SIGN_IN),
                        )
                    }

                    Row(
                        Modifier.padding(top = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        TintedIcon(remember { JudgeIcons.spark(Palette.terra) }, 14)
                        Text(s.pricingIncludedTitle, style = JudgeType.sectionTitle, modifier = Modifier.semantics { heading() })
                    }
                    FeatureList(Tiers.premiumFeatureKeys(cases = features?.cases == true, evidence = features?.evidence == true))
                }

                // "Prices in USD, payments not open yet" is wrong once the store sells in the buyer's currency.
                val storeSelling = storeOn && signedIn && store.offers.isNotEmpty()
                if (!storeSelling) {
                    Text(s.pricingNote, style = JudgeType.footnote, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
                }
            }
        }
    }
}

@Composable
private fun PlanCard(content: @Composable () -> Unit) {
    Column(
        Modifier
            .fillMaxWidth()
            .clip(JudgeShapes.block)
            .background(Palette.paper)
            .border(1.5.dp, Palette.terra.copy(alpha = 0.55f), JudgeShapes.block)
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
private fun PurchaseNotice(text: String, working: Boolean, failed: Boolean) {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(JudgeShapes.field)
            .background(Palette.ivory)
            .border(1.dp, if (failed) Palette.danger.copy(alpha = 0.5f) else Palette.line, JudgeShapes.field)
            .testTag(PricingTags.NOTICE)
            .padding(horizontal = 14.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        if (working) CircularProgressIndicator(Modifier.size(14.dp), color = Palette.ink2, strokeWidth = 1.5.dp)
        Text(text, style = JudgeType.body.copy(color = if (failed) Palette.danger else Palette.ink2))
    }
}

@Composable
private fun Offer(
    name: String,
    meta: String,
    price: String,
    buyLabel: String,
    enabled: Boolean,
    buying: Boolean,
    buyingLabel: String,
    onBuy: () -> Unit,
) {
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
            Row(
                Modifier
                    .defaultMinSize(minHeight = 34.dp)
                    .clip(JudgeShapes.chip)
                    .then(if (enabled) Modifier.background(Palette.ink) else Modifier.border(1.dp, Palette.line2, JudgeShapes.chip))
                    .then(
                        if (enabled) {
                            Modifier.clickable(role = Role.Button, onClick = onBuy)
                        } else {
                            Modifier.semantics {
                                role = Role.Button
                                disabled()
                            }
                        },
                    )
                    .testTag(PricingTags.BUY)
                    .padding(horizontal = 12.dp, vertical = 7.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                if (buying) {
                    CircularProgressIndicator(Modifier.size(11.dp), color = Palette.muted, strokeWidth = 1.5.dp)
                    Text(buyingLabel, style = JudgeType.small.copy(color = Palette.muted))
                } else {
                    Text(buyLabel, style = JudgeType.small.copy(color = if (enabled) Palette.ivory else Palette.muted))
                }
            }
        }
    }
}
