import SwiftUI

/// How a dragged card is let go: thrown past this speed or distance, else it
/// springs back. The same numbers as lib/card-throw.ts (points, milliseconds).
enum CardThrow {
    struct Sample {
        let x: Double
        let y: Double
        let t: Double
    }

    static let distance = 110.0
    /// Points per millisecond.
    static let speed = 0.7
    static let flickMinimum = 24.0
    static let windowMs = 100.0

    static func velocity(_ samples: [Sample]) -> CGVector {
        guard let last = samples.last,
              let first = samples.first(where: { last.t - $0.t <= windowMs }),
              last.t > first.t else { return .zero }
        let dt = last.t - first.t
        return CGVector(dx: (last.x - first.x) / dt, dy: (last.y - first.y) / dt)
    }

    static func isThrow(_ dx: Double, _ dy: Double, _ v: CGVector) -> Bool {
        let moved = hypot(dx, dy)
        return moved >= distance || (moved >= flickMinimum && hypot(v.dx, v.dy) >= speed)
    }

    /// Where a thrown card ends up, `reach` away from where it was let go.
    static func target(_ dx: Double, _ dy: Double, _ v: CGVector, reach: Double) -> CGSize {
        let fast = hypot(v.dx, v.dy) > 0.05
        let (ux, uy) = fast ? (v.dx, v.dy) : (dx, dy)
        let length = hypot(ux, uy)
        guard length > 0 else { return CGSize(width: dx, height: dy + reach) }
        return CGSize(width: dx + ux / length * reach, height: dy + uy / length * reach)
    }
}

/// Where each tile sits, in the judging screen's own space.
struct TileFrames: PreferenceKey {
    static let defaultValue: [Party: CGRect] = [:]
    static func reduce(value: inout [Party: CGRect], nextValue: () -> [Party: CGRect]) {
        value.merge(nextValue()) { $1 }
    }
}

private struct SizeKey: PreferenceKey {
    static let defaultValue: CGSize = .zero
    static func reduce(value: inout CGSize, nextValue: () -> CGSize) { value = nextValue() }
}

/// One side's full text as a card in the middle of the screen, grown from its
/// tile. The X, a tap on the dimmed background, or throwing the card closes
/// it; `onClosed` runs once it has gone.
struct SideCard: View {
    let side: HomeModel.JudgedSide
    let title: String
    let from: CGRect
    let container: CGSize
    let lang: AppLang
    let onClosed: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.sides) private var colors
    @AccessibilityFocusState private var focused: Bool
    @State private var shown = false
    @State private var gone = false
    @State private var closing = false
    @State private var size: CGSize = .zero
    @State private var textHeight: CGFloat = 0
    @State private var offset: CGSize = .zero
    @State private var samples: [CardThrow.Sample] = []

    private var width: CGFloat { min(container.width - 32, 520) }
    private var bodyMax: CGFloat { max(80, min(container.height - 32, 560) - 76) }
    private var scrolls: Bool { textHeight > bodyMax }

    /// The offset and scale that put the card on top of its tile.
    private var closedOffset: CGSize {
        CGSize(width: from.midX - container.width / 2, height: from.midY - container.height / 2)
    }

    private var closedScale: CGSize {
        guard size.width > 0, size.height > 0 else { return CGSize(width: 1, height: 1) }
        return CGSize(width: from.width / size.width, height: from.height / size.height)
    }

    private var opacity: Double {
        if size == .zero || gone { return 0 }
        return shown ? 1 : (reduceMotion ? 0 : 0.4)
    }

    var body: some View {
        ZStack {
            Color.black.opacity(shown && !gone ? 0.5 : 0)
                .ignoresSafeArea()
                .contentShape(Rectangle())
                .onTapGesture { close() }
                .accessibilityHidden(true)

            card
                .frame(width: width)
                .background(GeometryReader { Color.clear.preference(key: SizeKey.self, value: $0.size) })
                .onPreferenceChange(SizeKey.self) { value in
                    MainActor.assumeIsolated { size = value }
                }
                .scaleEffect(
                    x: shown || reduceMotion ? 1 : closedScale.width,
                    y: shown || reduceMotion ? 1 : closedScale.height
                )
                .rotationEffect(.degrees(reduceMotion ? 0 : max(-30, min(30, offset.width / 40))))
                .offset(
                    x: offset.width + (shown || reduceMotion ? 0 : closedOffset.width),
                    y: offset.height + (shown || reduceMotion ? 0 : closedOffset.height)
                )
                .opacity(opacity)
                .accessibilityElement(children: .contain)
                .accessibilityLabel(title)
                .accessibilityAddTraits(.isModal)
                .accessibilityAction(.escape) { close() }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .onChange(of: size) { old, _ in
            guard old == .zero, !closing else { return }
            withAnimation(reduceMotion ? .easeOut(duration: 0.15) : .spring(response: 0.38, dampingFraction: 0.82)) {
                shown = true
            }
            focused = true
        }
    }

    private var card: some View {
        let tone = colors.of(side.party)
        return VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .center, spacing: 12) {
                Text(title)
                    .brandText(TypeStyle(face: .inter, weight: 700, size: 12, lineHeight: 1.2, tracking: 0.08, textStyle: .caption2, maxScale: 1.6, uppercase: true))
                    .foregroundStyle(tone.ink)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityAddTraits(.isHeader)
                    .accessibilityFocused($focused)
                Button(action: { close() }) {
                    Image(systemName: "xmark")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(tone.ink)
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(L10n.appClose(lang))
            }
            .padding(.trailing, -10)

            if scrolls {
                ScrollView { text }
                    .frame(height: bodyMax)
            } else {
                text
            }
        }
        .padding(.horizontal, 18)
        .padding(.top, 8)
        .padding(.bottom, 20)
        .background(RoundedRectangle(cornerRadius: 24, style: .continuous).fill(tone.tint))
        .cardShadow()
        .contentShape(Rectangle())
        .gesture(throwGesture)
    }

    private var text: some View {
        Text(side.text)
            .brandText(TypeStyle(face: .inter, weight: 400, size: 16, lineHeight: 1.5, textStyle: .body))
            .foregroundStyle(Brand.ink)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(GeometryReader { Color.clear.preference(key: TextHeightKey.self, value: $0.size.height) })
            .onPreferenceChange(TextHeightKey.self) { value in
                MainActor.assumeIsolated { textHeight = value }
            }
    }

    private var throwGesture: some Gesture {
        DragGesture(minimumDistance: 4, coordinateSpace: .global)
            .onChanged { value in
                guard !closing else { return }
                offset = value.translation
                let now = value.time.timeIntervalSinceReferenceDate * 1000
                let sample = CardThrow.Sample(x: value.translation.width, y: value.translation.height, t: now)
                samples = (samples + [sample]).filter { now - $0.t <= 200 }
            }
            .onEnded { value in
                guard !closing else { return }
                let v = CardThrow.velocity(samples)
                samples = []
                let (dx, dy) = (value.translation.width, value.translation.height)
                if CardThrow.isThrow(dx, dy, v) {
                    throwAway(dx, dy, v)
                } else {
                    withAnimation(.spring(response: 0.35, dampingFraction: 0.6)) { offset = .zero }
                }
            }
    }

    private func throwAway(_ dx: Double, _ dy: Double, _ v: CGVector) {
        closing = true
        let end = CardThrow.target(dx, dy, v, reach: hypot(container.width, container.height))
        withAnimation(reduceMotion ? .easeOut(duration: 0.15) : .easeIn(duration: 0.28)) {
            if !reduceMotion { offset = end }
            gone = true
        } completion: {
            onClosed()
        }
    }

    /// Shrinks back to the tile.
    private func close() {
        guard !closing else { return }
        closing = true
        withAnimation(reduceMotion ? .easeOut(duration: 0.15) : .spring(response: 0.34, dampingFraction: 0.9)) {
            shown = false
            offset = .zero
        } completion: {
            onClosed()
        }
    }
}

private struct TextHeightKey: PreferenceKey {
    static let defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = nextValue() }
}
