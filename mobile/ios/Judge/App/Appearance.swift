import SwiftUI

/// The appearance setting: follow the phone, or always light or dark.
enum Appearance: String, CaseIterable, Sendable {
    case system, light, dark

    /// As stored; anything unknown follows the phone.
    init(stored: String?) {
        self = stored.flatMap(Appearance.init(rawValue:)) ?? .system
    }

    /// For `preferredColorScheme`; nil follows the phone.
    var colorScheme: ColorScheme? {
        switch self {
        case .system: return nil
        case .light: return .light
        case .dark: return .dark
        }
    }
}
