import SwiftUI

/// One side's colours: `fill` for large areas, `strong` for thin marks that
/// need 3:1, `ink` for text and behind a white letter, `tint` behind text.
struct SideColors: Equatable, Sendable {
    let fill: Color
    let strong: Color
    let ink: Color
    let tint: Color
}

/// The viewer's own side green, the other red (sideColors in
/// lib/palette.ts). Sides C and D of a case with more than two sides are blue
/// and violet; whoever is looking is still green, and their letter's usual
/// colour moves to Party A, as Party B does in a two-sided case. Only the
/// other side of a two-sided case is `.b`: the writer of a one-person verdict
/// wrote Party A as themselves, and when nobody is known Party A is whoever
/// started it.
struct Sides: Equatable, Sendable {
    let you: Party
    let a: SideColors
    let b: SideColors
    let c: SideColors
    let d: SideColors

    init(you: Party?) {
        switch you {
        case .b:
            self.you = .b
            a = Self.red
            b = Self.green
            c = Self.blue
            d = Self.violet
        case .c:
            self.you = .c
            a = Self.blue
            b = Self.red
            c = Self.green
            d = Self.violet
        case .d:
            self.you = .d
            a = Self.violet
            b = Self.red
            c = Self.blue
            d = Self.green
        default:
            self.you = .a
            a = Self.green
            b = Self.red
            c = Self.blue
            d = Self.violet
        }
    }

    func of(_ party: Party) -> SideColors {
        switch party {
        case .a: return a
        case .b: return b
        case .c: return c
        case .d: return d
        case .unknown: return Self.neutral
        }
    }

    var mine: SideColors { of(you) }
    var theirs: SideColors { you == .b ? a : b }

    private static let green = SideColors(fill: Brand.sage, strong: Brand.sageStrong, ink: Brand.sageInk, tint: Brand.sageTint)
    private static let red = SideColors(fill: Brand.terra, strong: Brand.terra, ink: Brand.terraInk, tint: Brand.terraTint)
    private static let blue = SideColors(
        fill: Color(light: 0x3F7CC4, dark: 0x5C97DB),
        strong: Color(light: 0x3F7CC4, dark: 0x5C97DB),
        ink: Color(light: 0x2B5F9E, dark: 0x9CC2F2),
        tint: Color(light: 0xDDE8F6, dark: 0x1F3047)
    )
    private static let violet = SideColors(
        fill: Color(light: 0x8B63C4, dark: 0xA07FD6),
        strong: Color(light: 0x8B63C4, dark: 0xA07FD6),
        ink: Color(light: 0x6B459F, dark: 0xC9ADF0),
        tint: Color(light: 0xE9DFF5, dark: 0x31264A)
    )
    private static let neutral = SideColors(fill: Brand.stone, strong: Brand.muted, ink: Brand.ink2, tint: Brand.well)
}

extension EnvironmentValues {
    /// Set by the case screen for the respondent; everything else draws
    /// Party A green.
    var sides: Sides {
        get { self[SidesKey.self] }
        set { self[SidesKey.self] = newValue }
    }
}

private struct SidesKey: EnvironmentKey {
    static let defaultValue = Sides(you: .a)
}
