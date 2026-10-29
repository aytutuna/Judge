import SwiftUI
import UIKit

/// Ivory & Terracotta palette (lib/palette.ts). Opaque colours as 0xRRGGBB;
/// a unit test pins every value against display-vectors.json.
enum PaletteHex {
    static let ivory: UInt32 = 0xFFFFFF
    static let ivory2: UInt32 = 0xF2F0EC
    static let paper: UInt32 = 0xFFFFFF
    static let ink: UInt32 = 0x1C1916
    static let ink2: UInt32 = 0x4A433C
    static let muted: UInt32 = 0x6B6258
    static let placeholder: UInt32 = 0x776D61
    static let terra: UInt32 = 0xC8553D
    static let terraInk: UInt32 = 0xA9442F
    static let terraTint: UInt32 = 0xF3DDD5
    static let sage: UInt32 = 0x8AA899
    static let sageStrong: UInt32 = 0x6E8F80
    static let sageInk: UInt32 = 0x4C6B5D
    static let sageTint: UInt32 = 0xDDE7E0
    static let stone: UInt32 = 0xDAD6CF
    static let strata: UInt32 = 0xE9E6E1
    static let danger: UInt32 = 0xB3261E

    static let all: [String: UInt32] = [
        "ivory": ivory, "ivory2": ivory2, "paper": paper, "ink": ink, "ink2": ink2, "muted": muted,
        "placeholder": placeholder, "terra": terra, "terraInk": terraInk, "terraTint": terraTint,
        "sage": sage, "sageStrong": sageStrong, "sageInk": sageInk, "sageTint": sageTint,
        "stone": stone, "strata": strata, "danger": danger,
    ]

    /// Translucent ink lines as (alpha) over rgb(28, 25, 22), as in globals.css.
    static let lineAlpha = 0.1
    static let line2Alpha = 0.14

    /// PALETTE_DARK: the same roles, copied as they are (the tints are not a
    /// plain mix of their accent).
    enum Dark {
        static let ivory: UInt32 = 0x15120F
        static let ivory2: UInt32 = 0x27231F
        static let paper: UInt32 = 0x1D1A17
        static let ink: UInt32 = 0xF1EBE1
        static let ink2: UInt32 = 0xCFC6BA
        static let muted: UInt32 = 0xA89E92
        static let placeholder: UInt32 = 0x9A9084
        static let terra: UInt32 = 0xD9694F
        static let terraInk: UInt32 = 0xEE8C74
        static let terraTint: UInt32 = 0x432A22
        static let sage: UInt32 = 0x7F9C8E
        static let sageStrong: UInt32 = 0x8FB0A0
        static let sageInk: UInt32 = 0xA3C2B3
        static let sageTint: UInt32 = 0x2D3832
        static let stone: UInt32 = 0x4F463C
        static let strata: UInt32 = 0x3A342E
        static let danger: UInt32 = 0xF5727E

        static let all: [String: UInt32] = [
            "ivory": ivory, "ivory2": ivory2, "paper": paper, "ink": ink, "ink2": ink2, "muted": muted,
            "placeholder": placeholder, "terra": terra, "terraInk": terraInk, "terraTint": terraTint,
            "sage": sage, "sageStrong": sageStrong, "sageInk": sageInk, "sageTint": sageTint,
            "stone": stone, "strata": strata, "danger": danger,
        ]

        /// Lines are the dark ink, rgb(241, 235, 225), a touch stronger.
        static let lineAlpha = 0.1
        static let line2Alpha = 0.16
    }
}

/// Every colour follows the light or dark appearance (the system's, or the
/// one picked in Settings).
enum Brand {
    static let ivory = Color(light: PaletteHex.ivory, dark: PaletteHex.Dark.ivory)
    static let ivory2 = Color(light: PaletteHex.ivory2, dark: PaletteHex.Dark.ivory2)
    static let paper = Color(light: PaletteHex.paper, dark: PaletteHex.Dark.paper)
    static let ink = Color(light: PaletteHex.ink, dark: PaletteHex.Dark.ink)
    static let ink2 = Color(light: PaletteHex.ink2, dark: PaletteHex.Dark.ink2)
    static let muted = Color(light: PaletteHex.muted, dark: PaletteHex.Dark.muted)
    static let placeholder = Color(light: PaletteHex.placeholder, dark: PaletteHex.Dark.placeholder)
    static let terra = Color(light: PaletteHex.terra, dark: PaletteHex.Dark.terra)
    static let terraInk = Color(light: PaletteHex.terraInk, dark: PaletteHex.Dark.terraInk)
    static let terraTint = Color(light: PaletteHex.terraTint, dark: PaletteHex.Dark.terraTint)
    static let sage = Color(light: PaletteHex.sage, dark: PaletteHex.Dark.sage)
    static let sageStrong = Color(light: PaletteHex.sageStrong, dark: PaletteHex.Dark.sageStrong)
    static let sageInk = Color(light: PaletteHex.sageInk, dark: PaletteHex.Dark.sageInk)
    static let sageTint = Color(light: PaletteHex.sageTint, dark: PaletteHex.Dark.sageTint)
    static let stone = Color(light: PaletteHex.stone, dark: PaletteHex.Dark.stone)
    static let strata = Color(light: PaletteHex.strata, dark: PaletteHex.Dark.strata)
    static let danger = Color(light: PaletteHex.danger, dark: PaletteHex.Dark.danger)
    static let line = Color(
        light: UIColor(hex: PaletteHex.ink, alpha: PaletteHex.lineAlpha),
        dark: UIColor(hex: PaletteHex.Dark.ink, alpha: PaletteHex.Dark.lineAlpha)
    )
    static let line2 = Color(
        light: UIColor(hex: PaletteHex.ink, alpha: PaletteHex.line2Alpha),
        dark: UIColor(hex: PaletteHex.Dark.ink, alpha: PaletteHex.Dark.line2Alpha)
    )
    /// The dashed crux border and map connectors.
    static let dash = ink.opacity(0.28)
    /// `--paper-hi`: a pressed paper button, white in light, a step up in dark.
    static let paperHi = Color(light: 0xFFFFFF, dark: PaletteHex.Dark.ivory2)
    /// `--well`: a fill sunk into a paper card. Page and paper are both white
    /// in light, so it can't be the page colour there.
    static let well = Color(light: PaletteHex.ivory2, dark: PaletteHex.Dark.ivory)

    /// Warm brown shadows, rgba(60, 40, 20, a), vanish on dark, so there they
    /// go black and deeper (`--shadow-*` in globals.css).
    static func shadow(_ light: Double, dark: Double) -> Color {
        Color(light: UIColor(red: 60 / 255, green: 40 / 255, blue: 20 / 255, alpha: light), dark: UIColor(white: 0, alpha: dark))
    }
}

extension UIColor {
    convenience init(hex: UInt32, alpha: Double = 1) {
        self.init(
            red: CGFloat((hex >> 16) & 0xFF) / 255,
            green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255,
            alpha: alpha
        )
    }
}

extension Color {
    init(light: UIColor, dark: UIColor) {
        self.init(uiColor: UIColor { $0.userInterfaceStyle == .dark ? dark : light })
    }

    init(light: UInt32, dark: UInt32) {
        self.init(light: UIColor(hex: light), dark: UIColor(hex: dark))
    }

    init(hex: UInt32, opacity: Double = 1) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: opacity
        )
    }
}

/// Corner radii (globals.css).
enum Radius {
    static let field: CGFloat = 18
    static let block: CGFloat = 22
    static let card: CGFloat = 28
    static let verdict: CGFloat = 30
}

extension View {
    /// `--shadow-card`: a soft, warm, far-reaching shadow.
    func cardShadow() -> some View {
        shadow(color: Brand.shadow(0.04, dark: 0.2), radius: 2, y: 2)
            .shadow(color: Brand.shadow(0.16, dark: 0.4), radius: 30, y: 24)
    }

    /// `--shadow-1`.
    func softShadow() -> some View {
        shadow(color: Brand.shadow(0.05, dark: 0.3), radius: 1, y: 1)
            .shadow(color: Brand.shadow(0.06, dark: 0.24), radius: 12, y: 8)
    }

    /// A paper surface with a hairline border.
    func paperSurface(radius: CGFloat, fill: Color = Brand.paper, border: Color = Brand.line) -> some View {
        background(RoundedRectangle(cornerRadius: radius, style: .continuous).fill(fill))
            .overlay(RoundedRectangle(cornerRadius: radius, style: .continuous).strokeBorder(border, lineWidth: 1))
    }
}

/// Motion tokens.
enum Motion {
    static let ease = Animation.timingCurve(0.2, 0.7, 0.1, 1, duration: 0.4)
    static let spring = Animation.spring(response: 0.55, dampingFraction: 0.62)
}
