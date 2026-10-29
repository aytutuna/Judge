import SwiftUI
import XCTest
@testable import Judge

final class ThemeTests: XCTestCase {
    func testDarkPaletteHasEveryColour() {
        XCTAssertEqual(Set(PaletteHex.Dark.all.keys), Set(PaletteHex.all.keys))
    }

    func testBrandColoursFollowTheColorScheme() {
        let pairs: [(Color, UInt32, UInt32)] = [
            (Brand.ivory, PaletteHex.ivory, PaletteHex.Dark.ivory),
            (Brand.paper, PaletteHex.paper, PaletteHex.Dark.paper),
            (Brand.ink, PaletteHex.ink, PaletteHex.Dark.ink),
            (Brand.terraInk, PaletteHex.terraInk, PaletteHex.Dark.terraInk),
            (Brand.sageTint, PaletteHex.sageTint, PaletteHex.Dark.sageTint),
            (Brand.well, PaletteHex.ivory2, PaletteHex.Dark.ivory),
        ]
        for (color, light, dark) in pairs {
            assertResolves(color, in: .light, to: light)
            assertResolves(color, in: .dark, to: dark)
        }
    }

    func testStoredAppearanceFallsBackToThePhone() {
        XCTAssertEqual(Appearance(stored: "dark"), .dark)
        XCTAssertEqual(Appearance(stored: "light"), .light)
        XCTAssertEqual(Appearance(stored: "system"), .system)
        XCTAssertEqual(Appearance(stored: nil), .system)
        XCTAssertEqual(Appearance(stored: "sepia"), .system)
        XCTAssertNil(Appearance.system.colorScheme)
        XCTAssertEqual(Appearance.dark.colorScheme, .dark)
    }

    @MainActor
    func testTheAppearanceIsSavedAndReadBack() throws {
        let config = AppConfig(apiBaseURL: AppConfig.production, shareBaseURL: AppConfig.production, version: "1", build: "1")
        let defaults = try XCTUnwrap(UserDefaults(suiteName: "judge.tests.\(UUID().uuidString)"))
        defaults.set("dark", forKey: "settings.appearance")
        let app = AppModel(config: config, container: HistoryContainer.inMemory(), defaults: defaults, tokenStore: MemoryTokenStore(), persistsDraft: false, caseNames: MemoryCaseNamesStore())
        XCTAssertEqual(app.appearance, .dark)
        app.setAppearance(.light)
        XCTAssertEqual(defaults.string(forKey: "settings.appearance"), "light")
        app.setAppearance(.system)
        XCTAssertEqual(defaults.string(forKey: "settings.appearance"), "system")
    }

    private func assertResolves(_ color: Color, in scheme: ColorScheme, to hex: UInt32, line: UInt = #line) {
        var environment = EnvironmentValues()
        environment.colorScheme = scheme
        let got = color.resolve(in: environment)
        let want = Color(hex: hex).resolve(in: environment)
        XCTAssertEqual(got.red, want.red, accuracy: 0.002, "\(scheme) \(String(hex, radix: 16))", line: line)
        XCTAssertEqual(got.green, want.green, accuracy: 0.002, "\(scheme) \(String(hex, radix: 16))", line: line)
        XCTAssertEqual(got.blue, want.blue, accuracy: 0.002, "\(scheme) \(String(hex, radix: 16))", line: line)
    }
}
