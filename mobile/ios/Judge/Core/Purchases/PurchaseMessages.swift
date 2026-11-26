import Foundation

extension PurchaseModel.Message {
    func text(_ lang: AppLang) -> String {
        switch self {
        case .success: return L10n.appPurchaseSuccess(lang)
        case .pending: return L10n.appPurchasePending(lang)
        case .failed, .checking: return L10n.appPurchaseFailed(lang)
        case .ageRequired: return L10n.errorAgeUnconfirmed(lang)
        case .ageBlocked: return L10n.errorAgeBlocked(lang)
        }
    }

    var isProblem: Bool { self == .failed || self == .checking || self == .ageRequired || self == .ageBlocked }
}

extension PurchaseModel.RestoreResult {
    func text(_ lang: AppLang) -> String {
        switch self {
        case .done: return L10n.appPurchaseRestoreDone(lang)
        case .nothing: return L10n.appPurchaseRestoreNone(lang)
        case .failed: return L10n.appPurchaseFailed(lang)
        }
    }
}
