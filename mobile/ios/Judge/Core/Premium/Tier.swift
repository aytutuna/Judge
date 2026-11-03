import Foundation

/// A case's tier. Every new verdict and case is premium; free ones are
/// cases from before that.
enum Tier: String, Sendable, CaseIterable {
    case free, premium
}

/// What is left to spend: the subscription's allowance first (it funds a
/// verdict before credits do), then credit packs. A new account's free
/// verdict is one credit.
enum Balance: Sendable, Equatable {
    case monthly(left: Int, cap: Int)
    case credits(Int)
    case empty

    init(_ entitlement: Entitlement) {
        if let sub = entitlement.subscription, sub.cap - sub.used > 0 {
            self = .monthly(left: sub.cap - sub.used, cap: sub.cap)
        } else if entitlement.credits > 0 {
            self = .credits(entitlement.credits)
        } else {
            self = .empty
        }
    }

    /// The line under "Get the verdict".
    func line(_ lang: AppLang) -> String {
        switch self {
        case .monthly(let left, let cap): return L10n.appBalanceMonthly(lang, left: String(left), cap: String(cap))
        case .credits(let n): return L10n.appBalanceLeft(lang, n: n)
        case .empty: return L10n.appBalanceNone(lang)
        }
    }
}
