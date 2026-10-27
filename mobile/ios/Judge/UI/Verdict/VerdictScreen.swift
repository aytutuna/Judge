import SwiftUI

/// The verdict card plus the argument map, fact check and facts below it.
/// The text follows the UI language: a verdict written in the other
/// language is fetched translated (and cached in history) with the original
/// kept for switching back. A fresh verdict stays in its thread: the
/// judges' badge and the settled scene above the card, with no tab bar; the header's "+" starts the next one. The signed-in writer
/// can add context under the card; a round's verdict then takes its place.
struct VerdictScreen: View {
    @Environment(AppModel.self) private var app
    let session: VerdictSession
    /// A fresh verdict: shows the thread.
    var thread = false

    var body: some View {
        VerdictScreenContent(app: app, session: session, thread: thread)
    }
}

private struct VerdictScreenContent: View {
    let app: AppModel
    let thread: Bool
    @State private var model: VerdictModel
    /// The writer's "Add context" (nothing shows for anyone else).
    @State private var appeal: VerdictAppealModel
    @State private var webLink: WebLink?
    @State private var showPricing = false
    @Environment(\.dismiss) private var dismiss

    private static let topID = "verdict.top"
    private static let appealID = "verdict.appeal"

    @MainActor
    init(app: AppModel, session: VerdictSession, thread: Bool) {
        self.app = app
        self.thread = thread
        let history = app.history
        let home = app.home
        let verdict = VerdictModel(session: session, api: app.api) { updated, lang, raw in
            home.updateSession(updated)
            try? history.cacheTranslation(id: updated.id, lang: lang, json: raw.json)
        }
        _model = State(initialValue: verdict)
        // A round's verdict takes over the screen, the thread's session and
        // the saved entry.
        let adding = VerdictAppealModel(id: session.id, api: app.api, account: app.account, shown: { verdict.session }) { next in
            verdict.show(next, lang: app.lang)
            home.updateSession(next)
            try? history.saveRuling(next)
        }
        adding.usesNetwork = app.usesNetwork
        #if DEBUG
        if let seed = app.appealSeed { adding.showForScreenshot(gate: seed.gate, text: seed.text) }
        #endif
        _appeal = State(initialValue: adding)
    }

    var body: some View {
        let lang = app.lang
        let signedIn = app.account.isSignedIn
        ScrollViewReader { proxy in
            ScrollView {
                VStack(spacing: 16) {
                    if thread {
                        VerdictThreadHead(result: model.session.original.result, lang: lang)
                    }
                    VerdictSections(
                        model: model,
                        lang: lang,
                        shareURL: app.config.shareURL(id: model.session.id),
                        openURL: { url in webLink = WebLink(url: url) },
                        onAddContext: signedIn && appeal.offered ? { appeal.openForm() } : nil
                    )
                    if signedIn, appeal.panel {
                        AppealSection(
                            model: appeal,
                            area: appeal.area,
                            lead: L10n.appealLeadVerdict(lang),
                            evidenceOn: app.account.features.evidence,
                            lang: lang
                        ) {
                            showPricing = true
                        }
                        .id(Self.appealID)
                    }
                }
                .id(Self.topID)
                .padding(.horizontal, 16)
                .padding(.top, 8)
                .padding(.bottom, 32)
            }
            .task {
                // Screenshot states open with the form out: show it under the card.
                guard appeal.open else { return }
                try? await Task.sleep(for: .milliseconds(300))
                proxy.scrollTo(Self.appealID, anchor: .bottom)
            }
            .onChange(of: appeal.open) { _, open in
                guard open else { return }
                withAnimation { proxy.scrollTo(Self.appealID, anchor: .top) }
            }
            .onChange(of: appeal.finished) { _, finished in
                // Back up to the outcome banner over the new verdict.
                guard finished else { return }
                withAnimation { proxy.scrollTo(Self.topID, anchor: .top) }
            }
        }
        .task(id: signedIn) {
            if signedIn { await appeal.load() }
        }
        .task(id: appeal.judgingID) {
            if let round = appeal.judgingID { await appeal.follow(round) }
        }
        .sheet(isPresented: $showPricing) {
            NavigationStack { PricingView() }
                .environment(app)
        }
        .background(Brand.ivory.ignoresSafeArea())
        // The thread has no tab bar: the header's "+" is the way back.
        .toolbar(thread ? .hidden : .automatic, for: .tabBar)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Brand.ivory, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                NewArgumentButton(lang: lang) {
                    app.newArgument()
                    dismiss()
                }
                .disabled(app.home.isBusy)
            }
        }
        .sheet(item: $webLink) { link in
            SafariView(url: link.url).ignoresSafeArea()
        }
    }
}

/// The thread above a fresh verdict: how far the judges agreed and the
/// balance settled on the ruling.
private struct VerdictThreadHead: View {
    let result: VerdictResult
    let lang: AppLang

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            JudgesBadge(label: VerdictDisplay.judgesLabel(result, lang: lang))
            SceneView(mode: VerdictDisplay.sceneVerdict(result))
                .frame(maxWidth: .infinity)
                .frame(height: 180)
                .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                .padding(12)
                .paperSurface(radius: Radius.card)
                .softShadow()
        }
    }
}

/// One verdict as the web's VerdictView shows it: the appeal outcome (when
/// an appeal produced it), the card, then the two-sided facts, the argument
/// map, the web fact check and the facts relied on. Embeddable (the verdict
/// screen and case pages). Real names go back into the shown text only; the
/// session, history and share subject keep the anonymized text.
struct VerdictSections: View {
    let model: VerdictModel
    let lang: AppLang
    /// Nil hides the share buttons.
    let shareURL: URL?
    let openURL: (URL) -> Void
    /// The card's "Add context", for the writer.
    var onAddContext: (() -> Void)? = nil

    var body: some View {
        let session = model.session
        let view = model.view(for: lang)
        let selfLang = session.sourceLang
        let parties = Names.partyNames(session.nameMap, lang: lang, selfLang: selfLang)
        let result = Names.personalizeResult(view.result, nameMap: session.nameMap, selfLang: selfLang)
        VStack(spacing: 28) {
            if let appeal = result.appeal {
                AppealOutcomeBanner(
                    appeal: appeal,
                    lang: lang,
                    byName: parties.name(appeal.by),
                    bySelf: appeal.by != .unknown && parties.isSelf(appeal.by)
                )
            }
            VerdictCard(
                result: result,
                parties: parties,
                restoredNames: Names.restoredNames(session.nameMap, selfLang: selfLang),
                lang: lang,
                status: view.status,
                shareURL: shareURL,
                shareSubject: session.original.result.headline,
                onAddContext: onAddContext
            )
            if !result.modelRefused {
                if result.twoSided {
                    TwoSidedFactsView(result: result, parties: parties, lang: lang)
                }
                ArgumentMapView(map: result.argumentMap, parties: parties, lang: lang)
                if let factCheck = result.factCheck {
                    FactCheckView(factCheck: factCheck, disputeType: result.disputeType, lang: lang, openURL: openURL)
                }
                FactsView(facts: result.factsReliedOn, lang: lang)
            }
        }
        .opacity(view.status == .loading ? 0.55 : 1)
        .animation(.easeOut(duration: 0.25), value: view.status == .loading)
        .onAppear { model.ensure(lang) }
        .onChange(of: lang) { _, newLang in model.languageChanged(to: newLang) }
    }
}
