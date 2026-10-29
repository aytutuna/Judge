import SwiftUI

/// A section heading on the verdict details screen.
struct SectionTitle: View {
    let text: String

    var body: some View {
        var style = TypeStyle.serifLabel
        style.size = 17
        return Text(text)
            .brandText(style)
            .foregroundStyle(Brand.muted)
            .accessibilityAddTraits(.isHeader)
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
                            .foregroundStyle(Brand.paper)
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
                    .paperSurface(radius: 14, fill: Brand.well)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

/// The premium web fact check (rendered whenever a result carries one).
struct FactCheckView: View {
    let factCheck: FactCheck
    /// Words the "nothing to look up" line for the dispute type.
    var disputeType: DisputeType = .unknown
    let lang: AppLang
    let openURL: (URL) -> Void

    /// Most sources shown per claim.
    static let maxSources = 3

    /// The muted line when nothing was looked up (noneKey on the web): a
    /// factual or mixed dispute turns on facts only the people involved
    /// know, so "values or meanings, not facts" would contradict its badge.
    static func emptyText(_ factCheck: FactCheck, disputeType: DisputeType, lang: AppLang) -> String {
        if factCheck.status == .unavailable { return L10n.factcheckUnavailable(lang) }
        return disputeType == .factual || disputeType == .mixed ? L10n.factcheckNoneFactual(lang) : L10n.factcheckNone(lang)
    }

    var body: some View {
        let claims = factCheck.status == .checked ? factCheck.claims : []
        VStack(alignment: .leading, spacing: 10) {
            SectionTitle(text: L10n.factcheckTitle(lang))
            if claims.isEmpty {
                Text(Self.emptyText(factCheck, disputeType: disputeType, lang: lang))
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
                // A shape next to the word, so the chip never relies on colour.
                Label(status, systemImage: statusGlyph(claim.status))
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

    private func statusGlyph(_ status: FactStatus) -> String {
        switch status {
        case .supported: return "checkmark"
        case .refuted: return "xmark"
        case .mixed: return "minus"
        case .unverified, .unknown: return "questionmark"
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
