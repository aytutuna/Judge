import SwiftUI

/// The ruling card, the rows that open its details and the share actions.
/// The text follows the UI language: a verdict written in the other
/// language is fetched translated (and cached in history) with the original
/// kept for switching back. A fresh verdict has no tab bar; the header's
/// "+" starts the next one. The signed-in writer can add context in a
/// sheet; a round's verdict then takes the card's place.
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
    /// The writer's "Add context & appeal" (nothing shows for anyone else).
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
                    VerdictSections(
                        model: model,
                        lang: lang,
                        shareURL: app.config.shareURL(id: model.session.id),
                        openURL: { url in webLink = WebLink(url: url) },
                        appealArea: signedIn ? appeal.area : CaseLogic.AppealArea.none,
                        appealStartsOpen: appeal.open,
                        onAppealOpen: { appeal.openForm() }
                    ) {
                        AppealSheet(
                            model: appeal,
                            area: appeal.area,
                            cost: L10n.appAppealCost(lang, left: String(appeal.rounds.map(CaseLogic.appealsLeft) ?? CaseLogic.maxVerdictAppeals)),
                            evidenceOn: app.account.features.evidence,
                            lang: lang
                        )
                        .environment(app)
                    }
                    // The judging, busy and limit lines; the form is in the sheet.
                    if signedIn, appeal.panel, !appeal.area.inSheet {
                        AppealSection(
                            model: appeal,
                            area: appeal.area,
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
                // Screenshot states with a note out: show it under the card.
                guard appeal.panel, !appeal.area.inSheet else { return }
                try? await Task.sleep(for: .milliseconds(300))
                proxy.scrollTo(Self.appealID, anchor: .bottom)
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

/// One verdict as the web's VerdictView opens it: the appeal outcome (when
/// an appeal produced it), the ruling card, the rows into the details
/// screen and the actions. Embeddable (the verdict screen and case pages).
/// Real names go back into the shown text only; the session, history and
/// share subject keep the anonymized text.
struct VerdictSections<Appeal: View>: View {
    let model: VerdictModel
    let lang: AppLang
    /// Nil hides the share buttons.
    let shareURL: URL?
    let openURL: (URL) -> Void
    /// Where the writer's "Add context & appeal" stands: the button shows
    /// while the sheet has something to offer.
    var appealArea: CaseLogic.AppealArea = .none
    /// Opens the sheet as the screen comes up (screenshot states).
    var appealStartsOpen = false
    var onAppealOpen: () -> Void = {}
    /// The sheet's content.
    @ViewBuilder var appeal: () -> Appeal

    @State private var showDetails = false
    /// A sheet is presented from the screen on top: the card's, or the
    /// details screen's while that one is pushed.
    @State private var appealShown = false
    @State private var detailsAppealShown = false
    @State private var openedAtStart = false

    var body: some View {
        let session = model.session
        let view = model.view(for: lang)
        let selfLang = session.sourceLang
        let parties = Names.partyNames(session.nameMap, lang: lang, selfLang: selfLang)
        let result = Names.personalizeResult(view.result, nameMap: session.nameMap, selfLang: selfLang)
        let offered = appealArea.inSheet
        VStack(spacing: 12) {
            if let outcome = result.appeal {
                AppealOutcomeBanner(
                    appeal: outcome,
                    lang: lang,
                    byName: parties.name(outcome.by),
                    bySelf: outcome.by != .unknown && parties.isSelf(outcome.by)
                )
                .padding(.bottom, 8)
            }
            VerdictCard(
                result: result,
                parties: parties,
                restoredNames: Names.restoredNames(session.nameMap, selfLang: selfLang),
                lang: lang,
                status: view.status
            )
            if !result.modelRefused {
                VerdictReasons(result: result, parties: parties, lang: lang) { showDetails = true }
            }
            VerdictActions(
                shareURL: shareURL,
                shareSubject: session.original.result.headline,
                lang: lang,
                onAddContext: offered ? { openAppeal() } : nil
            )
            .padding(.top, 4)
        }
        .opacity(view.status == .loading ? 0.55 : 1)
        .animation(.easeOut(duration: 0.25), value: view.status == .loading)
        .sheet(isPresented: $appealShown, content: appeal)
        .navigationDestination(isPresented: $showDetails) {
            VerdictDetails(
                model: model,
                lang: lang,
                shareURL: shareURL,
                openURL: openURL,
                onAddContext: offered ? { openAppeal() } : nil,
                appealShown: $detailsAppealShown,
                appeal: appeal
            )
        }
        .onChange(of: appealArea) { old, new in
            if !new.inSheet {
                appealShown = false
                detailsAppealShown = false
            } else if old == .judging, case .form(failed: .some) = new {
                // The round failed: back to the form, which says why.
                openAppeal()
            }
        }
        .task {
            // Only the first time: coming back from the details runs this again.
            guard !openedAtStart else { return }
            openedAtStart = true
            guard appealStartsOpen, offered else { return }
            try? await Task.sleep(for: .milliseconds(300))
            appealShown = true
        }
        .onAppear { model.ensure(lang) }
        .onChange(of: lang) { _, newLang in model.languageChanged(to: newLang) }
    }

    private func openAppeal() {
        onAppealOpen()
        if showDetails {
            detailsAppealShown = true
        } else {
            appealShown = true
        }
    }
}
