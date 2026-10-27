import SwiftUI

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
