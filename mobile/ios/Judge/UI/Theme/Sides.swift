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
/// lib/palette.ts). Only the other side of a two-sided case is `.b`: the
/// writer of a one-person verdict wrote Party A as themselves, and when
/// nobody is known Party A is whoever started it.
struct Sides: Equatable, Sendable {
    let you: Party
    let a: SideColors
    let b: SideColors

    init(you: Party?) {
        if you == .b {
            self.you = .b
            a = Self.red
            b = Self.green
        } else {
            self.you = .a
            a = Self.green
            b = Self.red
        }
    }

    func of(_ party: Party) -> SideColors { party == .b ? b : a }

    var mine: SideColors { of(you) }
    var theirs: SideColors { you == .b ? a : b }

    private static let green = SideColors(fill: Brand.sage, strong: Brand.sageStrong, ink: Brand.sageInk, tint: Brand.sageTint)
    private static let red = SideColors(fill: Brand.terra, strong: Brand.terra, ink: Brand.terraInk, tint: Brand.terraTint)
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
