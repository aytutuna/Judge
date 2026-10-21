import Foundation

/// The store as the app sees it. `RevenueCatGateway` is the real one; tests
/// and screenshot states use fakes. Everything the account shows (credits,
/// subscription) still comes from GET /api/v1/me: the server hears about
/// purchases from the store's webhook and grants them there.
@MainActor
protocol PurchaseGateway: AnyObject {
    /// Ties purchases to our user id, so the webhook's `app_user_id` is the
    /// Judge account.
    func logIn(userId: String) async throws
    /// Back to an anonymous store user. Never fails.
    func logOut() async
    /// Whether the store's current user is this Judge user id (checked right
    /// before the purchase sheet).
    func isLoggedIn(as userId: String) -> Bool
    /// The current offering's products that the server knows how to grant.
    func offers() async throws -> [StoreOffer]
    /// Runs the store's purchase sheet for one of the loaded offers.
    func purchase(planId: String) async throws -> PurchaseOutcome
    /// Asks the store for earlier purchases. True when an active
    /// subscription (or entitlement) came back.
    func restore() async throws -> Bool
}

/// One product on the pricing screen, priced by the store.
struct StoreOffer: Sendable, Equatable {
    /// `pack_10`, `pack_30` or `monthly` (lib/pricing.ts plan ids).
    let planId: String
    /// The App Store product id.
    let productId: String
    /// Localized price, e.g. "$1.99" or "₺89,99".
    let price: String
    /// The same price as a number, for the per-verdict line.
    var amount: Decimal?
    var currencyCode: String?
}

extension StoreOffer {
    /// The store price divided over a pack's credits, in the store's
    /// currency ("$0.20", "₺8,99"); nil when the store gave no amount.
    func perVerdict(credits: Int, lang: AppLang) -> String? {
        guard let amount, let currencyCode, !currencyCode.isEmpty, credits > 0 else { return nil }
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.locale = Locale(identifier: lang == .tr ? "tr_TR" : "en_US")
        formatter.currencyCode = currencyCode
        return formatter.string(from: (amount / Decimal(credits)) as NSDecimalNumber)
    }
}

enum PurchaseOutcome: Sendable, Equatable {
    case purchased
    case cancelled
    /// Waiting on someone else (Ask to Buy, a bank check).
    case pending
}

enum PurchaseGatewayError: Error, Equatable {
    /// The plan has no loaded store product.
    case unavailable
    /// No signed-in account to buy for.
    case signedOut
}

/// Which store products the server grants (lib/pricing.ts STORE_PRODUCTS).
enum StoreCatalog {
    static let planIds = ["pack_10", "pack_30", "monthly"]

    /// Store product id → plan id.
    static let productPlans: [String: String] = [
        "pack_10": "pack_10",
        "pack_30": "pack_30",
        "monthly": "monthly",
        "verdict_credits_10": "pack_10",
        "verdict_credits_30": "pack_30",
        "verdict_premium_monthly": "monthly",
    ]

    /// A package of the current offering, as the gateway reads it.
    struct Candidate: Sendable, Equatable {
        let packageId: String
        let productId: String
    }

    /// The plan each candidate sells, keyed by plan id. Products the server
    /// does not know are skipped (it could not grant them). When two
    /// packages sell the same plan, the one whose package id is the plan id
    /// wins, else the first.
    static func match(_ candidates: [Candidate]) -> [String: Candidate] {
        var found: [String: Candidate] = [:]
        for candidate in candidates {
            guard let plan = productPlans[candidate.productId] else { continue }
            if found[plan] == nil || (candidate.packageId == plan && found[plan]?.packageId != plan) {
                found[plan] = candidate
            }
        }
        return found
    }
}
