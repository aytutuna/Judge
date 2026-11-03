import Foundation

extension AppLang {
    /// The language a BCP-47 tag means, as lib/langs.ts langOfTag reads it:
    /// Chinese goes by script, then region; Portuguese is Brazilian unless
    /// another region is given; every Norwegian tag means Bokmål.
    init?(languageTag: String) {
        let parts = languageTag.trimmingCharacters(in: .whitespaces).lowercased()
            .split(whereSeparator: { $0 == "-" || $0 == "_" }).map(String.init)
        guard let base = parts.first else { return nil }
        let rest = parts.dropFirst()
        switch base {
        case "zh":
            let traditional = rest.contains("hant") || rest.contains { ["tw", "hk", "mo"].contains($0) }
            self = !rest.contains("hans") && traditional ? .zhHant : .zhHans
        case "pt":
            self = rest.isEmpty || rest.contains("br") ? .ptBR : .ptPT
        case "no", "nn", "nb":
            self = .nb
        default:
            guard let lang = AppLang(rawValue: base) else { return nil }
            self = lang
        }
    }

    /// The first preferred language the app speaks, else English (matchLang).
    static func match(_ preferred: [String]) -> AppLang {
        for tag in preferred {
            if let lang = AppLang(languageTag: tag), enabled.contains(lang) { return lang }
        }
        return .en
    }

    /// The name of `self` in the words of `ui` ("Turkish", "İngilizce").
    /// English and Turkish have their own strings, the rest come from the
    /// system (languageName in lib/i18n.ts).
    func name(in ui: AppLang) -> String {
        switch self {
        case .en: return L10n.respondLangEn(ui)
        case .tr: return L10n.respondLangTr(ui)
        default: return ui.locale.localizedString(forIdentifier: rawValue) ?? nativeName
        }
    }
}
