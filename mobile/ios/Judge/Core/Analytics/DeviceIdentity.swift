import Foundation
import UIKit

/// The ids the server sees from this install: the device id (sign-in and
/// events) and a random anon id made once per install for signed-out events.
@MainActor
enum DeviceIdentity {
    private static let deviceKey = "device.id"
    private static let anonKey = "analytics.anonId"

    /// identifierForVendor, or an id kept from the first launch it was nil
    /// (it can be right after a restart, before the first unlock).
    static func deviceID(_ defaults: UserDefaults) -> String {
        if let vendor = UIDevice.current.identifierForVendor { return vendor.uuidString }
        return stored(deviceKey, defaults)
    }

    static func anonID(_ defaults: UserDefaults) -> String {
        stored(anonKey, defaults)
    }

    private static func stored(_ key: String, _ defaults: UserDefaults) -> String {
        if let id = defaults.string(forKey: key), UUID(uuidString: id) != nil { return id }
        let id = UUID().uuidString.lowercased()
        defaults.set(id, forKey: key)
        return id
    }

    /// The hardware identifier (iPhone15,2); the simulated one on the simulator.
    static var model: String {
        if let simulated = ProcessInfo.processInfo.environment["SIMULATOR_MODEL_IDENTIFIER"] { return simulated }
        var info = utsname()
        uname(&info)
        return withUnsafeBytes(of: &info.machine) { raw in
            String(decoding: raw.prefix { $0 != 0 }, as: UTF8.self)
        }
    }

    static func context(config: AppConfig, defaults: UserDefaults, deviceID: String) -> AnalyticsContext {
        let locale = Locale.current.identifier(.bcp47)
        return AnalyticsContext(
            appVersion: token("\(config.version)_\(config.build)", max: 32) ?? "0",
            anonID: anonID(defaults),
            deviceID: deviceID,
            osVersion: token(UIDevice.current.systemVersion, max: 32),
            deviceModel: token(model, max: 64),
            locale: locale.range(of: #"^[A-Za-z]{2,3}([_-][0-9A-Za-z]{2,8}){0,3}$"#, options: .regularExpression) != nil ? locale : nil
        )
    }

    /// `text` in the server's token set: anything outside it becomes "_"
    /// (iPhone15,2 is sent as iPhone15_2), cut to `max`; nil when empty.
    static func token(_ text: String, max: Int) -> String? {
        let kept = String(text.replacingOccurrences(of: "[^A-Za-z0-9_.:/-]", with: "_", options: .regularExpression).prefix(max))
        return kept.isEmpty ? nil : kept
    }
}
