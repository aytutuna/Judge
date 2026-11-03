import Foundation
@preconcurrency import RevenueCat

/// The store through RevenueCat (StoreKit 2 underneath). Created only when
/// a public SDK key is configured; creating it configures the SDK.
@MainActor
final class RevenueCatGateway: PurchaseGateway {
    /// The packages behind the last `offers()`, by plan id.
    private var packages: [String: Package] = [:]

    init(apiKey: String) {
        #if DEBUG
        Purchases.logLevel = .warn
        #endif
        if !Purchases.isConfigured {
            Purchases.configure(withAPIKey: apiKey)
        }
    }

    func logIn(userId: String) async throws {
        _ = try await Purchases.shared.logIn(userId)
    }

    func logOut() async {
        // Logging out an anonymous user is an error in the SDK.
        guard !Purchases.shared.isAnonymous else { return }
        _ = try? await Purchases.shared.logOut()
    }

    func isLoggedIn(as userId: String) -> Bool {
        !Purchases.shared.isAnonymous && Purchases.shared.appUserID == userId
    }

    func offers() async throws -> [StoreOffer] {
        let offerings = try await Purchases.shared.offerings()
        let available = offerings.current?.availablePackages ?? []
        let seen = available.map { $0.storeProduct.productIdentifier }
        let byPlan = StoreCatalog.match(available.map {
            StoreCatalog.Candidate(packageId: $0.identifier, productId: $0.storeProduct.productIdentifier)
        })
        var packages: [String: Package] = [:]
        var offers: [StoreOffer] = []
        for (plan, candidate) in byPlan {
            guard let package = available.first(where: {
                $0.identifier == candidate.packageId && $0.storeProduct.productIdentifier == candidate.productId
            }) else { continue }
            packages[plan] = package
            offers.append(StoreOffer(
                planId: plan,
                productId: candidate.productId,
                price: package.storeProduct.localizedPriceString,
                amount: package.storeProduct.price,
                currencyCode: package.storeProduct.currencyCode
            ))
        }
        self.packages = packages
        if offers.isEmpty { throw PurchaseGatewayError.noMatch(seen: seen) }
        return offers
    }

    func purchase(planId: String) async throws -> PurchaseOutcome {
        guard let package = packages[planId] else { throw PurchaseGatewayError.unavailable }
        do {
            let result = try await Purchases.shared.purchase(package: package)
            return result.userCancelled ? .cancelled : .purchased
        } catch let error as ErrorCode {
            switch error {
            case .purchaseCancelledError: return .cancelled
            case .paymentPendingError: return .pending
            default: throw error
            }
        }
    }

    func restore() async throws -> Bool {
        let info = try await Purchases.shared.restorePurchases()
        return !info.activeSubscriptions.isEmpty || !info.entitlements.active.isEmpty
    }
}
