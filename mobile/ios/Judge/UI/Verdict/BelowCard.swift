import SwiftUI

/// Section heading below the card (`.sectionTitle`).
private struct SectionTitle: View {
    let text: String

    var body: some View {
        Kicker(text: text)
            .accessibilityAddTraits(.isHeader)
            .padding(.bottom, 4)
    }
}

/// The two-column argument map: party chips, claims with kind glyphs, a
/// connector and each side's bedrock.
struct ArgumentMapView: View {
    let map: ArgumentMap
    let parties: PartyNames
    let lang: AppLang

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionTitle(text: L10n.mapTitle(lang))
            HStack(alignment: .top, spacing: 10) {
                column(.a, name: parties.nameA, claims: map.sideA, bedrock: map.bedrockA)
                column(.b, name: parties.nameB, claims: map.sideB, bedrock: map.bedrockB)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func column(_ party: Party, name: String, claims: [Claim], bedrock: String) -> some View {
        let isA = party == .a
        return VStack(spacing: 8) {
            HStack(spacing: 8) {
                Text(verbatim: isA ? "A" : "B")
                    .brandText(TypeStyle(face: .inter, weight: 700, size: 11, lineHeight: 1, textStyle: .caption2, maxScale: 1.4))
                    .foregroundStyle(.white)
                    .frame(width: 22, height: 22)
                    .background(Circle().fill(isA ? Brand.terraInk : Brand.sageInk))
                    .accessibilityHidden(true)
                Text(name)
                    .brandText(.slotTitle)
                    .foregroundStyle(Brand.ink)
                    .lineLimit(1)
                    .truncationMode(.tail)
                Spacer(minLength: 0)
            }
            .padding(.vertical, 6)
            .padding(.leading, 6)
            .padding(.trailing, 10)
            .background(Capsule().fill(isA ? Brand.terraTint : Brand.sageTint))
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isHeader)

            ForEach(Array(claims.enumerated()), id: \.offset) { _, claim in
                ClaimCard(claim: claim, rule: isA ? Brand.terra : Brand.sageStrong, lang: lang)
            }

            if !bedrock.isEmpty {
                Rectangle()
                    .fill(.clear)
                    .frame(width: 1.5, height: 14)
                    .overlay(
                        Path { path in
                            path.move(to: .zero)
                            path.addLine(to: CGPoint(x: 0, y: 14))
                        }
                        .stroke(Brand.dash, style: StrokeStyle(lineWidth: 1.5, dash: [3, 3]))
                    )
                    .accessibilityHidden(true)
                VStack(spacing: 6) {
                    Kicker(text: L10n.bedrock(lang), color: Brand.ink2)
                    Text(bedrock)
                        .brandText(TypeStyle(face: .inter, weight: 500, size: 14, lineHeight: 1.45, textStyle: .subheadline))
                        .foregroundStyle(Brand.ink)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity)
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
                .background(
                    RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Brand.strata)
                )
                .overlay(alignment: .bottom) {
                    Rectangle().fill(Brand.stone).frame(height: 3)
                }
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Brand.stone, lineWidth: 1))
                .accessibilityElement(children: .combine)
            }
        }
        .frame(maxWidth: .infinity, alignment: .top)
    }
}

private struct ClaimCard: View {
    let claim: Claim
    let rule: Color
    let lang: AppLang

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let kind = VerdictDisplay.kind(claim.kind, lang: lang) {
                HStack(spacing: 6) {
                    KindGlyph(kind: claim.kind).frame(width: 11, height: 11)
                    Text(kind)
                        .brandText(TypeStyle(face: .inter, weight: 700, size: 11, lineHeight: 1.2, tracking: 0.1, textStyle: .caption2, maxScale: 1.6, uppercase: true))
                        .foregroundStyle(Brand.ink2)
                }
            }
            Text(claim.claim)
                .brandText(.claim)
                .foregroundStyle(Brand.ink)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 10)
        .padding(.leading, 15)
        .padding(.trailing, 12)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Brand.paper))
        .overlay(alignment: .leading) { Rectangle().fill(rule).frame(width: 3) }
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Brand.line, lineWidth: 1))
        .accessibilityElement(children: .combine)
    }
}

/// Ink shape per claim kind: cube = fact, circle = value, triangle =
/// definition, diamond = logic (shape plus the written kind).
private struct KindGlyph: View {
    let kind: ClaimKind

    var body: some View {
        Canvas { context, size in
            let s = size.width / 12
            func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: x * s, y: y * s) }
            var shape = Path()
            switch kind {
            case .fact:
                shape.move(to: p(6, 0.8))
                shape.addLine(to: p(11, 3.6))
                shape.addLine(to: p(11, 8.4))
                shape.addLine(to: p(6, 11.2))
                shape.addLine(to: p(1, 8.4))
                shape.addLine(to: p(1, 3.6))
                shape.closeSubpath()
                context.fill(shape, with: .color(Brand.ink))
                var edges = Path()
                edges.move(to: p(6, 6)); edges.addLine(to: p(6, 11.2))
                edges.move(to: p(6, 6)); edges.addLine(to: p(1, 3.6))
                edges.move(to: p(6, 6)); edges.addLine(to: p(11, 3.6))
                context.stroke(edges, with: .color(Brand.paper), style: StrokeStyle(lineWidth: 0.9 * s, lineJoin: .round))
                return
            case .value:
                shape = Path(ellipseIn: CGRect(x: s, y: s, width: 10 * s, height: 10 * s))
            case .definition:
                shape.move(to: p(6, 1.2))
                shape.addLine(to: p(11.2, 10.6))
                shape.addLine(to: p(0.8, 10.6))
                shape.closeSubpath()
            case .logic:
                shape.move(to: p(6, 0.8))
                shape.addLine(to: p(11.2, 6))
                shape.addLine(to: p(6, 11.2))
                shape.addLine(to: p(0.8, 6))
                shape.closeSubpath()
            case .unknown:
                return
            }
            context.fill(shape, with: .color(Brand.ink))
        }
        .accessibilityHidden(true)
    }
}

/// The facts the verdict relies on, as sage check rows.
struct FactsView: View {
    let facts: [String]
    let lang: AppLang

    var body: some View {
        if !facts.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                SectionTitle(text: L10n.factsTitle(lang))
                ForEach(Array(facts.enumerated()), id: \.offset) { _, fact in
                    HStack(alignment: .firstTextBaseline, spacing: 10) {
                        Image(systemName: "checkmark")
                            .font(.system(size: 9, weight: .bold))
                            .foregroundStyle(.white)
                            .frame(width: 18, height: 18)
                            .background(Circle().fill(Brand.sageInk))
                            .accessibilityHidden(true)
                        Text(fact)
                            .brandText(TypeStyle(face: .inter, weight: 400, size: 15, lineHeight: 1.5))
                            .foregroundStyle(Brand.ink2)
                            .fixedSize(horizontal: false, vertical: true)
                        Spacer(minLength: 0)
                    }
                    .padding(.vertical, 11)
                    .padding(.horizontal, 14)
                    .paperSurface(radius: 14)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

/// The premium web fact check (rendered whenever a result carries one).
struct FactCheckView: View {
    let factCheck: FactCheck
    let lang: AppLang
    let openURL: (URL) -> Void

    /// Most sources shown per claim.
    static let maxSources = 3

    var body: some View {
        let claims = factCheck.status == .checked ? factCheck.claims : []
        VStack(alignment: .leading, spacing: 10) {
            SectionTitle(text: L10n.factcheckTitle(lang))
            if claims.isEmpty {
                Text(factCheck.status == .unavailable ? L10n.factcheckUnavailable(lang) : L10n.factcheckNone(lang))
                    .brandText(.slotText)
                    .foregroundStyle(Brand.muted)
            } else {
                Text(L10n.factcheckLead(lang))
                    .brandText(.slotText)
                    .foregroundStyle(Brand.muted)
                ForEach(Array(claims.enumerated()), id: \.offset) { _, claim in
                    claimRow(claim)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func claimRow(_ claim: FactClaim) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            if let status = L10n.text("factcheck.status.\(claim.status.rawValue)", lang) {
                Text(status)
                    .brandText(.micro)
                    .foregroundStyle(statusColor(claim.status))
                    .padding(.horizontal, 9)
                    .padding(.vertical, 4)
                    .background(Capsule().fill(statusColor(claim.status).opacity(0.12)))
            }
            Text(claim.claim)
                .brandText(.claim)
                .foregroundStyle(Brand.ink)
                .fixedSize(horizontal: false, vertical: true)
            if !claim.summary.isEmpty {
                Text(claim.summary)
                    .brandText(.slotText)
                    .foregroundStyle(Brand.ink2)
                    .fixedSize(horizontal: false, vertical: true)
            }
            let sources = Self.safeSources(claim.sources)
            if !sources.isEmpty {
                FlowLayout(spacing: 6, rowSpacing: 6) {
                    Text(L10n.factcheckSources(lang))
                        .brandText(.footnote)
                        .foregroundStyle(Brand.muted)
                    ForEach(sources, id: \.url) { source in
                        Button {
                            openURL(source.url)
                        } label: {
                            Label(source.domain, systemImage: "arrow.up.right")
                                .labelStyle(TrailingIconLabelStyle())
                                .brandText(.footnote)
                        }
                        .foregroundStyle(Brand.terraInk)
                        .accessibilityLabel(L10n.appFactcheckSourceAria(lang, title: source.title))
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .paperSurface(radius: 14)
    }

    private func statusColor(_ status: FactStatus) -> Color {
        switch status {
        case .supported: return Brand.sageInk
        case .refuted: return Brand.danger
        case .mixed: return Brand.terraInk
        case .unverified, .unknown: return Brand.ink2
        }
    }

    struct ShownSource: Equatable {
        let title: String
        let url: URL
        let domain: String
    }

    /// http(s) links only, shown by domain, de-duplicated, at most three.
    static func safeSources(_ sources: [FactSource]) -> [ShownSource] {
        var shown: [ShownSource] = []
        for source in sources {
            guard let url = URL(string: source.url),
                  let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https",
                  let host = url.host, !host.isEmpty,
                  !shown.contains(where: { $0.url == url })
            else { continue }
            let domain = host.lowercased().hasPrefix("www.") ? String(host.dropFirst(4)) : host
            let title = source.title.trimmingCharacters(in: .whitespacesAndNewlines)
            shown.append(ShownSource(title: title.isEmpty ? domain : title, url: url, domain: domain))
            if shown.count == maxSources { break }
        }
        return shown
    }
}

private struct TrailingIconLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 3) {
            configuration.title
            configuration.icon.imageScale(.small)
        }
    }
}
