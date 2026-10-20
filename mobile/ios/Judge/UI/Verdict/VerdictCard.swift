import CoreText
import SwiftUI
import UIKit

/// The paper verdict card, in the order of the web's VerdictView /
/// VerdictReveal: top row, tug bar, badge, seal and label, headline,
/// confidence meter, lean / trial / refusal notes, branches, crux, best
/// point, votes footnote and actions.
struct VerdictCard: View {
    let result: VerdictResult
    let parties: PartyNames
    /// Real names restored into the text: a conditional clause opening with
    /// one keeps its capital.
    var restoredNames: [String] = []
    let lang: AppLang
    let status: TranslationStatus
    let shareURL: URL
    /// The anonymized original headline (anything that leaves the phone
    /// stays anonymized).
    let shareSubject: String
    var onJudgeAnother: (() -> Void)?

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var copied = false
    @State private var appeared = false

    private var label: String { VerdictDisplay.label(result.verdict, parties: parties, lang: lang) }
    private var refused: Bool { result.modelRefused }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            topRow
            TugBar(parties: parties, tugA: VerdictDisplay.tugFinal(result), accessibilityText: L10n.verdictAria(lang, label: label))
            mainBlock
            branches
            if !refused {
                CruxBlock(title: L10n.cruxShort(lang), text: result.crux)
            }
            if !refused, !result.losingSideBestPoint.isEmpty {
                BestPointBlock(title: L10n.bestPointTitle(lang), text: result.losingSideBestPoint)
            }
            footnote
            actions
        }
        .padding(.horizontal, 20)
        .padding(.top, 26)
        .padding(.bottom, 20)
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
        HStack(spacing: 10) {
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
                .accessibilityHidden(true)
            }
            if result.isPremium {
                Text(L10n.premiumBadge(lang))
                    .brandText(.micro)
                    .foregroundStyle(Brand.ivory)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(Capsule().fill(Brand.ink))
            }
            Spacer(minLength: 0)
            HStack(spacing: 5) {
                ForEach(Array(result.runs.enumerated()), id: \.offset) { _, run in
                    VoteDot(vote: VerdictDisplay.vote(run))
                }
            }
            .accessibilityHidden(true)
        }
        .frame(minHeight: 22)
    }

    private var mainBlock: some View {
        VStack(spacing: 10) {
            if let badge = VerdictDisplay.badge(result.disputeType, lang: lang) {
                Text(badge)
                    .brandText(TypeStyle(face: .inter, weight: 700, size: 11, lineHeight: 1.2, tracking: 0.1, textStyle: .caption2, maxScale: 1.6, uppercase: true))
                    .foregroundStyle(Brand.ink2)
                    .padding(.horizontal, 11)
                    .padding(.vertical, 5)
                    .background(Capsule().fill(Brand.paper))
                    .overlay(Capsule().strokeBorder(Brand.line2, lineWidth: 1))
            }
            verdictLabel
            if !result.headline.isEmpty {
                Text(result.headline)
                    .brandText(.headline)
                    .foregroundStyle(Brand.ink2)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
            ConfidenceMeter(value: result.confidence, lang: lang)
                .padding(.top, 6)
            slots
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 16)
        .padding(.top, 22)
        .padding(.bottom, 20)
        .background(
            RoundedRectangle(cornerRadius: Radius.block, style: .continuous)
                .fill(LinearGradient(colors: [Color(hex: 0xFBF7F0), Color(hex: 0xF7F1E7)], startPoint: .top, endPoint: .bottom))
        )
        .overlay(RoundedRectangle(cornerRadius: Radius.block, style: .continuous).strokeBorder(Brand.line, lineWidth: 1))
    }

    private var verdictLabel: some View {
        let count = label.unicodeScalars.count
        let long = count > VerdictDisplay.longLabelLength
        let stacked = count > VerdictDisplay.stackLabelLength
        let text = Text(label)
            .brandText(long ? .verdictLabelLong : .verdictLabel)
            .foregroundStyle(Brand.ink)
            .multilineTextAlignment(.center)
            .fixedSize(horizontal: false, vertical: true)
        return Group {
            if stacked {
                VStack(spacing: 10) {
                    Seal(side: VerdictDisplay.seal(result.verdict))
                    text
                }
            } else {
                HStack(spacing: 12) {
                    Seal(side: VerdictDisplay.seal(result.verdict))
                    text
                }
            }
        }
        .padding(.top, 2)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
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
            }
            .brandText(.footnote)
            .foregroundStyle(Brand.muted)
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)
        }
    }

    private var actions: some View {
        let message = L10n.shareText(lang)
        return ViewThatFits(in: .horizontal) {
            HStack(spacing: 8) { shareButtons(message: message); Spacer(minLength: 8); judgeAnotherButton }
            VStack(alignment: .leading, spacing: 8) { HStack(spacing: 8) { shareButtons(message: message) }; judgeAnotherButton }
        }
        .padding(.top, 2)
    }

    @ViewBuilder
    private func shareButtons(message: String) -> some View {
        ShareLink(item: shareURL, subject: Text(shareSubject), message: Text(message)) {
            Label(L10n.share(lang), systemImage: "square.and.arrow.up")
        }
        .buttonStyle(GhostButtonStyle())
        Button {
            UIPasteboard.general.url = shareURL
            copied = true
        } label: {
            Label(copied ? L10n.copied(lang) : L10n.copyLink(lang), systemImage: copied ? "checkmark" : "link")
        }
        .buttonStyle(GhostButtonStyle())
        .task(id: copied) {
            guard copied else { return }
            try? await Task.sleep(for: .seconds(2))
            if !Task.isCancelled { copied = false }
        }
    }

    @ViewBuilder
    private var judgeAnotherButton: some View {
        if let onJudgeAnother {
            Button(L10n.judgeAnother(lang), action: onJudgeAnother)
                .buttonStyle(LinkButtonStyle())
        }
    }
}

// MARK: - Pieces

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

/// Party names over the tug-of-war bar (A's share against B's).
struct TugBar: View {
    let parties: PartyNames
    let tugA: Int
    let accessibilityText: String

    var body: some View {
        VStack(spacing: 8) {
            HStack(spacing: 12) {
                HStack(spacing: 6) {
                    Circle().fill(Brand.terra).frame(width: 9, height: 9)
                    Text(parties.nameA).lineLimit(1).truncationMode(.tail)
                }
                Spacer(minLength: 0)
                HStack(spacing: 6) {
                    Text(parties.nameB).lineLimit(1).truncationMode(.tail)
                    Circle().fill(Brand.sageStrong).frame(width: 9, height: 9)
                }
            }
            .brandText(TypeStyle(face: .inter, weight: 600, size: 13, lineHeight: 1.3, textStyle: .footnote))
            .foregroundStyle(Brand.ink2)
            GeometryReader { proxy in
                let share = CGFloat(max(0, min(100, tugA))) / 100
                ZStack(alignment: .leading) {
                    Capsule().fill(Brand.sageStrong)
                    UnevenRoundedRectangle(topLeadingRadius: 5, bottomLeadingRadius: 5, style: .continuous)
                        .fill(Brand.terra)
                        .frame(width: proxy.size.width * share)
                    Circle()
                        .fill(Brand.paper)
                        .overlay(Circle().strokeBorder(Brand.ink, lineWidth: 2))
                        .frame(width: 18, height: 18)
                        .shadow(color: .black.opacity(0.18), radius: 3, y: 2)
                        .offset(x: proxy.size.width * share - 9)
                }
            }
            .frame(height: 10)
            .padding(.vertical, 4)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText)
    }
}

private struct Seal: View {
    let side: VerdictDisplay.Seal

    var body: some View {
        ZStack {
            Circle().fill(color)
            Circle().fill(LinearGradient(colors: [.white.opacity(0.18), .black.opacity(0.12)], startPoint: .top, endPoint: .bottom))
            Canvas { context, size in
                let s = size.width / 16
                if side == .none {
                    var beam = Path()
                    beam.move(to: CGPoint(x: 2.5 * s, y: 6.5 * s))
                    beam.addLine(to: CGPoint(x: 13.5 * s, y: 6.5 * s))
                    context.stroke(beam, with: .color(.white), style: StrokeStyle(lineWidth: 2 * s, lineCap: .round))
                    var pivot = Path()
                    pivot.move(to: CGPoint(x: 8 * s, y: 6.5 * s))
                    pivot.addLine(to: CGPoint(x: 5.6 * s, y: 12.5 * s))
                    pivot.addLine(to: CGPoint(x: 10.4 * s, y: 12.5 * s))
                    pivot.closeSubpath()
                    context.fill(pivot, with: .color(.white))
                } else {
                    var check = Path()
                    check.move(to: CGPoint(x: 3.5 * s, y: 8.4 * s))
                    check.addLine(to: CGPoint(x: 6.6 * s, y: 11.4 * s))
                    check.addLine(to: CGPoint(x: 12.6 * s, y: 4.9 * s))
                    context.stroke(check, with: .color(.white), style: StrokeStyle(lineWidth: 2.2 * s, lineCap: .round, lineJoin: .round))
                }
            }
            .frame(width: 17, height: 17)
        }
        .frame(width: 34, height: 34)
        .accessibilityHidden(true)
    }

    private var color: Color {
        switch side {
        case .a: return Brand.terraInk
        case .b: return Brand.sageInk
        case .none: return Brand.ink
        }
    }
}

/// Five bars plus "High confidence · 4/5".
struct ConfidenceMeter: View {
    let value: Int
    let lang: AppLang

    var body: some View {
        let n = VerdictDisplay.clampedConfidence(value)
        VStack(spacing: 8) {
            HStack(spacing: 5) {
                ForEach(1...5, id: \.self) { index in
                    Capsule()
                        .fill(index <= n ? Brand.ink : Brand.ink.opacity(0.1))
                        .frame(width: 30, height: 7)
                }
            }
            .accessibilityHidden(true)
            Text(VerdictDisplay.confidenceText(value, lang: lang))
                .brandText(.slotTitle)
                .foregroundStyle(Brand.ink2)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(L10n.confidenceAria(lang, n: String(n)))
        .accessibilityValue(VerdictDisplay.confidenceText(value, lang: lang))
    }
}

private struct Slot<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        VStack(spacing: 4) { content }
            .multilineTextAlignment(.center)
            .frame(maxWidth: 420)
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

/// Dashed box with a diamond kicker; short cruxes in the display serif.
struct CruxBlock: View {
    let title: String
    let text: String

    var body: some View {
        let serif = CruxStyle.of(text) == .serif
        VStack(spacing: 6) {
            HStack(spacing: 7) {
                Rectangle()
                    .fill(Brand.ink)
                    .frame(width: 8, height: 8)
                    .rotationEffect(.degrees(45))
                    .accessibilityHidden(true)
                Kicker(text: title)
            }
            Text(text)
                .brandText(serif ? .cruxSerif : .cruxSans)
                .foregroundStyle(Brand.ink)
                .multilineTextAlignment(serif ? .center : .leading)
                .frame(maxWidth: .infinity, alignment: serif ? .center : .leading)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 16)
        .background(RoundedRectangle(cornerRadius: 20, style: .continuous).fill(Brand.paper))
        .overlay(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .strokeBorder(Brand.dash, style: StrokeStyle(lineWidth: 1.5, dash: [5, 4]))
        )
        .accessibilityElement(children: .combine)
    }
}

/// The other side's best point, on a terracotta left rule.
struct BestPointBlock: View {
    let title: String
    let text: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Kicker(text: title)
            Text(text)
                .brandText(TypeStyle(face: .inter, weight: 400, size: 15, lineHeight: 1.5))
                .foregroundStyle(Brand.ink2)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 14)
        .padding(.leading, 20)
        .padding(.trailing, 16)
        .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Brand.bestPoint))
        .overlay(alignment: .leading) {
            Rectangle().fill(Brand.terra).frame(width: 4)
        }
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(Brand.line, lineWidth: 1))
        .accessibilityElement(children: .combine)
    }
}
