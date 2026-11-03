import CoreText
import SwiftUI
import UIKit

/// The bundled faces (Resources/Fonts, registered through UIAppFonts).
/// Inter and Inter Tight are variable fonts: the weight (and Inter's
/// optical size) is set through the font variation attribute, because
/// `Font.custom` alone does not reliably pick variable-font weights.
enum BrandFace: Sendable {
    case inter, interTight, serif, serifItalic

    var postScriptName: String {
        switch self {
        case .inter: return "Inter-Regular"
        case .interTight: return "InterTight-Regular"
        case .serif: return "InstrumentSerif-Regular"
        case .serifItalic: return "InstrumentSerif-Italic"
        }
    }

    var familyName: String {
        switch self {
        case .inter: return "Inter"
        case .interTight: return "Inter Tight"
        case .serif, .serifItalic: return "Instrument Serif"
        }
    }

    var isVariable: Bool { self == .inter || self == .interTight }
}

/// The Dynamic Type curve a style scales with.
enum TextRole: Sendable {
    case largeTitle, title1, title2, title3, headline, body, subheadline, footnote, caption2

    var uiTextStyle: UIFont.TextStyle {
        switch self {
        case .largeTitle: return .largeTitle
        case .title1: return .title1
        case .title2: return .title2
        case .title3: return .title3
        case .headline: return .headline
        case .body: return .body
        case .subheadline: return .subheadline
        case .footnote: return .footnote
        case .caption2: return .caption2
        }
    }
}

/// One entry of the type scale (MOBILE_DESIGN.md §8.2).
struct TypeStyle: Sendable {
    var face: BrandFace
    var weight: Double
    var size: CGFloat
    /// Line height as a multiple of the size.
    var lineHeight: CGFloat
    /// Tracking in em.
    var tracking: CGFloat = 0
    var textStyle: TextRole = .body
    /// Largest Dynamic Type scale factor; display sizes are capped at 1.3x.
    var maxScale: CGFloat = 2.2
    var uppercase = false

    static let display1 = TypeStyle(face: .interTight, weight: 700, size: 44, lineHeight: 0.98, tracking: -0.04, textStyle: .largeTitle, maxScale: 1.3)
    static let lead = TypeStyle(face: .inter, weight: 400, size: 17, lineHeight: 1.5)
    static let body = TypeStyle(face: .inter, weight: 400, size: 16, lineHeight: 1.5)
    static let bodyMedium = TypeStyle(face: .inter, weight: 500, size: 15, lineHeight: 1.5)
    static let slotTitle = TypeStyle(face: .inter, weight: 600, size: 14, lineHeight: 1.35, textStyle: .subheadline)
    static let slotText = TypeStyle(face: .inter, weight: 400, size: 13, lineHeight: 1.45, textStyle: .footnote)
    static let footnote = TypeStyle(face: .inter, weight: 400, size: 12.5, lineHeight: 1.5, textStyle: .footnote)
    static let micro = TypeStyle(face: .inter, weight: 700, size: 11, lineHeight: 1.3, tracking: 0.12, textStyle: .caption2, maxScale: 1.6, uppercase: true)
    static let button = TypeStyle(face: .interTight, weight: 600, size: 16, lineHeight: 1.2, textStyle: .headline, maxScale: 1.6)
    static let chip = TypeStyle(face: .inter, weight: 600, size: 14, lineHeight: 1.2, textStyle: .subheadline, maxScale: 1.8)
    static let brand = TypeStyle(face: .interTight, weight: 600, size: 17, lineHeight: 1, tracking: -0.01, textStyle: .headline, maxScale: 1.4)
    static let claim = TypeStyle(face: .inter, weight: 400, size: 14, lineHeight: 1.45, textStyle: .subheadline)
    static let branch = TypeStyle(face: .inter, weight: 400, size: 14.5, lineHeight: 1.5, textStyle: .subheadline)
    /// The verdict headline; the card sets the size between 30 and 34 by width.
    static let ruling = TypeStyle(face: .serif, weight: 400, size: 32, lineHeight: 1.05, textStyle: .title1, maxScale: 1.3)
    /// Italic serif labels: the case card's date and the verdict's section titles.
    static let serifLabel = TypeStyle(face: .serifItalic, weight: 400, size: 16, lineHeight: 1.25, textStyle: .subheadline, maxScale: 1.6)
}

@MainActor
enum BrandFont {
    /// OpenType axis tags as four-character codes.
    private static let weightAxis: UInt32 = 0x7767_6874 // 'wght'
    private static let opticalSizeAxis: UInt32 = 0x6F70_737A // 'opsz'

    /// A UIFont for `style`, scaled for `sizeCategory` with the style's cap.
    /// Falls back to the system font when a bundled face is missing.
    static func uiFont(_ style: TypeStyle, sizeCategory: UIContentSizeCategory) -> UIFont {
        let base = unscaled(style.face, weight: style.weight, size: style.size)
        let traits = UITraitCollection(preferredContentSizeCategory: sizeCategory)
        return UIFontMetrics(forTextStyle: style.textStyle.uiTextStyle)
            .scaledFont(for: base, maximumPointSize: style.size * style.maxScale, compatibleWith: traits)
    }

    static func unscaled(_ face: BrandFace, weight: Double, size: CGFloat) -> UIFont {
        var descriptor = UIFontDescriptor(name: face.postScriptName, size: size)
        if face.isVariable {
            var axes: [NSNumber: NSNumber] = [NSNumber(value: weightAxis): NSNumber(value: weight)]
            if face == .inter {
                axes[NSNumber(value: opticalSizeAxis)] = NSNumber(value: Double(min(32, max(14, size))))
            }
            let variation = UIFontDescriptor.AttributeName(rawValue: kCTFontVariationAttribute as String)
            descriptor = descriptor.addingAttributes([variation: axes])
        }
        let font = UIFont(descriptor: descriptor, size: size)
        guard font.familyName == face.familyName else {
            return UIFont.systemFont(ofSize: size, weight: systemWeight(weight))
        }
        return font
    }

    private static func systemWeight(_ weight: Double) -> UIFont.Weight {
        switch weight {
        case ..<350: return .light
        case ..<450: return .regular
        case ..<550: return .medium
        case ..<650: return .semibold
        case ..<750: return .bold
        default: return .heavy
        }
    }
}

private struct BrandTextModifier: ViewModifier {
    let style: TypeStyle
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.locale) private var locale

    func body(content: Content) -> some View {
        let font = BrandFont.uiFont(style, sizeCategory: UIContentSizeCategory(dynamicTypeSize))
        let extraLeading = max(0, style.lineHeight * font.pointSize - font.lineHeight)
        // Letter-spacing breaks the joins of Arabic, the headline bar of the
        // Indic scripts and the marks of Thai; off there, as on the web.
        let tracks = AppLang(languageTag: locale.identifier)?.tracks ?? true
        content
            .font(Font(font as CTFont))
            .tracking(tracks ? style.tracking * font.pointSize : 0)
            .lineSpacing(extraLeading)
            .textCase(style.uppercase ? .uppercase : nil)
    }
}

extension View {
    /// Sets a brand type style (font, tracking, line height, Dynamic Type).
    func brandText(_ style: TypeStyle) -> some View {
        modifier(BrandTextModifier(style: style))
    }
}
