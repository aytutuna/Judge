import CoreText
import SwiftUI
import UIKit

/// The paper verdict card, as the web's VerdictReveal and verdict.module.css
/// lay it out: the top row with the stamp, the dispute kind, the headline,
/// confidence and votes, a rule, then the lean / trial / refusal notes, the
/// branches, the crux, both sides' bedrock, the best point, the footnote and
/// the share actions.
struct VerdictCard: View {
    let result: VerdictResult
    let parties: PartyNames
    /// Real names restored into the text: a conditional clause opening with
    /// one keeps its capital.
    var restoredNames: [String] = []
    let lang: AppLang
    let status: TranslationStatus
    /// Nil hides the share buttons (a removed case: its links are closed).
    let shareURL: URL?
    /// The anonymized original headline (anything that leaves the phone
    /// stays anonymized).
    let shareSubject: String

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var copied = false
    @State private var appeared = false
    @State private var width: CGFloat = 0

    private var label: String { VerdictDisplay.label(result.verdict, parties: parties, lang: lang) }
    private var refused: Bool { result.modelRefused }

    private static let sectionText = TypeStyle(face: .inter, weight: 400, size: 15, lineHeight: 1.55)

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top, spacing: 8) {
                topRow
                    .frame(maxWidth: .infinity, alignment: .leading)
                Stamp(text: VerdictDisplay.stampLabel(result.verdict, parties: parties, lang: lang))
                    .frame(maxWidth: 160, alignment: .trailing)
            }
            reveal
            Rectangle()
                .fill(Brand.ink.opacity(0.8))
                .frame(height: 1)
                .padding(.vertical, 2)
                .accessibilityHidden(true)
            slots
            branches
            if !refused {
                section(L10n.cruxShort(lang)) {
                    Text(result.crux)
                        .brandText(Self.sectionText)
                        .foregroundStyle(Brand.ink)
                        .fixedSize(horizontal: false, vertical: true)
                }
                let map = result.argumentMap
                if !map.bedrockA.isEmpty || !map.bedrockB.isEmpty {
                    section(L10n.bedrock(lang)) {
                        HStack(spacing: 10) {
                            BedrockTile(name: parties.nameA, text: map.bedrockA, color: Brand.terraInk)
                            BedrockTile(name: parties.nameB, text: map.bedrockB, color: Brand.sageInk)
                        }
                        .fixedSize(horizontal: false, vertical: true)
                    }
                }
                if !result.losingSideBestPoint.isEmpty {
                    section(VerdictDisplay.bestPointTitle(result.verdict, parties: parties, lang: lang)) {
                        Text(result.losingSideBestPoint)
                            .brandText(Self.sectionText)
                            .foregroundStyle(Brand.ink)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                if let wouldChange = result.wouldChange, !wouldChange.isEmpty {
                    WouldChangeBlock(items: wouldChange, lang: lang)
                }
            }
            footnote
            actions
        }
        .padding(.horizontal, 20)
        .padding(.top, 22)
        .padding(.bottom, 20)
        .background {
            GeometryReader { proxy in
                Color.clear
                    .onAppear { width = proxy.size.width }
                    .onChange(of: proxy.size.width) { _, value in width = value }
            }
        }
        .paperSurface(radius: Radius.verdict)
        .cardShadow()
        .opacity(appeared || reduceMotion ? 1 : 0)
        .offset(y: appeared || reduceMotion ? 0 : 16)
        .onAppear {
            guard !appeared else { return }
            withAnimation(reduceMotion ? nil : Motion.ease) { appeared = true }
        }
    }

    // MARK: - Sections

    private var topRow: some View {
        FlowLayout(spacing: 8, rowSpacing: 6) {
            if let note = status.note(lang) {
                HStack(spacing: 7) {
                    if status == .loading {
                        ProgressView().controlSize(.mini).tint(Brand.ink)
                    }
                    Text(note)
                        .brandText(TypeStyle(face: .inter, weight: 600, size: 12, lineHeight: 1.35, textStyle: .caption2))
                        .foregroundStyle(Brand.ink2)
                }
                .padding(.horizontal, 11)
                .padding(.vertical, 5)
                .background(Capsule().fill(Brand.ivory))
                .overlay(Capsule().strokeBorder(Brand.line2, lineWidth: 1))
                .accessibilityAddTraits(.updatesFrequently)
            } else {
                HStack(spacing: 7) {
                    BrandMark(width: 20)
                    Text(L10n.appName(lang))
                        .brandText(TypeStyle(face: .interTight, weight: 600, size: 13, lineHeight: 1, tracking: -0.01, textStyle: .footnote))
                        .foregroundStyle(Brand.muted)
                }
                .frame(minHeight: 26)
                .accessibilityHidden(true)
            }
            if result.isPremium {
                Text(L10n.premiumBadge(lang))
                    .brandText(.micro)
                    .foregroundStyle(Brand.ivory)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(Capsule().fill(Brand.ink))
                if result.twoSided {
                    Text(L10n.twoSidedBadge(lang))
                        .brandText(.micro)
                        .foregroundStyle(Brand.sageInk)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 5)
                        .background(Capsule().fill(Brand.sageTint))
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                }
            }
        }
    }

    /// The dispute kind, the headline as the card's heading (read with the
    /// ruling first), then confidence and votes.
    private var reveal: some View {
        let headline = result.headline.isEmpty ? label : result.headline
        var style = TypeStyle.ruling
        // As on Android: 8% of the screen width, between 30 and 34.
        style.size = min(34, max(30, (width + 32) * 0.08))
        return VStack(alignment: .leading, spacing: 10) {
            if let badge = VerdictDisplay.badge(result.disputeType, lang: lang) {
                Kicker(text: badge)
            }
            Text(headline)
                .brandText(style)
                .foregroundStyle(Brand.ink)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityLabel(result.headline.isEmpty ? label : label + ". " + headline)
                .accessibilityAddTraits(.isHeader)
            meta
        }
    }

    /// "Confidence 4 of 5 · ●●● 3 of 3 agree".
    private var meta: some View {
        FlowLayout(spacing: 8, rowSpacing: 4) {
            Text(L10n.confidenceAria(lang, n: String(VerdictDisplay.clampedConfidence(result.confidence))))
            if !result.runs.isEmpty {
                Text(verbatim: "·")
                    .accessibilityHidden(true)
                HStack(spacing: 8) {
                    HStack(spacing: 5) {
                        ForEach(Array(result.runs.enumerated()), id: \.offset) { _, run in
                            VoteDot(vote: VerdictDisplay.vote(run))
                        }
                    }
                    .accessibilityHidden(true)
                    if let agreed = VerdictDisplay.agreement(result) {
                        Text(L10n.verdictAgree(lang, n: String(agreed.n), total: String(agreed.total)))
                    } else {
                        Text(L10n.verdictNoMajority(lang))
                    }
                }
            }
        }
        .brandText(TypeStyle(face: .inter, weight: 500, size: 13, lineHeight: 1.4, textStyle: .footnote))
        .foregroundStyle(Brand.ink2)
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private var slots: some View {
        switch result.lean {
        case .lean(let lean):
            Slot {
                HStack(spacing: 7) {
                    Circle().fill(lean.party == .a ? Brand.terra : Brand.sageStrong).frame(width: 9, height: 9)
                        .accessibilityHidden(true)
                    Text(parties.isSelf(lean.party) ? L10n.leanTitleSelf(lang) : L10n.leanTitle(lang, name: parties.name(lean.party)))
                        .brandText(.slotTitle)
                        .foregroundStyle(Brand.ink)
                }
                SlotText(lean.reason)
                if result.runs.count >= 2 {
                    if lean.unanimous {
                        SlotText(L10n.leanUnanimous(lang))
                    } else {
                        let tally = VerdictDisplay.leanTally(lean, runCount: result.runs.count)
                        SlotText(L10n.leanMajority(lang, forValue: String(tally.forValue), against: String(tally.against)))
                    }
                }
            }
        case .tie:
            Slot { SlotText(L10n.leanTie(lang)) }
        case .absent:
            EmptyView()
        }

        if let trial = result.cruxTrial {
            CruxTrialNote(trial: trial, lang: lang)
        }
        if refused {
            Slot { SlotText(L10n.refusedNote(lang)) }
        }
        if result.demo {
            Slot { SlotText(L10n.demoNote(lang)) }
        }
    }

    @ViewBuilder
    private var branches: some View {
        if result.verdict == .split, let points = result.splitPoints, !points.isEmpty {
            VStack(spacing: 8) {
                ForEach(Array(points.enumerated()), id: \.offset) { _, point in
                    let lead = parties.isSelf(point.party) ? L10n.splitWinSelf(lang) : L10n.splitWin(lang, name: parties.name(point.party))
                    Branch(tint: point.party == .a ? Brand.terraTint : Brand.sageTint, rule: point.party == .a ? Brand.terra : Brand.sageStrong) {
                        LeadText(lead: lead, leadColor: Brand.ink, rest: " " + point.point)
                    }
                }
            }
        } else if result.verdict == .conditional, let items = result.conditional, !items.isEmpty {
            let keep = [parties.aIsSelf ? "" : parties.nameA, parties.bIsSelf ? "" : parties.nameB] + restoredNames
            VStack(spacing: 8) {
                ForEach(Array(items.enumerated()), id: \.offset) { _, branch in
                    let clause = ConditionalClause.format(branch.ifValue, lang: lang, keep: keep)
                    Branch(tint: Brand.paper, rule: nil) {
                        LeadText(lead: L10n.ifPrefix(lang) + " " + clause, leadColor: Brand.ink2, rest: " → " + branch.then)
                    }
                }
            }
        }
    }

    /// A titled part of the card under the rule (verdict.module.css .section).
    private func section<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .brandText(.serifLabel)
                .foregroundStyle(Brand.muted)
                .accessibilityAddTraits(.isHeader)
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private var footnote: some View {
        if !result.runs.isEmpty {
            VStack(spacing: 2) {
                if result.escalated {
                    Text(L10n.escalated(lang))
                }
                Text(L10n.judgesVoted(lang, n: result.runs.count) + " " + VerdictDisplay.votesText(result.runs, parties: parties, lang: lang))
                if result.isPremium {
                    let models = result.panel?.models ?? []
                    Text(models.isEmpty ? L10n.panelPremium(lang) : L10n.panelPremium(lang) + " " + VerdictDisplay.panelSummary(models: models, lang: lang))
                }
                if let evidence = TwoSidedDisplay.evidenceNote(result, lang: lang) {
                    Text(evidence)
                }
            }
            .brandText(.footnote)
            .foregroundStyle(Brand.muted)
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)
        }
    }

    /// Share (filled) and copy link (outlined).
    @ViewBuilder
    private var actions: some View {
        if let shareURL {
            HStack(spacing: 8) {
                ShareLink(item: shareURL, subject: Text(shareSubject), message: Text(L10n.shareText(lang))) {
                    Label(L10n.share(lang), systemImage: "square.and.arrow.up")
                }
                .buttonStyle(CardActionStyle(filled: true))
                Button {
                    UIPasteboard.general.url = shareURL
                    copied = true
                } label: {
                    Label(copied ? L10n.copied(lang) : L10n.copyLink(lang), systemImage: copied ? "checkmark" : "link")
                }
                .buttonStyle(CardActionStyle(filled: false))
                .task(id: copied) {
                    guard copied else { return }
                    try? await Task.sleep(for: .seconds(2))
                    if !Task.isCancelled { copied = false }
                }
            }
            .padding(.top, 2)
        }
    }
}

// MARK: - Pieces

/// Decorative: the headline's accessibility label carries the ruling.
private struct Stamp: View {
    let text: String

    var body: some View {
        Text(text)
            .brandText(TypeStyle(face: .interTight, weight: 800, size: 13, lineHeight: 1.15, tracking: 0.12, textStyle: .footnote, maxScale: 1.4, uppercase: true))
            .foregroundStyle(Brand.terra)
            .multilineTextAlignment(.center)
            .lineLimit(2)
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(Brand.terra, lineWidth: 2))
            .rotationEffect(.degrees(8))
            .padding(.top, 4)
            .accessibilityHidden(true)
    }
}

private struct BedrockTile: View {
    let name: String
    let text: String
    let color: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(name)
                .brandText(TypeStyle(face: .inter, weight: 700, size: 11, lineHeight: 1.3, tracking: 0.1, textStyle: .caption2, maxScale: 1.6, uppercase: true))
                .foregroundStyle(color)
                .lineLimit(1)
            Text(text)
                .brandText(TypeStyle(face: .inter, weight: 400, size: 14, lineHeight: 1.45, textStyle: .subheadline))
                .foregroundStyle(Brand.ink)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Brand.ivory))
        .accessibilityElement(children: .combine)
    }
}

/// 48 pt pills under the card: ink when filled, paper with a hairline otherwise.
private struct CardActionStyle: ButtonStyle {
    let filled: Bool

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .brandText(TypeStyle(face: .interTight, weight: 600, size: 15, lineHeight: 1.2, textStyle: .headline, maxScale: 1.6))
            .foregroundStyle(filled ? Brand.ivory : Brand.ink)
            .lineLimit(1)
            .padding(.horizontal, 18)
            .frame(maxWidth: filled ? .infinity : nil, minHeight: 48)
            .background(Capsule().fill(filled ? Brand.ink : (configuration.isPressed ? Brand.ivory : Brand.paper)))
            .overlay(Capsule().strokeBorder(filled ? Color.clear : Brand.line2, lineWidth: 1))
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
    }
}

private struct VoteDot: View {
    let vote: VerdictDisplay.Vote

    var body: some View {
        switch vote {
        case .a: Circle().fill(Brand.terra).frame(width: 10, height: 10)
        case .b: Circle().fill(Brand.sageStrong).frame(width: 10, height: 10)
        case .other: Circle().strokeBorder(Brand.ink, lineWidth: 1.5).frame(width: 10, height: 10)
        }
    }
}

private struct Slot<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 4) { content }
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct SlotText: View {
    let text: String
    var color: Color = Brand.muted

    init(_ text: String, color: Color = Brand.muted) {
        self.text = text
        self.color = color
    }

    var body: some View {
        Text(text)
            .brandText(.slotText)
            .foregroundStyle(color)
            .fixedSize(horizontal: false, vertical: true)
    }
}

/// Outcome of the cross-examination: survived is neutral (never green);
/// uncertain and overturned show the attack and the referee's reason.
private struct CruxTrialNote: View {
    let trial: CruxTrial
    let lang: AppLang
    @State private var expanded = false

    var body: some View {
        switch trial.outcome {
        case .survived:
            Slot {
                Label(L10n.trialSurvived(lang), systemImage: "shield")
                    .brandText(.slotText)
                    .foregroundStyle(Brand.ink2)
                if !trial.attack.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    DisclosureGroup(isExpanded: $expanded) {
                        VStack(alignment: .leading, spacing: 6) {
                            SlotText(L10n.trialAttackPrefix(lang) + " " + trial.attack)
                            if !trial.reasoning.isEmpty {
                                SlotText(L10n.trialRefereePrefix(lang) + " " + trial.reasoning)
                            }
                        }
                        .multilineTextAlignment(.leading)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.top, 6)
                    } label: {
                        Text(L10n.trialWhatWasTested(lang))
                            .brandText(.slotTitle)
                            .foregroundStyle(Brand.ink2)
                    }
                    .tint(Brand.ink2)
                }
            }
        case .overturned, .uncertain, .unknown:
            let overturned = trial.outcome == .overturned
            Slot {
                Label(overturned ? L10n.trialOverturned(lang) : L10n.trialUncertain(lang), systemImage: "exclamationmark.triangle")
                    .brandText(.slotText)
                    .foregroundStyle(overturned ? Brand.danger : Brand.ink2)
                VStack(alignment: .leading, spacing: 4) {
                    SlotText(L10n.trialAttackPrefix(lang) + " " + trial.attack)
                    if !trial.reasoning.isEmpty {
                        SlotText(L10n.trialRefereePrefix(lang) + " " + trial.reasoning)
                    }
                }
                .multilineTextAlignment(.leading)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }
}

/// A branch line: a semibold lead run followed by regular text, wrapping
/// as one paragraph.
private struct LeadText: View {
    let lead: String
    let leadColor: Color
    let rest: String
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        var bold = TypeStyle.branch
        bold.weight = 600
        let boldFont = BrandFont.uiFont(bold, sizeCategory: UIContentSizeCategory(dynamicTypeSize))
        return Text(lead).font(Font(boldFont as CTFont)).foregroundStyle(leadColor) + Text(rest)
    }
}

private struct Branch<Content: View>: View {
    let tint: Color
    let rule: Color?
    @ViewBuilder let content: Content

    var body: some View {
        content
            .brandText(.branch)
            .foregroundStyle(Brand.ink)
            .frame(maxWidth: .infinity, alignment: .leading)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.vertical, 12)
            .padding(.leading, rule == nil ? 14 : 17)
            .padding(.trailing, 14)
            .background(
                RoundedRectangle(cornerRadius: 16, style: .continuous).fill(tint)
            )
            .overlay(alignment: .leading) {
                if let rule {
                    UnevenRoundedRectangle(topLeadingRadius: 16, bottomLeadingRadius: 16, style: .continuous)
                        .fill(rule)
                        .frame(width: 3)
                }
            }
            .overlay {
                if rule == nil {
                    RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Brand.line2, lineWidth: 1)
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}
