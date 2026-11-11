import SwiftUI
import UIKit

/// /c/{id}: the owner's case page (components/case/CaseScreen.tsx).
struct CaseScreen: View {
    @Environment(AppModel.self) private var app
    let id: String

    var body: some View {
        CaseScreenContent(app: app, id: id)
    }
}

private enum CaseConfirm: Identifiable {
    case judgeNow(expired: Bool)
    case judgeAnswered(expired: Bool)
    case resetInvite
    case remove

    var id: String {
        switch self {
        case .judgeNow(let expired): return "judge-\(expired)"
        case .judgeAnswered(let expired): return "judge-answered-\(expired)"
        case .resetInvite: return "reset"
        case .remove: return "remove"
        }
    }
}

private struct CaseScreenContent: View {
    let app: AppModel
    @State private var model: CaseModel
    @State private var confirm: CaseConfirm?
    @State private var showConfirm = false
    @State private var showPricing = false
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.tabShown) private var tabShown

    private static let title = TypeStyle(face: .interTight, weight: 700, size: 30, lineHeight: 1.05, tracking: -0.03, textStyle: .title1, maxScale: 1.4)

    /// AppModel keeps one model per case, so a re-render reuses it.
    @MainActor
    init(app: AppModel, id: String) {
        self.app = app
        _model = State(initialValue: app.makeCaseModel(id: id))
    }

    var body: some View {
        let lang = app.lang
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                if let view = model.view {
                    header(view, lang: lang)
                    content(view, lang: lang)
                } else {
                    loadState(lang)
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 8)
            .padding(.bottom, 32)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .scrollDismissesKeyboard(.interactively)
        .scrollBounceBehavior(.basedOnSize)
        // The viewer's own party is green on everything below.
        .environment(\.sides, Sides(you: model.view?.yourParty))
        .background(Brand.ivory.ignoresSafeArea())
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Brand.ivory, for: .navigationBar)
        // Polling restarts whenever a new view arrives (generation), and
        // waits while the page's tab is hidden or the app is in the background.
        .task(id: tabShown && scenePhase == .active ? model.generation : -1) {
            guard tabShown, scenePhase == .active else { return }
            await model.run()
        }
        .onTabAppear {
            Task { await model.refresh() }
            app.analytics.track("screen_view", ["screen": "case_detail"])
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active, model.view.map(writesSide) == true { Task { await model.refresh() } }
        }
        .onChange(of: model.actionError) { _, error in
            if let error { app.analytics.track("error_shown", ["code": error.eventCode]) }
        }
        .refreshable { await model.refresh() }
        .onChange(of: app.account.isSignedIn) { _, signedIn in
            if signedIn, model.load == .signIn { Task { await model.refresh() } }
        }
        .sheet(isPresented: $showPricing) {
            NavigationStack { PricingView(inSheet: true) }
                .environment(app)
        }
        .alert(confirmTitle(lang), isPresented: $showConfirm, presenting: confirm) { item in
            Button(confirmYes(item, lang: lang), role: isDestructive(item) ? .destructive : nil) {
                Task { await run(item) }
            }
            Button(L10n.caseCancel(lang), role: .cancel) {}
        } message: { item in
            Text(confirmText(item, lang: lang))
        }
    }

    // MARK: - States

    @ViewBuilder
    private func loadState(_ lang: AppLang) -> some View {
        Text(L10n.caseTitle(lang))
            .brandText(Self.title)
            .foregroundStyle(Brand.ink)
        switch model.load {
        case .loading, .ready:
            HStack(spacing: 10) {
                ProgressView().tint(Brand.muted)
                Text(L10n.caseLoading(lang)).brandText(.body).foregroundStyle(Brand.muted)
            }
        case .missing:
            note(L10n.caseNotFound(lang))
        case .signIn:
            note(L10n.caseSignIn(lang))
            Button(L10n.navSignIn(lang)) { app.account.presentSignIn() }
                .buttonStyle(PrimaryButtonStyle())
        case .error:
            ErrorBanner(message: L10n.caseLoadFailed(lang), retryTitle: L10n.caseRetry(lang)) {
                Task { await model.refresh() }
            }
        }
    }

    private func header(_ view: CaseView, lang: AppLang) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            if writesSide(view) {
                writeHead(view, lang: lang)
            } else if view.status == .awaitingRespondent {
                waitingHead(view, lang: lang)
            } else {
                Text(L10n.caseTitle(lang))
                    .brandText(Self.title)
                    .foregroundStyle(Brand.ink)
                    .accessibilityAddTraits(.isHeader)
                CaseStatusChip(status: view.status, lang: lang)
            }
        }
    }

    /// The owner's side is still to be written, on a case the link started.
    private func writesSide(_ view: CaseView) -> Bool {
        view.role == .owner && view.ownerSideMissing && view.status == .awaitingRespondent
    }

    @ViewBuilder
    private func writeHead(_ view: CaseView, lang: AppLang) -> some View {
        Text(L10n.caseWriteTitle(lang))
            .brandText(Self.title)
            .foregroundStyle(Brand.ink)
            .accessibilityAddTraits(.isHeader)
        Text(view.respondentAnswered ? L10n.caseWriteLeadAnswered(lang) : L10n.caseWriteLead(lang))
            .brandText(TypeStyle(face: .inter, weight: 400, size: 14, lineHeight: 1.45, textStyle: .subheadline))
            .foregroundStyle(Brand.ink2)
            .fixedSize(horizontal: false, vertical: true)
    }

    @ViewBuilder
    private func waitingHead(_ view: CaseView, lang: AppLang) -> some View {
        Kicker(text: L10n.appCaseWaitingKicker(lang), color: Brand.sageInk)
        Text(view.isMany ? L10n.shellCaseWaiting(lang) : CaseLogic.statusText(.awaitingRespondent, lang: lang))
            .brandText(TypeStyle(face: .serif, weight: 400, size: 34, lineHeight: 1.04, textStyle: .largeTitle, maxScale: 1.3))
            .foregroundStyle(Brand.ink)
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityAddTraits(.isHeader)
    }

    @ViewBuilder
    private func content(_ view: CaseView, lang: AppLang) -> some View {
        if view.removed != nil {
            banner(model.removedNow ? L10n.caseRemoved(lang) : L10n.caseRemovedBanner(lang))
        }
        switch view.status {
        case .judging:
            Text(view.respondentAnswered ? L10n.caseAnswered(lang) : L10n.caseJudgingAlone(lang))
                .brandText(.body)
                .foregroundStyle(Brand.ink2)
                .accessibilityAddTraits(.updatesFrequently)
            CaseJudgingCard(lang: lang, premium: view.tier == .premium)
        case .awaitingRespondent:
            if view.role == .respondent, view.ownerSideMissing, view.respondentAnswered {
                note(L10n.respondSentWaiting(lang))
            } else {
                awaiting(view, lang: lang)
            }
        case .judged:
            if let current = view.current {
                let area = CaseLogic.appealArea(view)
                let evidenceOn = CaseLogic.appealEvidenceOn(view, features: app.account.features)
                if view.mode == .oneSided {
                    note(L10n.caseOneSided(lang))
                }
                CaseVerdictBlock(
                    app: app,
                    verdict: current,
                    names: model.names,
                    shareable: view.removed == nil,
                    appeal: (draft: model, area: area, evidenceOn: evidenceOn)
                )
                .id("\(current.id)-\(model.names.count)")
                // The judging, busy and used lines; the form is in the sheet.
                if !area.inSheet {
                    AppealSection(model: model, area: area, evidenceOn: evidenceOn, lang: lang) {
                        showPricing = true
                    }
                }
                VerdictHistory(app: app, view: view, names: model.names, lang: lang)
            }
        case .failed:
            banner(CaseLogic.failedBody(view, lang: lang))
            actionError(lang)
            Button(L10n.caseRetry(lang)) { Task { await model.judge(onlyMine: false) } }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(model.busy)
        case .expired, .unknown:
            banner(CaseLogic.expiredBody(view, lang: lang))
            actionError(lang)
            VStack(spacing: 10) {
                if view.isMany, view.canJudgeAnswered {
                    Button(L10n.caseJudgeAnswered(lang)) { ask(.judgeAnswered(expired: true)) }
                        .buttonStyle(PrimaryButtonStyle())
                        .disabled(model.busy)
                } else if view.canJudgeNow {
                    Button(L10n.caseJudgeNow(lang)) { ask(.judgeNow(expired: true)) }
                        .buttonStyle(PrimaryButtonStyle())
                        .disabled(model.busy)
                }
                Button(L10n.caseStartOver(lang)) { startOver() }
                    .buttonStyle(GhostButtonStyle())
            }
        }
        if !view.verdicts.isEmpty, view.removed == nil {
            CaseNamesCard(model: model, view: view, lang: lang)
        }
        AccountsReadView(view: view, lang: lang)
        if CaseLogic.canRemove(view) {
            Button {
                ask(.remove)
            } label: {
                Text(L10n.caseRemove(lang))
                    .brandText(.chip)
                    .foregroundStyle(Brand.danger)
                    .frame(minHeight: 44)
            }
            .buttonStyle(.plain)
            .disabled(model.busy)
        }
    }

    @ViewBuilder
    private func awaiting(_ view: CaseView, lang: AppLang) -> some View {
        let writing = writesSide(view)
        if writing {
            CaseSideForm(model: model, evidenceOn: CaseLogic.appealEvidenceOn(view, features: app.account.features), lang: lang)
        }
        let typed = SideNames.load(caseID: model.id)
        ForEach(view.live ?? [], id: \.party) { side in
            liveRow(side, name: typed[side.party], lang: lang)
        }
        InviteLinkView(
            url: view.inviteUrl,
            lang: lang,
            resetting: model.busy,
            resetDone: model.resetDone
        ) {
            ask(.resetInvite)
        }
        actionError(lang)
        if view.isMany, view.canJudgeAnswered, !writing {
            Button {
                ask(.judgeAnswered(expired: false))
            } label: {
                Text(L10n.caseJudgeAnswered(lang))
                    .frame(maxWidth: .infinity, minHeight: 48)
            }
            .buttonStyle(GhostButtonStyle())
            .disabled(model.busy)
        } else if view.canJudgeNow, !writing {
            Button {
                ask(.judgeNow(expired: false))
            } label: {
                Text(L10n.caseJudgeNow(lang))
                    .frame(maxWidth: .infinity, minHeight: 48)
            }
            .buttonStyle(GhostButtonStyle())
            .disabled(model.busy)
        }
    }

    /// One invited side: its letter, the name the owner gave it if any, and
    /// where it stands.
    private func liveRow(_ side: CaseLiveSide, name: String?, lang: AppLang) -> some View {
        HStack(spacing: 8) {
            PartyAvatar(party: side.party)
            if let name {
                Text(name)
                    .brandText(.slotTitle)
                    .foregroundStyle(Brand.ink)
                    .lineLimit(1)
                Spacer(minLength: 8)
            }
            Text(CaseLogic.liveText(side.state, lang: lang))
                .brandText(.slotTitle)
                .foregroundStyle(side.state == .answered ? Brand.sageInk : Brand.ink)
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(name ?? side.party.label(lang))
        .accessibilityValue(CaseLogic.liveText(side.state, lang: lang))
    }

    @ViewBuilder
    private func actionError(_ lang: AppLang) -> some View {
        if let error = model.actionError {
            ErrorBanner(message: ErrorText.message(error, lang: lang))
            let code = error.code
            if code == "premium_required" || code == "no_credits" || code == "fair_use" {
                Button(L10n.tierGetPremium(lang)) { showPricing = true }
                    .buttonStyle(GhostButtonStyle())
            }
        }
    }

    private func note(_ text: String) -> some View {
        Text(text)
            .brandText(.body)
            .foregroundStyle(Brand.ink2)
            .fixedSize(horizontal: false, vertical: true)
    }

    private func banner(_ text: String) -> some View {
        Text(text)
            .brandText(.slotTitle)
            .foregroundStyle(Brand.ink)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(14)
            .paperSurface(radius: 16, fill: Brand.strata.opacity(0.6), border: Brand.stone)
            .accessibilityAddTraits(.updatesFrequently)
    }

    /// "Start a new case": back to an empty form on Home.
    private func startOver() {
        app.newArgument()
        dismiss()
    }

    // MARK: - Confirmations

    private func ask(_ item: CaseConfirm) {
        confirm = item
        showConfirm = true
    }

    private func confirmTitle(_ lang: AppLang) -> String {
        switch confirm {
        case .judgeNow: return L10n.caseJudgeNow(lang)
        case .judgeAnswered: return L10n.caseJudgeAnswered(lang)
        case .resetInvite: return L10n.caseInviteReset(lang)
        case .remove: return L10n.caseRemove(lang)
        case nil: return ""
        }
    }

    private func confirmText(_ item: CaseConfirm, lang: AppLang) -> String {
        switch item {
        case .judgeNow(let expired): return CaseLogic.judgeNowConfirm(expired: expired, lang: lang).text
        case .judgeAnswered: return L10n.caseJudgeAnsweredConfirm(lang)
        case .resetInvite: return L10n.caseInviteResetConfirm(lang)
        case .remove: return L10n.caseRemoveConfirm(lang)
        }
    }

    private func confirmYes(_ item: CaseConfirm, lang: AppLang) -> String {
        switch item {
        case .judgeNow(let expired): return CaseLogic.judgeNowConfirm(expired: expired, lang: lang).yes
        case .judgeAnswered(let expired): return expired ? L10n.caseJudgeExpiredYes(lang) : L10n.caseJudgeNowYes(lang)
        case .resetInvite: return L10n.caseInviteResetYes(lang)
        case .remove: return L10n.caseRemoveYes(lang)
        }
    }

    private func isDestructive(_ item: CaseConfirm) -> Bool {
        if case .remove = item { return true }
        return false
    }

    private func run(_ item: CaseConfirm) async {
        switch item {
        case .judgeNow: await model.judge(onlyMine: true)
        case .judgeAnswered: await model.judgeAnswered()
        case .resetInvite: await model.resetInvite()
        case .remove: await model.remove()
        }
    }
}

/// Status chip with a dot (StatusChip on the web).
struct CaseStatusChip: View {
    let status: CaseStatus
    let lang: AppLang

    var body: some View {
        HStack(spacing: 6) {
            Circle().fill(color).frame(width: 8, height: 8)
                .accessibilityHidden(true)
            Text(CaseLogic.statusText(status, lang: lang))
                .brandText(TypeStyle(face: .inter, weight: 600, size: 12.5, lineHeight: 1.3, textStyle: .footnote))
                .foregroundStyle(Brand.ink)
        }
        .padding(.horizontal, 11)
        .padding(.vertical, 5)
        .background(Capsule().fill(Brand.paper))
        .overlay(Capsule().strokeBorder(Brand.line2, lineWidth: 1))
    }

    private var color: Color {
        switch status {
        case .awaitingRespondent: return Brand.terra
        case .judging: return Brand.sageStrong
        case .judged: return Brand.ink
        case .failed: return Brand.danger
        case .expired, .unknown: return Brand.muted
        }
    }
}

/// The verdict of a case, translated like any verdict, with Party A's real
/// names put back for the owner. The current one carries the case's
/// "Add context & appeal".
private struct CaseVerdictBlock: View {
    let app: AppModel
    let shareable: Bool
    let appeal: (draft: CaseModel, area: CaseLogic.AppealArea, evidenceOn: Bool)?
    @State private var model: VerdictModel

    @MainActor
    init(
        app: AppModel,
        verdict: CaseVerdict,
        names: [NameMapping],
        shareable: Bool,
        appeal: (draft: CaseModel, area: CaseLogic.AppealArea, evidenceOn: Bool)? = nil
    ) {
        self.app = app
        self.shareable = shareable
        self.appeal = appeal
        let session = VerdictSession(id: verdict.id, original: verdict.result, nameMap: names, translations: [:])
        _model = State(initialValue: VerdictModel(session: session, api: app.api) { _, _, _ in })
    }

    var body: some View {
        let lang = app.lang
        VerdictSections(
            model: model,
            lang: lang,
            shareURL: shareable ? app.config.shareURL(id: model.session.id) : nil,
            appealArea: appeal?.area ?? CaseLogic.AppealArea.none
        ) {
            if let appeal {
                AppealSheet(model: appeal.draft, area: appeal.area, cost: L10n.appAppealCostCase(lang), evidenceOn: appeal.evidenceOn, lang: lang)
                    .environment(app)
            }
        }
    }
}

/// Earlier verdicts of a case, newest first, each collapsed.
private struct VerdictHistory: View {
    let app: AppModel
    let view: CaseView
    let names: [NameMapping]
    let lang: AppLang

    var body: some View {
        let earlier = Array(view.verdicts.dropLast().reversed())
        if !earlier.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
                Kicker(text: L10n.appealHistory(lang))
                    .accessibilityAddTraits(.isHeader)
                ForEach(earlier, id: \.id) { verdict in
                    DisclosureGroup {
                        CaseVerdictBlock(app: app, verdict: verdict, names: names, shareable: view.removed == nil)
                            .padding(.top, 10)
                    } label: {
                        HStack {
                            Text(L10n.appealPrevious(lang))
                                .brandText(.slotTitle)
                                .foregroundStyle(Brand.ink)
                            Spacer()
                            Text(ErrorText.formatDate(verdict.createdAt, lang: lang) ?? "")
                                .brandText(.footnote)
                                .foregroundStyle(Brand.muted)
                        }
                    }
                    .tint(Brand.ink2)
                    .padding(14)
                    .paperSurface(radius: 18)
                }
            }
        }
    }
}

/// While the judges work: the rocking balance and the helper line for the case tier.
private struct CaseJudgingCard: View {
    let lang: AppLang
    let premium: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var started = Date.now

    var body: some View {
        VStack(spacing: 18) {
            TimelineView(.animation(minimumInterval: nil, paused: reduceMotion)) { context in
                BalanceCanvas(angle: reduceMotion ? 0 : BalanceMotion.rockAngle(at: context.date.timeIntervalSince(started)))
                    .frame(width: 180, height: 140)
            }
            HStack(spacing: 8) {
                ProgressView().tint(Brand.muted)
                Text(L10n.caseStatusJudging(lang))
                    .brandText(.slotTitle)
                    .foregroundStyle(Brand.ink)
            }
            Text(premium ? L10n.thinkingPremiumHelper(lang) : L10n.thinkingHelper(lang))
                .brandText(.slotText)
                .foregroundStyle(Brand.muted)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity)
        .padding(20)
        .paperSurface(radius: Radius.card)
        .accessibilityElement(children: .combine)
    }
}
