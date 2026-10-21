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
        ScrollView {
            VerdictSections(
                model: model,
                lang: lang,
                shareURL: app.config.shareURL(id: model.session.id),
                onJudgeAnother: onJudgeAnother
            ) { url in
                webLink = WebLink(url: url)
            }
            .padding(.horizontal, 16)
            .padding(.top, 8)
            .padding(.bottom, 32)
        }
        .background(Brand.ivory.ignoresSafeArea())
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Brand.ivory, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                LangToggle(lang: lang) { app.setLangPreference($0 == .en ? .en : .tr) }
            }
        }
        .sheet(item: $webLink) { link in
            SafariView(url: link.url).ignoresSafeArea()
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
    var onJudgeAnother: (() -> Void)?
    let openURL: (URL) -> Void

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
                    confidence: result.confidence,
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
                onJudgeAnother: onJudgeAnother
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
