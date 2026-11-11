import SwiftUI

/// Pure helpers of components/case/TwoSidedBlocks.tsx and AppealOutcome.tsx.
enum TwoSidedDisplay {
    /// Display caps (the server normalizes the same; a second guard).
    static let maxAgreed = 5
    static let maxDisputed = 4
    static let maxWouldChange = 3

    /// The evidence footnote: per party on two-sided verdicts, a plain count
    /// otherwise. Nil when no image was read.
    static func evidenceNote(_ result: VerdictResult, lang: AppLang) -> String? {
        guard let used = result.evidenceUsed else { return nil }
        if result.isMany {
            let n = used.a + used.b + used.c + used.d
            return n > 0 ? L10n.evidenceUsedOne(lang, n: String(n)) : nil
        }
        guard used.a + used.b > 0 else { return nil }
        return result.twoSided
            ? L10n.evidenceUsed(lang, a: String(used.a), b: String(used.b))
            : L10n.evidenceUsedOne(lang, n: String(used.a + used.b))
    }

    /// Which way a disputed fact was found, in words (never by colour alone).
    static func findingText(_ fact: DisputedFact, parties: PartyNames, lang: AppLang) -> String {
        switch fact.finding {
        case .a:
            return parties.aIsSelf ? L10n.twoSidedFindingSelf(lang) : L10n.twoSidedFindingA(lang, name: parties.nameA)
        case .b:
            return parties.bIsSelf ? L10n.twoSidedFindingSelf(lang) : L10n.twoSidedFindingB(lang, name: parties.nameB)
        case .c, .d, .unsettled, .unknown:
            return L10n.twoSidedFindingUnsettled(lang)
        }
    }

    /// The same for a dispute among three or four accounts.
    static func findingText(_ dispute: Dispute, parties: PartyNames, lang: AppLang) -> String {
        let side: Party
        switch dispute.finding {
        case .a: side = .a
        case .b: side = .b
        case .c: side = .c
        case .d: side = .d
        case .unsettled, .unknown: return L10n.twoSidedFindingUnsettled(lang)
        }
        return parties.isSelf(side) ? L10n.twoSidedFindingSelf(lang) : L10n.twoSidedFindingA(lang, name: parties.name(side))
    }

    static func manyDisputes(_ result: VerdictResult) -> [Dispute] {
        result.isMany ? Array((result.disputes ?? []).prefix(maxDisputed)) : []
    }

    static func agreed(_ result: VerdictResult) -> [String] {
        Array((result.agreedFacts ?? []).filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }.prefix(maxAgreed))
    }

    static func disputed(_ result: VerdictResult) -> [DisputedFact] {
        Array((result.disputedFacts ?? []).prefix(maxDisputed))
    }

    static func outcomeLabel(_ outcome: AppealOutcome, lang: AppLang) -> String? {
        switch outcome {
        case .upheld: return L10n.appealOutcomeUpheld(lang)
        case .overturned: return L10n.appealOutcomeOverturned(lang)
        case .changed: return L10n.appealOutcomeChanged(lang)
        case .unknown: return nil
        }
    }

    static func genericSummary(_ outcome: AppealOutcome, lang: AppLang) -> String {
        switch outcome {
        case .upheld: return L10n.appealGenericUpheld(lang)
        case .overturned: return L10n.appealGenericOverturned(lang)
        case .changed, .unknown: return L10n.appealGenericChanged(lang)
        }
    }
}

/// "What would change this verdict": short, on the details screen.
struct WouldChangeBlock: View {
    let items: [String]
    let lang: AppLang

    var body: some View {
        let list = Array(items.filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }.prefix(TwoSidedDisplay.maxWouldChange))
        if !list.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                SectionTitle(text: L10n.twoSidedWouldChange(lang))
                ForEach(Array(list.enumerated()), id: \.offset) { _, item in
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(verbatim: "•")
                            .foregroundStyle(Brand.muted)
                            .accessibilityHidden(true)
                        Text(item)
                            .brandText(TypeStyle(face: .inter, weight: 400, size: 14.5, lineHeight: 1.5, textStyle: .subheadline))
                            .foregroundStyle(Brand.ink2)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .contain)
        }
    }
}

/// Agreed and disputed facts of a two-sided verdict, on the details screen. Each
/// finding says its side in words; the decisive dispute also gets a dashed
/// frame and its own label.
struct TwoSidedFactsView: View {
    let result: VerdictResult
    let parties: PartyNames
    let lang: AppLang

    @Environment(\.sides) private var sides

    var body: some View {
        let agreed = TwoSidedDisplay.agreed(result)
        let disputed = TwoSidedDisplay.disputed(result)
        let many = TwoSidedDisplay.manyDisputes(result)
        // At most one decisive marker, as the server promises.
        let decisiveAt = disputed.firstIndex { $0.decisive }
        let manyDecisiveAt = many.firstIndex { $0.decisive }
        if !agreed.isEmpty || !disputed.isEmpty || !many.isEmpty {
            VStack(alignment: .leading, spacing: 22) {
                if !agreed.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        SectionTitle(text: L10n.twoSidedAgreed(lang))
                        ForEach(Array(agreed.enumerated()), id: \.offset) { _, fact in
                            HStack(alignment: .firstTextBaseline, spacing: 10) {
                                HStack(spacing: -3) {
                                    ForEach(result.parties ?? [.a, .b], id: \.self) { party in
                                        Circle().fill(sides.of(party).strong).frame(width: 9, height: 9)
                                    }
                                }
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
                }
                if !many.isEmpty {
                    VStack(alignment: .leading, spacing: 10) {
                        SectionTitle(text: L10n.twoSidedDisputed(lang))
                        ForEach(Array(many.enumerated()), id: \.offset) { index, item in
                            manyDispute(item, decisive: index == manyDecisiveAt)
                        }
                    }
                }
                if !disputed.isEmpty {
                    VStack(alignment: .leading, spacing: 10) {
                        SectionTitle(text: L10n.twoSidedDisputed(lang))
                        ForEach(Array(disputed.enumerated()), id: \.offset) { index, fact in
                            dispute(fact, decisive: index == decisiveAt)
                        }
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func dispute(_ fact: DisputedFact, decisive: Bool) -> some View {
        disputeCard(
            finding: TwoSidedDisplay.findingText(fact, parties: parties, lang: lang),
            color: findingColor(fact.finding),
            fact: fact.fact,
            decisive: decisive
        ) {
            claim(parties.nameA, text: fact.partyA, rule: sides.a.strong)
            claim(parties.nameB, text: fact.partyB, rule: sides.b.strong)
        }
    }

    /// A dispute among three or four accounts: one claim per side that spoke to it.
    private func manyDispute(_ item: Dispute, decisive: Bool) -> some View {
        disputeCard(
            finding: TwoSidedDisplay.findingText(item, parties: parties, lang: lang),
            color: findingColor(item.finding),
            fact: item.fact,
            decisive: decisive
        ) {
            ForEach(Array(item.positions.enumerated()), id: \.offset) { _, position in
                claim(parties.name(position.party), text: position.says, rule: sides.of(position.party).strong)
            }
        }
    }

    private func disputeCard<Claims: View>(
        finding: String, color: Color, fact: String, decisive: Bool, @ViewBuilder claims: () -> Claims
    ) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            FlowLayout(spacing: 6, rowSpacing: 6) {
                if decisive {
                    Label(L10n.twoSidedDecisive(lang), systemImage: "bolt.fill")
                        .brandText(.micro)
                        .foregroundStyle(Brand.ink)
                        .padding(.horizontal, 9)
                        .padding(.vertical, 4)
                        .background(Capsule().fill(Brand.strata))
                }
                Text(finding)
                    .brandText(.micro)
                    .foregroundStyle(color)
                    .padding(.horizontal, 9)
                    .padding(.vertical, 4)
                    .background(Capsule().fill(color.opacity(0.12)))
            }
            Text(fact)
                .brandText(.claim)
                .foregroundStyle(Brand.ink)
                .fixedSize(horizontal: false, vertical: true)
            claims()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Brand.paper))
        .overlay {
            if decisive {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .strokeBorder(Brand.dash, style: StrokeStyle(lineWidth: 1.5, dash: [5, 4]))
            } else {
                RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Brand.line, lineWidth: 1)
            }
        }
        .accessibilityElement(children: .combine)
    }

    private func claim(_ name: String, text: String, rule: Color) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(name)
                .brandText(TypeStyle(face: .inter, weight: 600, size: 12, lineHeight: 1.35, textStyle: .caption2))
                .foregroundStyle(Brand.ink2)
            Text(text)
                .brandText(.slotText)
                .foregroundStyle(Brand.ink2)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.leading, 10)
        .overlay(alignment: .leading) { Rectangle().fill(rule).frame(width: 2) }
    }

    private func findingColor(_ finding: DisputeFinding) -> Color {
        switch finding {
        case .a: return sides.a.ink
        case .b: return sides.b.ink
        case .c: return sides.c.ink
        case .d: return sides.d.ink
        case .unsettled, .unknown: return Brand.ink2
        }
    }
}

/// Banner on a verdict produced by an appeal: what happened to the verdict
/// (stands / flipped / changed, so it never reads as the appeal's own
/// success), who added context and the summary. The card below carries the
/// new confidence. The "stands" chip is neutral: a green tick would read as
/// "you won".
struct AppealOutcomeBanner: View {
    let appeal: AppealInfo
    let lang: AppLang
    let byName: String
    let bySelf: Bool

    var body: some View {
        if let label = TwoSidedDisplay.outcomeLabel(appeal.outcome, lang: lang) {
            VStack(alignment: .leading, spacing: 10) {
                FlowLayout(spacing: 8, rowSpacing: 6) {
                    Label(label, systemImage: glyph)
                        .brandText(.micro)
                        .foregroundStyle(chipText)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 5)
                        .background(Capsule().fill(chipFill))
                    Text(bySelf ? L10n.appealBySelf(lang) : L10n.appealBy(lang, name: byName))
                        .brandText(.slotTitle)
                        .foregroundStyle(Brand.ink)
                }
                let summary = appeal.summary.trimmingCharacters(in: .whitespacesAndNewlines)
                Text(summary.isEmpty ? TwoSidedDisplay.genericSummary(appeal.outcome, lang: lang) : summary)
                    .brandText(.body)
                    .foregroundStyle(Brand.ink2)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(16)
            .paperSurface(radius: 20, fill: Brand.paper, border: Brand.line2)
            .accessibilityElement(children: .combine)
        }
    }

    private var glyph: String {
        switch appeal.outcome {
        case .upheld: return "equal"
        case .overturned: return "arrow.left.arrow.right"
        case .changed, .unknown: return "arrow.right"
        }
    }

    private var chipFill: Color {
        switch appeal.outcome {
        case .overturned: return Brand.terraTint
        case .changed: return Brand.strata
        case .upheld, .unknown: return Brand.ivory2
        }
    }

    private var chipText: Color {
        appeal.outcome == .overturned ? Brand.terraInk : Brand.ink
    }
}
