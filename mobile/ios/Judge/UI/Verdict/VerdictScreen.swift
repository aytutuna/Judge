import SwiftUI

/// The verdict card plus the argument map, fact check and facts below it.
/// The text follows the UI language: a verdict written in the other
/// language is fetched translated (and cached in history) with the original
/// kept for switching back.
struct VerdictScreen: View {
    @Environment(AppModel.self) private var app
    let session: VerdictSession
    var onJudgeAnother: (() -> Void)?

    var body: some View {
        VerdictScreenContent(app: app, session: session, onJudgeAnother: onJudgeAnother)
    }
}

private struct VerdictScreenContent: View {
    let app: AppModel
    let onJudgeAnother: (() -> Void)?
    @State private var model: VerdictModel
    @State private var webLink: WebLink?

    @MainActor
    init(app: AppModel, session: VerdictSession, onJudgeAnother: (() -> Void)?) {
        self.app = app
        self.onJudgeAnother = onJudgeAnother
        let history = app.history
        let home = app.home
        _model = State(initialValue: VerdictModel(session: session, api: app.api) { updated, lang, raw in
            home.updateSession(updated)
            try? history.cacheTranslation(id: updated.id, lang: lang, json: raw.json)
        })
    }

    var body: some View {
        let lang = app.lang
        let session = model.session
        let view = model.view(for: lang)
        let selfLang = session.sourceLang
        let parties = Names.partyNames(session.nameMap, lang: lang, selfLang: selfLang)
        // Real names go back into the shown text only; the session, history
        // and share subject keep the anonymized text.
        let result = Names.personalizeResult(view.result, nameMap: session.nameMap, selfLang: selfLang)
        ScrollView {
            VStack(spacing: 28) {
                VerdictCard(
                    result: result,
                    parties: parties,
                    restoredNames: Names.restoredNames(session.nameMap, selfLang: selfLang),
                    lang: lang,
                    status: view.status,
                    shareURL: app.config.shareURL(id: session.id),
                    shareSubject: session.original.result.headline,
                    onJudgeAnother: onJudgeAnother
                )
                if !result.modelRefused {
                    ArgumentMapView(map: result.argumentMap, parties: parties, lang: lang)
                    if let factCheck = result.factCheck {
                        FactCheckView(factCheck: factCheck, lang: lang) { url in webLink = WebLink(url: url) }
                    }
                    FactsView(facts: result.factsReliedOn, lang: lang)
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 8)
            .padding(.bottom, 32)
            .opacity(view.status == .loading ? 0.55 : 1)
            .animation(.easeOut(duration: 0.25), value: view.status == .loading)
        }
        .background(Brand.ivory.ignoresSafeArea())
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Brand.ivory, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                LangToggle(lang: lang) { app.setLangPreference($0 == .en ? .en : .tr) }
            }
        }
        .onAppear { model.ensure(lang) }
        .onChange(of: lang) { _, newLang in model.languageChanged(to: newLang) }
        .sheet(item: $webLink) { link in
            SafariView(url: link.url).ignoresSafeArea()
        }
    }
}
