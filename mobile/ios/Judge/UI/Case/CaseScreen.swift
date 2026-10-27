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
    case resetInvite
    case remove

    var id: String {
        switch self {
        case .judgeNow(let expired): return "judge-\(expired)"
        case .resetInvite: return "reset"
        case .remove: return "remove"
        }
    }
}

private struct CaseScreenContent: View {
    let app: AppModel
    @State private var model: CaseModel
    @State private var webLink: WebLink?
    @State private var confirm: CaseConfirm?
    @State private var showConfirm = false
    @State private var showPricing = false
    @Environment(\.dismiss) private var dismiss

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
        .background(Brand.ivory.ignoresSafeArea())
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Brand.ivory, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                NewArgumentButton(lang: lang, action: startOver)
                    .disabled(app.home.isBusy)
            }
        }
        // Polling restarts whenever a new view arrives (generation).
        .task(id: model.generation) { await model.run() }
        .onAppear { Task { await model.refresh() } }
        .refreshable { await model.refresh() }
        .onChange(of: app.account.isSignedIn) { _, signedIn in
            if signedIn, model.load == .signIn { Task { await model.refresh() } }
        }
        .sheet(item: $webLink) { link in
            SafariView(url: link.url).ignoresSafeArea()
        }
        .sheet(isPresented: $showPricing) {
            NavigationStack { PricingView() }
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
        Kicker(text: L10n.caseKicker(lang))
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
            if view.status == .awaitingRespondent {
                waitingHead(app.caseOtherName(view.id), lang: lang)
            } else {
                // A case judged on the owner's side alone is not "both sides" anymore.
                Kicker(text: view.mode == .oneSided ? L10n.caseKickerOneSided(lang) : L10n.caseKicker(lang))
                Text(L10n.caseTitle(lang))
                    .brandText(Self.title)
                    .foregroundStyle(Brand.ink)
                    .accessibilityAddTraits(.isHeader)
                CaseStatusChip(status: view.status, lang: lang)
            }
        }
    }

    /// The other side's name is only known when it was typed on Home on
    /// this run of the app.
    @ViewBuilder
    private func waitingHead(_ other: String?, lang: AppLang) -> some View {
        Kicker(text: L10n.appCaseWaitingKicker(lang), color: Brand.sageInk)
        Text(other.map { L10n.appCaseWaitingFor(lang, name: $0) } ?? CaseLogic.statusText(.awaitingRespondent, lang: lang))
            .brandText(TypeStyle(face: .serif, weight: 400, size: 34, lineHeight: 1.04, textStyle: .largeTitle, maxScale: 1.3))
            .foregroundStyle(Brand.ink)
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityAddTraits(.isHeader)
        Text(other.map { L10n.appCaseWaitingLead(lang, name: $0) } ?? L10n.appCaseWaitingLeadAnon(lang))
            .brandText(TypeStyle(face: .inter, weight: 400, size: 14, lineHeight: 1.45, textStyle: .subheadline))
            .foregroundStyle(Brand.ink2)
            .fixedSize(horizontal: false, vertical: true)
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
            let other = app.caseOtherName(view.id)
            if let url = view.inviteUrl {
                InviteLinkView(
                    url: url,
                    expiresAt: view.expiresAt,
                    title: other.map { L10n.appCaseSendTo(lang, name: $0) } ?? L10n.caseInviteLabel(lang),
                    lang: lang,
                    resetting: model.busy,
                    resetDone: model.resetDone
                ) {
                    ask(.resetInvite)
                }
            }
            if let held = CaseLogic.heldNote(view, lang: lang) {
                Text(held)
                    .brandText(.slotText)
                    .foregroundStyle(Brand.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            WaitingSteps(other: other, judgeNow: view.canJudgeNow, lang: lang)
            actionError(lang)
            if view.canJudgeNow {
                Button {
                    ask(.judgeNow(expired: false))
                } label: {
                    Text(other.map { L10n.appCaseJudgeNowWithout(lang, name: $0) } ?? L10n.caseJudgeNow(lang))
                        .frame(maxWidth: .infinity, minHeight: 48)
                }
                .buttonStyle(GhostButtonStyle())
                .disabled(model.busy)
            }
        case .judged:
            if let current = view.current {
                if view.mode == .oneSided {
                    note(L10n.caseOneSided(lang))
                }
                CaseVerdictBlock(app: app, verdict: current, names: model.names, shareable: view.removed == nil) { url in
                    webLink = WebLink(url: url)
                }
                .id("\(current.id)-\(model.names.count)")
                AppealSection(
                    model: model,
                    area: CaseLogic.appealArea(view),
                    lead: L10n.appealLead(lang),
                    evidenceOn: CaseLogic.appealEvidenceOn(view, features: app.account.features),
                    lang: lang
                ) {
                    showPricing = true
                }
                VerdictHistory(app: app, view: view, names: model.names, lang: lang) { url in
                    webLink = WebLink(url: url)
                }
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
                if view.canJudgeNow {
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
                    .frame(minHeight: 40)
            }
            .buttonStyle(.plain)
            .disabled(model.busy)
        }
    }

    @ViewBuilder
    private func actionError(_ lang: AppLang) -> some View {
        if let error = model.actionError {
            ErrorBanner(message: ErrorText.message(error, lang: lang))
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

    /// "Start a new case" and the header's "+": back to an empty form on Home.
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
        case .resetInvite: return L10n.caseInviteReset(lang)
        case .remove: return L10n.caseRemove(lang)
        case nil: return ""
        }
    }

    private func confirmText(_ item: CaseConfirm, lang: AppLang) -> String {
        switch item {
        case .judgeNow(let expired): return CaseLogic.judgeNowConfirm(expired: expired, tier: model.view?.tier ?? .premium, lang: lang).text
        case .resetInvite: return L10n.caseInviteResetConfirm(lang)
        case .remove: return L10n.caseRemoveConfirm(lang)
        }
    }

    private func confirmYes(_ item: CaseConfirm, lang: AppLang) -> String {
        switch item {
        case .judgeNow(let expired): return CaseLogic.judgeNowConfirm(expired: expired, tier: model.view?.tier ?? .premium, lang: lang).yes
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
        case .resetInvite: await model.resetInvite()
        case .remove: await model.remove()
        }
    }
}

/// Where a waiting case stands: your side is in, theirs is next, then the
/// judges (or now, on your side alone, when the case allows it).
private struct WaitingSteps: View {
    let other: String?
    let judgeNow: Bool
    let lang: AppLang

    private enum Mark {
        case done, current, next
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            step(.done, title: L10n.appCaseStepYou(lang), note: L10n.appCaseStepYouNote(lang))
            step(
                .current,
                title: other.map { L10n.appCaseStepThem(lang, name: $0) } ?? L10n.appCaseStepThemAnon(lang),
                note: L10n.appCaseStepThemNote(lang)
            )
            step(.next, title: L10n.appCaseStepJudges(lang), note: judgeNow ? L10n.appCaseStepJudgesNote(lang) : nil)
        }
        .padding(.horizontal, 4)
    }

    private func step(_ mark: Mark, title: String, note: String?) -> some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(spacing: 0) {
                disc(mark)
                if mark != .next {
                    Rectangle()
                        .fill(Brand.stone)
                        .frame(width: 2)
                        .frame(minHeight: 26, maxHeight: .infinity)
                }
            }
            .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .brandText(.slotTitle)
                    .foregroundStyle(mark == .next ? Brand.ink2 : Brand.ink)
                if let note {
                    Text(note)
                        .brandText(.footnote)
                        .foregroundStyle(Brand.muted)
                }
            }
            .fixedSize(horizontal: false, vertical: true)
            .padding(.top, 2)
            .padding(.bottom, mark == .next ? 0 : 10)
        }
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private func disc(_ mark: Mark) -> some View {
        switch mark {
        case .done:
            Image(systemName: "checkmark")
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(Brand.paper)
                .frame(width: 24, height: 24)
                .background(Circle().fill(Brand.terra))
        case .current:
            Circle()
                .fill(Brand.sageTint)
                .overlay(Circle().strokeBorder(Brand.sageInk, lineWidth: 2))
                .frame(width: 24, height: 24)
        case .next:
            Circle()
                .strokeBorder(Brand.stone, lineWidth: 2)
                .frame(width: 24, height: 24)
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
/// names put back for the owner.
private struct CaseVerdictBlock: View {
    let app: AppModel
    let shareable: Bool
    let openURL: (URL) -> Void
    @State private var model: VerdictModel

    @MainActor
    init(app: AppModel, verdict: CaseVerdict, names: [NameMapping], shareable: Bool, openURL: @escaping (URL) -> Void) {
        self.app = app
        self.shareable = shareable
        self.openURL = openURL
        let session = VerdictSession(id: verdict.id, original: verdict.result, nameMap: names, translations: [:])
        _model = State(initialValue: VerdictModel(session: session, api: app.api) { _, _, _ in })
    }

    var body: some View {
        VerdictSections(
            model: model,
            lang: app.lang,
            shareURL: shareable ? app.config.shareURL(id: model.session.id) : nil,
            openURL: openURL
        )
    }
}

/// Earlier verdicts of a case, newest first, each collapsed.
private struct VerdictHistory: View {
    let app: AppModel
    let view: CaseView
    let names: [NameMapping]
    let lang: AppLang
    let openURL: (URL) -> Void

    var body: some View {
        let earlier = Array(view.verdicts.dropLast().reversed())
        if !earlier.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
                Kicker(text: L10n.appealHistory(lang))
                    .accessibilityAddTraits(.isHeader)
                ForEach(earlier, id: \.id) { verdict in
                    DisclosureGroup {
                        CaseVerdictBlock(app: app, verdict: verdict, names: names, shareable: view.removed == nil, openURL: openURL)
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
