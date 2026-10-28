import SwiftUI
import UIKit

/// The rows under the ruling card that open the details screen: the crux,
/// both sides' bedrock and the losing side's best point, when there are.
struct VerdictReasons: View {
    let result: VerdictResult
    let parties: PartyNames
    let lang: AppLang
    let onOpen: () -> Void

    var body: some View {
        let map = result.argumentMap
        let rows = [
            result.crux.isEmpty ? nil : L10n.cruxShort(lang),
            map.bedrockA.isEmpty && map.bedrockB.isEmpty && map.sideA.isEmpty && map.sideB.isEmpty ? nil : L10n.appVerdictSides(lang),
            result.losingSideBestPoint.isEmpty ? nil : VerdictDisplay.bestPointTitle(result.verdict, parties: parties, lang: lang),
        ].compactMap { $0 }
        if !rows.isEmpty {
            VStack(spacing: 0) {
                ForEach(Array(rows.enumerated()), id: \.offset) { index, title in
                    if index > 0 {
                        Rectangle().fill(Brand.line).frame(height: 1)
                    }
                    Button(action: onOpen) {
                        HStack {
                            Text(title)
                                .brandText(TypeStyle(face: .inter, weight: 600, size: 15, lineHeight: 1.3, textStyle: .subheadline))
                                .foregroundStyle(Brand.ink)
                                .multilineTextAlignment(.leading)
                            Spacer(minLength: 8)
                            Image(systemName: "chevron.right")
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(Brand.muted)
                                .accessibilityHidden(true)
                        }
                        .padding(.horizontal, 16)
                        .padding(.vertical, 12)
                        .frame(minHeight: 52)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
            .paperSurface(radius: Radius.block)
        }
    }
}

/// Every part of a ruling on its own screen, pushed from the card: the
/// appeal outcome, the summary with any branches, the crux, what each side
/// stands on and how they got there, the losing side's best point, the
/// facts relied on, the two-sided facts, the web check, what would change
/// it and the votes. Sections without data are left out.
struct VerdictDetails<Appeal: View>: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    let model: VerdictModel
    let lang: AppLang
    let shareURL: URL?
    var onAddContext: (() -> Void)?
    /// The "Add context & appeal" sheet over this screen.
    @Binding var appealShown: Bool
    @ViewBuilder var appeal: () -> Appeal
    @State private var webLink: WebLink?

    var body: some View {
        let session = model.session
        let view = model.view(for: lang)
        let selfLang = session.sourceLang
        let parties = Names.partyNames(session.nameMap, lang: lang, selfLang: selfLang)
        let result = Names.personalizeResult(view.result, nameMap: session.nameMap, selfLang: selfLang)
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                if let outcome = result.appeal {
                    AppealOutcomeBanner(
                        appeal: outcome,
                        lang: lang,
                        byName: parties.name(outcome.by),
                        bySelf: outcome.by != .unknown && parties.isSelf(outcome.by)
                    )
                }
                summary(result, parties: parties, restoredNames: Names.restoredNames(session.nameMap, selfLang: selfLang))
                if !result.modelRefused {
                    sections(result, parties: parties)
                }
                votes(result, parties: parties)
                VerdictActions(
                    shareURL: shareURL,
                    shareSubject: session.original.result.headline,
                    lang: lang,
                    onAddContext: onAddContext
                )
                .padding(.top, 4)
            }
            .padding(.horizontal, 16)
            .padding(.top, 8)
            .padding(.bottom, 32)
        }
        .background(Brand.ivory.ignoresSafeArea())
        .background(EdgeSwipeBack().frame(width: 0, height: 0))
        .navigationBarBackButtonHidden(true)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Brand.ivory, for: .navigationBar)
        .toolbar(.hidden, for: .tabBar)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button {
                    dismiss()
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "chevron.left")
                            .font(.system(size: 16, weight: .semibold))
                        Text(L10n.appVerdictBack(lang))
                            .brandText(TypeStyle(face: .inter, weight: 600, size: 15, lineHeight: 1.2, textStyle: .subheadline, maxScale: 1.6))
                    }
                    .foregroundStyle(Brand.ink)
                    .frame(minHeight: 44)
                }
            }
            ToolbarItem(placement: .topBarTrailing) {
                NewArgumentButton(lang: lang) {
                    app.newArgument()
                    dismiss()
                }
                .disabled(app.home.isBusy)
            }
        }
        .sheet(isPresented: $appealShown, content: appeal)
        .sheet(item: $webLink) { link in
            SafariView(url: link.url).ignoresSafeArea()
        }
    }

    private func summary(_ result: VerdictResult, parties: PartyNames, restoredNames: [String]) -> some View {
        let label = VerdictDisplay.label(result.verdict, parties: parties, lang: lang)
        var style = TypeStyle.ruling
        style.size = 24
        return card {
            RulingLine(result: result, parties: parties, lang: lang)
            Text(result.headline.isEmpty ? label : result.headline)
                .brandText(style)
                .foregroundStyle(Brand.ink)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
            badges(result)
            VerdictNotes(result: result, parties: parties, lang: lang)
            VerdictBranches(result: result, parties: parties, restoredNames: restoredNames, lang: lang)
        }
    }

    @ViewBuilder
    private func badges(_ result: VerdictResult) -> some View {
        let kind = VerdictDisplay.badge(result.disputeType, lang: lang)
        if kind != nil || result.isPremium {
            FlowLayout(spacing: 8, rowSpacing: 6) {
                if let kind {
                    Kicker(text: kind)
                }
                if result.isPremium {
                    chip(L10n.premiumBadge(lang), color: Brand.ivory, fill: Brand.ink)
                    if result.twoSided {
                        chip(L10n.twoSidedBadge(lang), color: Brand.sageInk, fill: Brand.sageTint)
                    }
                }
            }
        }
    }

    private func chip(_ text: String, color: Color, fill: Color) -> some View {
        Text(text)
            .brandText(.micro)
            .foregroundStyle(color)
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(Capsule().fill(fill))
            .lineLimit(1)
            .minimumScaleFactor(0.7)
    }

    @ViewBuilder
    private func sections(_ result: VerdictResult, parties: PartyNames) -> some View {
        if !result.crux.isEmpty {
            card {
                SectionTitle(text: L10n.cruxShort(lang))
                Text(result.crux)
                    .brandText(TypeStyle(face: .serif, weight: 400, size: 21, lineHeight: 1.3, textStyle: .title3, maxScale: 1.5))
                    .foregroundStyle(Brand.ink)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        let map = result.argumentMap
        if !map.bedrockA.isEmpty || !map.bedrockB.isEmpty || !map.sideA.isEmpty || !map.sideB.isEmpty {
            card {
                SectionTitle(text: L10n.appVerdictSides(lang))
                if !map.bedrockA.isEmpty || !map.bedrockB.isEmpty {
                    HStack(spacing: 8) {
                        BedrockTile(name: parties.nameA, text: map.bedrockA, color: Brand.terraInk, tint: Brand.terraTint)
                        BedrockTile(name: parties.nameB, text: map.bedrockB, color: Brand.sageInk, tint: Brand.sageTint)
                    }
                    .fixedSize(horizontal: false, vertical: true)
                }
                if !map.sideA.isEmpty || !map.sideB.isEmpty {
                    claims(map)
                        .padding(.top, 4)
                }
            }
        }
        if !result.losingSideBestPoint.isEmpty {
            card {
                SectionTitle(text: VerdictDisplay.bestPointTitle(result.verdict, parties: parties, lang: lang))
                Text(result.losingSideBestPoint)
                    .brandText(TypeStyle(face: .inter, weight: 400, size: 15, lineHeight: 1.5))
                    .foregroundStyle(Brand.ink)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        if !result.factsReliedOn.isEmpty {
            card {
                FactsView(facts: result.factsReliedOn, lang: lang)
            }
        }
        if result.twoSided, !TwoSidedDisplay.agreed(result).isEmpty || !TwoSidedDisplay.disputed(result).isEmpty {
            card {
                TwoSidedFactsView(result: result, parties: parties, lang: lang)
            }
        }
        if let factCheck = result.factCheck {
            card {
                FactCheckView(factCheck: factCheck, disputeType: result.disputeType, lang: lang) { url in webLink = WebLink(url: url) }
            }
        }
        let changes = (result.wouldChange ?? []).filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        if !changes.isEmpty {
            card {
                WouldChangeBlock(items: changes, lang: lang)
            }
        }
    }

    /// "A · fact" and the claim, your side's first.
    private func claims(_ map: ArgumentMap) -> some View {
        let rows = map.sideA.map { (party: Party.a, claim: $0) } + map.sideB.map { (party: Party.b, claim: $0) }
        return VStack(alignment: .leading, spacing: 6) {
            Text(L10n.appVerdictClaims(lang))
                .brandText(TypeStyle(face: .inter, weight: 600, size: 12, lineHeight: 1.3, textStyle: .footnote))
                .foregroundStyle(Brand.muted)
            ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                let isA = row.party == .a
                let letter = isA ? "A" : "B"
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(VerdictDisplay.kind(row.claim.kind, lang: lang).map { letter + " · " + $0 } ?? letter)
                        .brandText(TypeStyle(face: .inter, weight: 700, size: 11, lineHeight: 1.2, textStyle: .caption2, maxScale: 1.6))
                        .foregroundStyle(isA ? Brand.terraInk : Brand.sageInk)
                        .lineLimit(1)
                        .padding(.horizontal, 7)
                        .padding(.vertical, 2)
                        .background(Capsule().fill(isA ? Brand.terraTint : Brand.sageTint))
                    Text(row.claim.claim)
                        .brandText(.claim)
                        .foregroundStyle(Brand.ink)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .accessibilityElement(children: .combine)
            }
        }
    }

    /// "Three judges ruled on their own: Sam · Sam · Alex", the panel and
    /// the evidence note.
    @ViewBuilder
    private func votes(_ result: VerdictResult, parties: PartyNames) -> some View {
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
            .brandText(TypeStyle(face: .inter, weight: 400, size: 13, lineHeight: 1.45, textStyle: .footnote))
            .foregroundStyle(Brand.muted)
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)
            .padding(.horizontal, 4)
        }
    }

    private func card<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 18)
        .padding(.vertical, 16)
        .paperSurface(radius: Radius.block)
    }
}

/// Hiding the back button for "‹ Ruling" also turns off the edge swipe back.
/// With no delegate the swipe always starts; the navigation controller's own
/// delegate comes back as the screen goes, so the root screen can't be swiped.
private struct EdgeSwipeBack: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> Controller { Controller() }

    func updateUIViewController(_ controller: Controller, context: Context) {}

    final class Controller: UIViewController {
        private weak var saved: (any UIGestureRecognizerDelegate)?

        override func viewDidAppear(_ animated: Bool) {
            super.viewDidAppear(animated)
            guard let pop = navigationController?.interactivePopGestureRecognizer else { return }
            if let delegate = pop.delegate { saved = delegate }
            pop.delegate = nil
        }

        override func viewWillDisappear(_ animated: Bool) {
            super.viewWillDisappear(animated)
            navigationController?.interactivePopGestureRecognizer?.delegate = saved
        }
    }
}
