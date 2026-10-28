import Foundation

/// Build-time configuration. Config/Debug.xcconfig and Config/Release.xcconfig
/// fill the `Judge*` keys of Info.plist; this reads them once at launch.
struct AppConfig: Sendable, Equatable {
    /// Origin of the JSON API (no trailing slash), e.g. https://okjudge.com.
    let apiBaseURL: URL
    /// Origin used for share links (`/v/<id>`); defaults to the API origin.
    let shareBaseURL: URL
    let version: String
    let build: String
    /// Public RevenueCat SDK key. Empty means no in-app purchases.
    var revenueCatAPIKey: String = ""

    /// TestFlight and sandbox builds (and Debug), never the App Store.
    static var isTestFlight: Bool {
        #if DEBUG
        true
        #else
        Bundle.main.appStoreReceiptURL?.lastPathComponent == "sandboxReceipt"
        #endif
    }

    static let production: URL = {
        guard let url = URL(string: "https://okjudge.com") else { preconditionFailure("invalid production URL") }
        return url
    }()

    static func load(from bundle: Bundle = .main) -> AppConfig {
        let info = bundle.infoDictionary ?? [:]
        func value(_ key: String) -> String {
            (info[key] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        }
        let api = parseOrigin(value("JudgeAPIBaseURL")) ?? production
        let share = parseOrigin(value("JudgeShareBaseURL")) ?? api
        return AppConfig(
            apiBaseURL: api,
            shareBaseURL: share,
            version: value("CFBundleShortVersionString").isEmpty ? "0" : value("CFBundleShortVersionString"),
            build: value("CFBundleVersion").isEmpty ? "0" : value("CFBundleVersion"),
            revenueCatAPIKey: publicKey(value("JudgeRevenueCatAPIKey"))
        )
    }

    /// A key from Info.plist, or empty when the setting was left blank or
    /// never expanded (`$(REVENUECAT_API_KEY)`).
    static func publicKey(_ raw: String) -> String {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        return text.contains("$(") ? "" : text
    }

    /// An http(s) origin without a trailing slash, or nil for empty,
    /// unexpanded (`$(API_BASE_URL)`) or malformed values.
    static func parseOrigin(_ raw: String) -> URL? {
        var text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        while text.hasSuffix("/") { text.removeLast() }
        guard !text.isEmpty, !text.contains("$("),
              let url = URL(string: text),
              let scheme = url.scheme?.lowercased(), scheme == "https" || scheme == "http",
              let host = url.host, !host.isEmpty
        else { return nil }
        return url
    }

    /// `{SHARE_BASE_URL}/v/<id>`.
    func shareURL(id: String) -> URL {
        shareBaseURL.appending(path: "v").appending(component: id)
    }

    /// Pages on the website the app links to instead of showing.
    func siteURL(_ path: String) -> URL {
        shareBaseURL.appending(path: path)
    }

    var userAgent: String { "Judge-iOS/\(version) (\(build))" }
}
