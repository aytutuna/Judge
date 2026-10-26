import SwiftUI

/// What the user wrote, right-aligned like a sent message (thread.module.css .bubble).
struct ArgumentBubble: View {
    let text: String
    let lang: AppLang

    var body: some View {
        Text(text)
            .brandText(TypeStyle(face: .inter, weight: 400, size: 14, lineHeight: 1.55, textStyle: .subheadline))
            .foregroundStyle(Brand.ink)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .background(
                UnevenRoundedRectangle(topLeadingRadius: 22, bottomLeadingRadius: 22, bottomTrailingRadius: 6, topTrailingRadius: 22, style: .continuous)
                    .fill(Brand.ivory2)
            )
            .padding(.leading, 48)
            .frame(maxWidth: .infinity, alignment: .trailing)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(L10n.threadYou(lang) + ": " + text)
    }
}

/// "The judges" over their side of the thread, or how far they agreed (.who).
struct JudgesBadge: View {
    let label: String

    var body: some View {
        HStack(spacing: 8) {
            BrandMark(width: 22)
                .padding(.vertical, 3)
            Text(label)
                .brandText(TypeStyle(face: .interTight, weight: 700, size: 13, lineHeight: 1.2, tracking: -0.01, textStyle: .footnote, maxScale: 1.8))
                .foregroundStyle(Brand.terraInk)
        }
        .padding(.leading, 6)
        .padding(.trailing, 12)
        .padding(.vertical, 5)
        .background(Capsule().fill(Brand.terraTint))
        .accessibilityElement(children: .combine)
    }
}
