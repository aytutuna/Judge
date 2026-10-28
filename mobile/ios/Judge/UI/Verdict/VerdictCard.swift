import CoreText
import SwiftUI
import UIKit

/// The ruling at the top of a verdict: the settled balance, both names,
/// which way the panel leaned, the ruling with its votes, the headline and
/// why it went that way.
/// A split or conditional ruling keeps its branches here too, since the
/// headline alone does not say who won what; everything else is on the
/// details screen.
struct VerdictCard: View {
    let result: VerdictResult
    let parties: PartyNames
    /// Real names restored into the text: a conditional clause opening with
    /// one keeps its capital.
    var restoredNames: [String] = []
    let lang: AppLang
    let status: TranslationStatus

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var appeared = false

    /// Party A's share of the votes cast for a side, for the lean bar. Too
    /// close or split sits in the middle; nil (no bar) without votes or on
    /// a refusal.
    static func leanShare(_ result: VerdictResult) -> Double? {
        guard !result.modelRefused, !result.runs.isEmpty else { return nil }
        if result.verdict == .tooClose || result.verdict == .split { return 0.5 }
        let votes = result.runs.map(VerdictDisplay.vote)
        let a = votes.filter { $0 == .a }.count
        let counted = a + votes.filter { $0 == .b }.count
        return counted == 0 ? 0.5 : Double(a) / Double(counted)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            SceneView(mode: VerdictDisplay.sceneVerdict(result))
                .frame(maxWidth: .infinity)
                .frame(height: 118)
                .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
            if let note = status.note(lang) {
                TranslationNote(note: note, loading: status == .loading)
            }
            // Party A on the left and Party B on the right in every
            // language, as in the scene above.
            names
                .environment(\.layoutDirection, .leftToRight)
            if let share = Self.leanShare(result) {
                leanBar(share)
                    .environment(\.layoutDirection, .leftToRight)
            }
            RulingLine(result: result, parties: parties, lang: lang)
            headline
            WhyBlock(result: result, lang: lang)
            VerdictBranches(result: result, parties: parties, restoredNames: restoredNames, lang: lang)
            if result.modelRefused {
                SlotText(L10n.refusedNote(lang))
            }
        }
        .padding(18)
        .paperSurface(radius: Radius.card)
        .cardShadow()
        .opacity(appeared || reduceMotion ? 1 : 0)
        .offset(y: appeared || reduceMotion ? 0 : 16)
        .onAppear {
            guard !appeared else { return }
            withAnimation(reduceMotion ? nil : Motion.ease) { appeared = true }
        }
    }

    private var names: some View {
        HStack(spacing: 8) {
            PartyAvatar(party: .a, size: 28)
            Text(parties.nameA)
                .brandText(TypeStyle(face: .inter, weight: 700, size: 15, lineHeight: 1.2, textStyle: .subheadline, maxScale: 1.6))
                .foregroundStyle(Brand.ink)
                .lineLimit(1)
            Spacer(minLength: 8)
            Text(L10n.appVerdictVs(lang))
                .brandText(.footnote)
                .foregroundStyle(Brand.muted)
            Spacer(minLength: 8)
            Text(parties.nameB)
                .brandText(TypeStyle(face: .inter, weight: 600, size: 15, lineHeight: 1.2, textStyle: .subheadline, maxScale: 1.6))
                .foregroundStyle(Brand.ink2)
                .lineLimit(1)
            PartyAvatar(party: .b, size: 28)
        }
        .accessibilityElement(children: .combine)
    }

    private func leanBar(_ share: Double) -> some View {
        let leaned: String
        if share > 0.5 {
            leaned = L10n.appVerdictLeanTo(lang, name: parties.nameA)
        } else if share < 0.5 {
            leaned = L10n.appVerdictLeanTo(lang, name: parties.nameB)
        } else {
            leaned = L10n.appVerdictLeanNone(lang)
        }
        return GeometryReader { proxy in
            ZStack(alignment: .leading) {
                Capsule().fill(Brand.sageTint)
                Capsule()
                    .fill(Brand.terra)
                    .frame(width: proxy.size.width * share)
            }
        }
        .frame(height: 12)
        .accessibilityElement()
        .accessibilityLabel(leaned)
    }

    private var headline: some View {
        let label = VerdictDisplay.label(result.verdict, parties: parties, lang: lang)
        var style = TypeStyle.ruling
        style.size = 30
        return Text(result.headline.isEmpty ? label : result.headline)
            .brandText(style)
            .foregroundStyle(Brand.ink)
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityAddTraits(.isHeader)
    }
}

/// What decided the ruling, right under the headline.
struct WhyBlock: View {
    let result: VerdictResult
    let lang: AppLang

    var body: some View {
        if let why = VerdictDisplay.why(result) {
            VStack(alignment: .leading, spacing: 6) {
                SectionTitle(text: L10n.why(lang))
                Text(why)
                    .brandText(TypeStyle(face: .inter, weight: 400, size: 15, lineHeight: 1.5))
                    .foregroundStyle(Brand.ink)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

/// Who won which point of a split ruling, or the if/then lines of a
/// conditional one.
struct VerdictBranches: View {
    let result: VerdictResult
    let parties: PartyNames
    var restoredNames: [String] = []
    let lang: AppLang

    var body: some View {
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
                    let lead = ConditionalClause.lead(branch.ifValue, lang: lang, keep: keep)
                    Branch(tint: Brand.paper, rule: nil) {
                        LeadText(lead: lead, leadColor: Brand.ink2, rest: " \(ConditionalClause.arrow(lang)) " + branch.then)
                    }
                }
            }
        }
    }
}

/// "Sam is right" in the winner's colour, then "●●● Confidence 3 of 3"
/// (or the split note when there is no majority).
struct RulingLine: View {
    let result: VerdictResult
    let parties: PartyNames
    let lang: AppLang

    var body: some View {
        let label = VerdictDisplay.label(result.verdict, parties: parties, lang: lang)
        HStack(spacing: 10) {
            Text(label)
                .brandText(TypeStyle(face: .interTight, weight: 800, size: 13, lineHeight: 1.2, tracking: 0.1, textStyle: .footnote, maxScale: 1.6, uppercase: true))
                .foregroundStyle(color)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
            if let confidence = VerdictDisplay.confidenceLabel(result, lang: lang) {
                HStack(spacing: 4) {
                    ForEach(Array(result.runs.enumerated()), id: \.offset) { _, run in
                        VoteDot(vote: VerdictDisplay.vote(run))
                    }
                }
                .accessibilityHidden(true)
                Text(confidence)
                    .brandText(TypeStyle(face: .inter, weight: 600, size: 13, lineHeight: 1.3, textStyle: .footnote, maxScale: 1.6))
                    .foregroundStyle(Brand.ink)
                    .multilineTextAlignment(.trailing)
            }
        }
        .accessibilityElement(children: .combine)
    }

    private var color: Color {
        switch result.verdict {
        case .sideA: return Brand.terraInk
        case .sideB: return Brand.sageInk
        default: return Brand.ink2
        }
    }
}

/// The notes on how the ruling came about: the forced lean, the
/// cross-examination of the crux, a refusal and the demo note.
struct VerdictNotes: View {
    let result: VerdictResult
    let parties: PartyNames
    let lang: AppLang

    var body: some View {
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
        if result.modelRefused {
            Slot { SlotText(L10n.refusedNote(lang)) }
        }
        if result.demo {
            Slot { SlotText(L10n.demoNote(lang)) }
        }
    }
}

/// Share (filled) and "Add context & appeal" (outlined) under the ruling.
/// Without the second, copy link takes its slot; with it, copying is left
/// to the share sheet so both labels fit.
struct VerdictActions: View {
    /// Nil hides share and copy (a removed case: its links are closed).
    let shareURL: URL?
    /// The anonymized original headline (anything that leaves the phone
    /// stays anonymized).
    let shareSubject: String
    let lang: AppLang
    var onAddContext: (() -> Void)? = nil
    @State private var copied = false

    var body: some View {
        if shareURL != nil || onAddContext != nil {
            HStack(spacing: 8) {
                if let shareURL {
                    ShareLink(item: shareURL, subject: Text(shareSubject), message: Text(L10n.shareText(lang))) {
                        Label(L10n.share(lang), systemImage: "square.and.arrow.up")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(CardActionStyle(filled: true))
                }
                if let onAddContext {
                    Button(action: onAddContext) {
                        Text(L10n.appAppealTitle(lang))
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(CardActionStyle(filled: false))
                }
                if let shareURL, onAddContext == nil {
                    Button {
                        UIPasteboard.general.url = shareURL
                        copied = true
                    } label: {
                        Label(copied ? L10n.copied(lang) : L10n.copyLink(lang), systemImage: copied ? "checkmark" : "link")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(CardActionStyle(filled: false))
                    .task(id: copied) {
                        guard copied else { return }
                        try? await Task.sleep(for: .seconds(2))
                        if !Task.isCancelled { copied = false }
                    }
                }
            }
        }
    }
}

/// "Translated from Turkish", or the translation still loading or failed.
private struct TranslationNote: View {
    let note: String
    let loading: Bool

    var body: some View {
        HStack(spacing: 7) {
            if loading {
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
    }
}

// MARK: - Pieces

/// One side's bedrock in its tint, on the details screen.
struct BedrockTile: View {
    let name: String
    let text: String
    let color: Color
    let tint: Color

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
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(tint))
        .accessibilityElement(children: .combine)
    }
}

/// 52 pt buttons under the ruling: ink when filled, paper with a hairline otherwise.
private struct CardActionStyle: ButtonStyle {
    let filled: Bool

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .brandText(TypeStyle(face: .interTight, weight: 600, size: 15, lineHeight: 1.2, textStyle: .headline, maxScale: 1.6))
            .foregroundStyle(filled ? Brand.ivory : Brand.ink)
            .lineLimit(1)
            .minimumScaleFactor(0.8)
            .padding(.horizontal, 12)
            .frame(minHeight: 52)
            .background(RoundedRectangle(cornerRadius: Radius.field, style: .continuous).fill(filled ? Brand.ink : (configuration.isPressed ? Brand.ivory : Brand.paper)))
            .overlay(RoundedRectangle(cornerRadius: Radius.field, style: .continuous).strokeBorder(filled ? Color.clear : Brand.line2, lineWidth: 1))
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
