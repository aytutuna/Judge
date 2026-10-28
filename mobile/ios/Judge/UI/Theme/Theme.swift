import SwiftUI

/// Ivory & Terracotta palette (lib/palette.ts). Opaque colours as 0xRRGGBB;
/// a unit test pins every value against display-vectors.json.
enum PaletteHex {
    static let ivory: UInt32 = 0xF6F1E9
    static let ivory2: UInt32 = 0xEEE6D9
    static let paper: UInt32 = 0xFFFCF7
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
    static let stone: UInt32 = 0xD6C7B0
    static let strata: UInt32 = 0xE6DCCB
    static let danger: UInt32 = 0xB3261E

    static let all: [String: UInt32] = [
        "ivory": ivory, "ivory2": ivory2, "paper": paper, "ink": ink, "ink2": ink2, "muted": muted,
        "placeholder": placeholder, "terra": terra, "terraInk": terraInk, "terraTint": terraTint,
        "sage": sage, "sageStrong": sageStrong, "sageInk": sageInk, "sageTint": sageTint,
        "stone": stone, "strata": strata, "danger": danger,
    ]

    /// Translucent ink lines as (alpha) over rgb(28, 25, 22), as in globals.css.
    static let lineAlpha = 0.09
    static let line2Alpha = 0.14
}

enum Brand {
    static let ivory = Color(hex: PaletteHex.ivory)
    static let ivory2 = Color(hex: PaletteHex.ivory2)
    static let paper = Color(hex: PaletteHex.paper)
    static let ink = Color(hex: PaletteHex.ink)
    static let ink2 = Color(hex: PaletteHex.ink2)
    static let muted = Color(hex: PaletteHex.muted)
    static let placeholder = Color(hex: PaletteHex.placeholder)
    static let terra = Color(hex: PaletteHex.terra)
    static let terraInk = Color(hex: PaletteHex.terraInk)
    static let terraTint = Color(hex: PaletteHex.terraTint)
    static let sage = Color(hex: PaletteHex.sage)
    static let sageStrong = Color(hex: PaletteHex.sageStrong)
    static let sageInk = Color(hex: PaletteHex.sageInk)
    static let sageTint = Color(hex: PaletteHex.sageTint)
    static let stone = Color(hex: PaletteHex.stone)
    static let strata = Color(hex: PaletteHex.strata)
    static let danger = Color(hex: PaletteHex.danger)
    static let line = Color(hex: PaletteHex.ink, opacity: PaletteHex.lineAlpha)
    static let line2 = Color(hex: PaletteHex.ink, opacity: PaletteHex.line2Alpha)
    /// The dashed crux border and map connectors.
    static let dash = Color(hex: PaletteHex.ink, opacity: 0.28)
    /// Warm shadow colour, rgba(60, 40, 20, a).
    static func shadow(_ opacity: Double) -> Color { Color(red: 60 / 255, green: 40 / 255, blue: 20 / 255, opacity: opacity) }
}

extension Color {
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
        shadow(color: Brand.shadow(0.04), radius: 2, y: 2)
            .shadow(color: Brand.shadow(0.16), radius: 30, y: 24)
    }

    /// `--shadow-1`.
    func softShadow() -> some View {
        shadow(color: Brand.shadow(0.05), radius: 1, y: 1)
            .shadow(color: Brand.shadow(0.06), radius: 12, y: 8)
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
