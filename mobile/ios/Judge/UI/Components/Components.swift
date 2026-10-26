import SafariServices
import SwiftUI

/// The Judge mark (components/BrandMark.tsx): an ink beam tipped toward a
/// terracotta sphere, a sage sphere and an ink pivot, in a 28x20 box.
struct BrandMark: View {
    var width: CGFloat = 28

    var body: some View {
        Canvas { context, size in
            let s = size.width / 28
            var beam = Path()
            beam.move(to: CGPoint(x: 2.5 * s, y: 12.6 * s))
            beam.addLine(to: CGPoint(x: 25.5 * s, y: 9.4 * s))
            context.stroke(beam, with: .color(Brand.ink), style: StrokeStyle(lineWidth: 2 * s, lineCap: .round))
            context.fill(circle(x: 6.4, y: 8.1, r: 3.9, s: s), with: .color(Brand.terra))
            context.fill(circle(x: 21.6, y: 6, r: 3.9, s: s), with: .color(Brand.sage))
            var pivot = Path()
            pivot.move(to: CGPoint(x: 14 * s, y: 11.4 * s))
            pivot.addLine(to: CGPoint(x: 10.6 * s, y: 18.6 * s))
            pivot.addLine(to: CGPoint(x: 17.4 * s, y: 18.6 * s))
            pivot.closeSubpath()
            context.fill(pivot, with: .color(Brand.ink))
        }
        .frame(width: width, height: width * 20 / 28)
        .accessibilityHidden(true)
    }

    private func circle(x: CGFloat, y: CGFloat, r: CGFloat, s: CGFloat) -> Path {
        Path(ellipseIn: CGRect(x: (x - r) * s, y: (y - r) * s, width: 2 * r * s, height: 2 * r * s))
    }
}

/// The judging balance: the brand mark redrawn with a level beam that
/// rotates about the pivot tip. `angle` is clockwise-positive degrees, so a
/// negative angle lowers Party A's (left, terracotta) end.
struct BalanceCanvas: View {
    var angle: Double

    var body: some View {
        Canvas { context, size in
            let s = min(size.width / 28, size.height / 22)
            let origin = CGPoint(x: (size.width - 28 * s) / 2, y: (size.height - 22 * s) / 2)
            func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: origin.x + x * s, y: origin.y + y * s) }
            let pivotTip = p(14, 12)

            var beamContext = context
            beamContext.translateBy(x: pivotTip.x, y: pivotTip.y)
            beamContext.rotate(by: .degrees(angle))
            beamContext.translateBy(x: -pivotTip.x, y: -pivotTip.y)
            var beam = Path()
            beam.move(to: p(2.5, 11))
            beam.addLine(to: p(25.5, 11))
            beamContext.stroke(beam, with: .color(Brand.ink), style: StrokeStyle(lineWidth: 2 * s, lineCap: .round))
            let r: CGFloat = 3.9
            beamContext.fill(Path(ellipseIn: CGRect(origin: p(5.6 - r, 7.1 - r), size: CGSize(width: 2 * r * s, height: 2 * r * s))), with: .color(Brand.terra))
            beamContext.fill(Path(ellipseIn: CGRect(origin: p(22.4 - r, 7.1 - r), size: CGSize(width: 2 * r * s, height: 2 * r * s))), with: .color(Brand.sage))

            var pivot = Path()
            pivot.move(to: p(14, 11.4))
            pivot.addLine(to: p(10.4, 19.2))
            pivot.addLine(to: p(17.6, 19.2))
            pivot.closeSubpath()
            context.fill(pivot, with: .color(Brand.ink))
            var base = Path()
            base.move(to: p(8.5, 20.4))
            base.addLine(to: p(19.5, 20.4))
            context.stroke(base, with: .color(Brand.ink.opacity(0.18)), style: StrokeStyle(lineWidth: 1.2 * s, lineCap: .round))
        }
        .accessibilityHidden(true)
    }
}

/// Ink pill call to action (`--shadow-cta`).
struct PrimaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .brandText(.button)
            .foregroundStyle(Brand.ivory)
            .frame(maxWidth: .infinity, minHeight: 54)
            .padding(.horizontal, 20)
            .background(Capsule().fill(Brand.ink.opacity(isEnabled ? 1 : 0.35)))
            .shadow(color: Brand.ink.opacity(isEnabled ? 0.3 : 0), radius: 12, y: 8)
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(.easeOut(duration: 0.15), value: configuration.isPressed)
    }
}

/// Paper pill with a hairline border (`.btnGhost`).
struct GhostButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .brandText(.chip)
            .foregroundStyle(Brand.ink)
            .padding(.horizontal, 16)
            .frame(minHeight: 40)
            .background(Capsule().fill(configuration.isPressed ? Color.white : Brand.paper))
            .overlay(Capsule().strokeBorder(Brand.line2, lineWidth: 1))
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .opacity(isEnabled ? 1 : 0.4)
    }
}

/// Terracotta text action (`.btnLink`).
struct LinkButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .brandText(.chip)
            .foregroundStyle(Brand.terraInk)
            .frame(minHeight: 40)
            .opacity(configuration.isPressed ? 0.6 : 1)
    }
}

/// A selectable chip (examples and presets).
struct ChipButtonStyle: ButtonStyle {
    var selected = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .brandText(.chip)
            .foregroundStyle(selected ? Brand.terraInk : Brand.ink)
            .padding(.horizontal, 14)
            .frame(minHeight: 38)
            .background(Capsule().fill(selected ? Brand.terraTint : Brand.ivory2))
            .overlay(Capsule().strokeBorder(selected ? Brand.terra.opacity(0.5) : Brand.line, lineWidth: 1))
            .opacity(configuration.isPressed ? 0.7 : 1)
    }
}

/// Micro caps label (`--text-micro`, `.k`).
struct Kicker: View {
    let text: String
    var color: Color = Brand.muted

    var body: some View {
        Text(text)
            .brandText(.micro)
            .foregroundStyle(color)
    }
}

/// Wraps children onto as many rows as needed (chips).
struct FlowLayout: Layout {
    var spacing: CGFloat = 8
    var rowSpacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = arrange(subviews: subviews, width: proposal.width ?? .infinity)
        let width = rows.map(\.width).max() ?? 0
        let height = rows.map(\.height).reduce(0, +) + rowSpacing * CGFloat(max(0, rows.count - 1))
        return CGSize(width: proposal.width ?? width, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var y = bounds.minY
        for row in arrange(subviews: subviews, width: bounds.width) {
            var x = bounds.minX
            for index in row.indices {
                let size = subviews[index].sizeThatFits(.unspecified)
                subviews[index].place(
                    at: CGPoint(x: x, y: y + (row.height - size.height) / 2),
                    proposal: ProposedViewSize(width: min(size.width, bounds.width), height: size.height)
                )
                x += size.width + spacing
            }
            y += row.height + rowSpacing
        }
    }

    private struct Row {
        var indices: [Int] = []
        var width: CGFloat = 0
        var height: CGFloat = 0
    }

    private func arrange(subviews: Subviews, width: CGFloat) -> [Row] {
        var rows: [Row] = []
        var current = Row()
        for index in subviews.indices {
            let size = subviews[index].sizeThatFits(.unspecified)
            let needed = current.indices.isEmpty ? size.width : current.width + spacing + size.width
            if needed > width, !current.indices.isEmpty {
                rows.append(current)
                current = Row()
            }
            current.width = current.indices.isEmpty ? min(size.width, width) : current.width + spacing + size.width
            current.height = max(current.height, size.height)
            current.indices.append(index)
        }
        if !current.indices.isEmpty { rows.append(current) }
        return rows
    }
}

/// The header's "+": a new argument on an empty form. The language
/// switch lives in Settings.
struct NewArgumentButton: View {
    let lang: AppLang
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: "plus")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Brand.ink)
                .frame(width: 36, height: 36)
                .background(Circle().fill(Brand.paper))
                .overlay(Circle().strokeBorder(Brand.line2, lineWidth: 1))
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(L10n.shellNew(lang))
    }
}

/// A web page in SFSafariViewController.
struct SafariView: UIViewControllerRepresentable {
    let url: URL

    func makeUIViewController(context: Context) -> SFSafariViewController {
        let controller = SFSafariViewController(url: url)
        controller.preferredControlTintColor = UIColor(Brand.terraInk)
        return controller
    }

    func updateUIViewController(_ controller: SFSafariViewController, context: Context) {}
}

/// A URL that can drive `.sheet(item:)`.
struct WebLink: Identifiable, Equatable {
    let url: URL
    var id: String { url.absoluteString }
}

/// The error box on Home: message plus an optional "Try again".
struct ErrorBanner: View {
    let message: String
    var retryTitle: String?
    var onRetry: (() -> Void)?

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Image(systemName: "exclamationmark.circle.fill")
                .foregroundStyle(Brand.danger)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 6) {
                Text(message)
                    .brandText(.slotText)
                    .foregroundStyle(Brand.ink)
                    .fixedSize(horizontal: false, vertical: true)
                if let retryTitle, let onRetry {
                    Button(retryTitle, action: onRetry)
                        .buttonStyle(LinkButtonStyle())
                }
            }
            Spacer(minLength: 0)
        }
        .padding(14)
        .paperSurface(radius: 16, fill: Brand.terraTint.opacity(0.55), border: Brand.terra.opacity(0.35))
        .accessibilityElement(children: .combine)
    }
}
