import SwiftUI

/// Free and Premium side by side (components/account/PricingView.tsx), with
/// prices from GET /api/v1/config (lib/pricing.ts until it answers). Buy
/// buttons stay disabled: purchases arrive with the store build.
struct PricingView: View {
    @Environment(AppModel.self) private var app

    private static let title = TypeStyle(face: .interTight, weight: 700, size: 30, lineHeight: 1.05, tracking: -0.03, textStyle: .title1, maxScale: 1.4)
    private static let planTitle = TypeStyle(face: .interTight, weight: 700, size: 20, lineHeight: 1.2, tracking: -0.01, textStyle: .title3, maxScale: 1.5)
    private static let price = TypeStyle(face: .interTight, weight: 700, size: 18, lineHeight: 1.2, textStyle: .headline, maxScale: 1.5)

    var body: some View {
        let lang = app.lang
        let account = app.account
        let pricing = account.pricing
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                VStack(alignment: .leading, spacing: 10) {
                    Kicker(text: L10n.navPricing(lang))
                    Text(L10n.pricingTitle(lang))
                        .brandText(Self.title)
                        .foregroundStyle(Brand.ink)
                        .accessibilityAddTraits(.isHeader)
                    Text(L10n.pricingLead(lang))
                        .brandText(.lead)
                        .foregroundStyle(Brand.ink2)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if account.isSignedIn, let entitlement = account.entitlement {
                    planStatus(entitlement, lang: lang)
                }
                freePlan(lang)
                premiumPlan(pricing, lang: lang)
                Text(L10n.pricingNote(lang))
                    .brandText(.footnote)
                    .foregroundStyle(Brand.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.horizontal, 20)
            .padding(.top, 8)
            .padding(.bottom, 32)
        }
        .background(Brand.ivory.ignoresSafeArea())
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Brand.ivory, for: .navigationBar)
        .task { await account.refresh() }
    }

    private func planStatus(_ entitlement: Entitlement, lang: AppLang) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(L10n.accountPlan(lang) + ": " + (entitlement.isPremium ? L10n.accountPlanPremium(lang) : L10n.accountPlanFree(lang)))
                .brandText(.slotTitle)
                .foregroundStyle(Brand.ink)
            Text(L10n.accountCredits(lang) + ": " + String(entitlement.credits))
                .brandText(.slotText)
                .foregroundStyle(Brand.ink2)
            if let sub = entitlement.subscription {
                let date = ErrorText.formatDate(sub.periodEnd, lang: lang) ?? sub.periodEnd
                Text(sub.willRenew ? L10n.accountSubscriptionRenews(lang, date: date) : L10n.accountSubscriptionUntil(lang, date: date))
                    .brandText(.slotText)
                    .foregroundStyle(Brand.ink2)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .paperSurface(radius: 16, fill: Brand.sageTint.opacity(0.6), border: Brand.sage.opacity(0.4))
        .accessibilityElement(children: .combine)
    }

    private func freePlan(_ lang: AppLang) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(L10n.pricingFreeTitle(lang))
                .brandText(Self.planTitle)
                .foregroundStyle(Brand.ink)
                .accessibilityAddTraits(.isHeader)
            Text(L10n.pricingFreePrice(lang))
                .brandText(Self.price)
                .foregroundStyle(Brand.ink2)
            features([L10n.pricingFreeF1(lang), L10n.pricingFreeF2(lang), L10n.appPricingFreeAccount(lang)])
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(20)
        .paperSurface(radius: Radius.card)
    }

    private func premiumPlan(_ pricing: PricingInfo, lang: AppLang) -> some View {
        let account = app.account
        return VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 6) {
                Image(systemName: "sparkle")
                    .foregroundStyle(Brand.terraInk)
                    .accessibilityHidden(true)
                Text(L10n.pricingPremiumTitle(lang))
                    .brandText(Self.planTitle)
                    .foregroundStyle(Brand.ink)
            }
            .accessibilityAddTraits(.isHeader)
            features(Self.premiumFeatures(account.premiumEnabled ? account.features : nil, lang: lang))

            Divider().overlay(Brand.line)
            Text(L10n.pricingPacksTitle(lang))
                .brandText(.slotTitle)
                .foregroundStyle(Brand.ink)
            Text(L10n.pricingPacksLead(lang))
                .brandText(.slotText)
                .foregroundStyle(Brand.muted)
                .fixedSize(horizontal: false, vertical: true)
            ForEach(pricing.packs) { pack in
                offer(
                    name: L10n.pricingPack(lang, n: String(pack.credits)),
                    meta: L10n.pricingPerVerdict(lang, price: PricingInfo.format(pack.priceUsd / Double(Swift.max(1, pack.credits)), lang: lang)),
                    price: PricingInfo.format(pack.priceUsd, lang: lang),
                    purchasable: pricing.purchasesEnabled,
                    lang: lang
                )
            }

            Text(L10n.pricingMonthlyTitle(lang))
                .brandText(.slotTitle)
                .foregroundStyle(Brand.ink)
                .padding(.top, 4)
            offer(
                name: L10n.pricingMonthlyCap(lang, n: String(pricing.monthly.fairUseCap)),
                meta: L10n.pricingMonthlyRenews(lang),
                price: PricingInfo.format(pricing.monthly.priceUsd, lang: lang),
                purchasable: pricing.purchasesEnabled,
                lang: lang
            )

            if account.premiumEnabled, !account.isSignedIn, account.signInProviders?.any == true {
                Button(L10n.tierSignInToUse(lang)) { account.presentSignIn() }
                    .buttonStyle(PrimaryButtonStyle())
                    .padding(.top, 4)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(20)
        .paperSurface(radius: Radius.card, fill: Brand.paper, border: Brand.terra.opacity(0.45))
        .cardShadow()
    }

    /// Premium's feature list plus the extras this deployment offers
    /// (premiumFeatureKeys on the web).
    static func premiumFeatures(_ features: PremiumFeatures?, lang: AppLang) -> [String] {
        var list = [L10n.pricingPremiumF1(lang), L10n.pricingPremiumF2(lang), L10n.pricingPremiumF3(lang)]
        if features?.cases == true { list.append(L10n.pricingPremiumF4(lang)) }
        if features?.evidence == true { list.append(L10n.pricingPremiumF5(lang)) }
        if features?.cases == true { list.append(L10n.pricingPremiumF6(lang)) }
        return list
    }

    private func features(_ items: [String]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    Image(systemName: "checkmark")
                        .font(.system(size: 9, weight: .bold))
                        .foregroundStyle(.white)
                        .frame(width: 18, height: 18)
                        .background(Circle().fill(Brand.sageInk))
                        .accessibilityHidden(true)
                    Text(item)
                        .brandText(TypeStyle(face: .inter, weight: 400, size: 15, lineHeight: 1.45))
                        .foregroundStyle(Brand.ink2)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }

    private func offer(name: String, meta: String, price: String, purchasable: Bool, lang: AppLang) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(name)
                        .brandText(.bodyMedium)
                        .foregroundStyle(Brand.ink)
                    Text(meta)
                        .brandText(.slotText)
                        .foregroundStyle(Brand.muted)
                }
                Spacer(minLength: 12)
                Text(price)
                    .brandText(Self.price)
                    .foregroundStyle(Brand.ink)
                    .monospacedDigit()
            }
            // Purchases arrive with the store build: disabled either way.
            Button(purchasable ? price : L10n.pricingComingSoon(lang)) {}
                .buttonStyle(GhostButtonStyle())
                .disabled(true)
                .opacity(0.6)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .paperSurface(radius: 18, fill: Brand.ivory)
    }
}
