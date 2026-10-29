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
        ]
        for (color, light, dark) in pairs {
            assertResolves(color, in: .light, to: light)
            assertResolves(color, in: .dark, to: dark)
        }
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
