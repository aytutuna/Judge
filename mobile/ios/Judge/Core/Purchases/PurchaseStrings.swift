import Foundation

/// Copy for in-app purchases. Temporary: these move to the shared strings
/// exporter (mobile/shared/strings) and come back through L10n with the next
/// string export.
enum PurchaseStrings {
    static func buying(_ lang: AppLang) -> String {
        lang == .tr ? "Satın alınıyor…" : "Buying…"
    }

    static func success(_ lang: AppLang) -> String {
        lang == .tr ? "Teşekkürler! Satın alma tamamlandı." : "Thanks! Your purchase went through."
    }

    static func pending(_ lang: AppLang) -> String {
        lang == .tr
            ? "Satın alman işleniyor. Hesabına yansıması bir dakika sürebilir."
            : "Your purchase is being processed. It may take a minute to show up."
    }

    static func failed(_ lang: AppLang) -> String {
        lang == .tr
            ? "Satın alma tamamlanamadı. Birazdan tekrar dene."
            : "The purchase didn't go through. Try again in a moment."
    }

    static func restore(_ lang: AppLang) -> String {
        lang == .tr ? "Satın alımları geri yükle" : "Restore purchases"
    }

    static func restoreDone(_ lang: AppLang) -> String {
        lang == .tr ? "Satın alımların geri yüklendi." : "Your purchases were restored."
    }

    static func restoreNone(_ lang: AppLang) -> String {
        lang == .tr ? "Geri yüklenecek bir satın alım bulunamadı." : "No purchases to restore."
    }
}

extension PurchaseModel.Message {
    func text(_ lang: AppLang) -> String {
        switch self {
        case .success: return PurchaseStrings.success(lang)
        case .pending: return PurchaseStrings.pending(lang)
        case .failed: return PurchaseStrings.failed(lang)
        }
    }
}

extension PurchaseModel.RestoreResult {
    func text(_ lang: AppLang) -> String {
        switch self {
        case .done: return PurchaseStrings.restoreDone(lang)
        case .nothing: return PurchaseStrings.restoreNone(lang)
        case .failed: return PurchaseStrings.failed(lang)
        }
    }
}
