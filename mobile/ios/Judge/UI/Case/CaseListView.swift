import Observation
import SwiftUI

/// "Your cases" (components/case/CaseList.tsx): GET /api/v1/cases?limit=20,
/// newest first.
@MainActor
@Observable
final class CaseListModel {
    enum Phase: Equatable {
        case idle, loading, ready([CaseSummary]), failed
    }

    private(set) var state: Phase = .idle
    /// Off for screenshot states.
    @ObservationIgnored var usesNetwork = true

    func load(api: JudgeAPI, account: AccountModel) async {
        guard usesNetwork, account.isSignedIn else { return }
        if case .ready = state {} else { state = .loading }
        do {
            state = .ready(try await api.listCases(limit: 20))
        } catch let error as APIError {
            if error.code == "signin_required" { account.sessionExpired() }
            if case .ready = state { return }
            state = .failed
        } catch is CancellationError {
            if state == .loading { state = .idle }
        } catch {
            if case .ready = state { return }
            state = .failed
        }
    }

    #if DEBUG
    /// Screenshot fixtures: a fixed list without a request.
    func showForScreenshot(_ cases: [CaseSummary]) {
        usesNetwork = false
        state = .ready(cases)
    }
    #endif
}

struct CaseListView: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        let lang = app.lang
        let list = app.caseList
        Group {
            if !app.account.isSignedIn {
                message(L10n.caseSignIn(lang)) {
                    Button(L10n.navSignIn(lang)) { app.account.presentSignIn() }
                        .buttonStyle(PrimaryButtonStyle())
                        .frame(maxWidth: 280)
                }
            } else {
                switch list.state {
                case .idle, .loading:
                    message(L10n.caseLoading(lang)) { ProgressView().tint(Brand.muted) }
                case .failed:
                    message(L10n.caseListLoadFailed(lang)) {
                        Button(L10n.caseRetry(lang)) { Task { await list.load(api: app.api, account: app.account) } }
                            .buttonStyle(GhostButtonStyle())
                    }
                case .ready(let cases):
                    if cases.isEmpty {
                        message(L10n.caseListEmpty(lang)) { EmptyView() }
                    } else {
                        List {
                            ForEach(cases) { summary in
                                NavigationLink(value: HistoryRoute.caseDetail(id: summary.id)) {
                                    CaseRow(summary: summary, lang: lang)
                                }
                                .listRowBackground(Brand.paper)
                            }
                        }
                        .scrollContentBackground(.hidden)
                        .refreshable { await list.load(api: app.api, account: app.account) }
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .task(id: app.account.isSignedIn) { await list.load(api: app.api, account: app.account) }
    }

    private func message<Extra: View>(_ text: String, @ViewBuilder extra: () -> Extra) -> some View {
        VStack(spacing: 14) {
            Text(text)
                .brandText(.body)
                .foregroundStyle(Brand.ink2)
                .multilineTextAlignment(.center)
            extra()
        }
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

private struct CaseRow: View {
    let summary: CaseSummary
    let lang: AppLang

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(CaseLogic.listTitle(summary, lang: lang))
                .brandText(.slotTitle)
                .foregroundStyle(Brand.ink)
                .lineLimit(2)
            if let date = ErrorText.formatDate(summary.createdAt, lang: lang) {
                Text(L10n.caseListStarted(lang, date: date))
                    .brandText(.footnote)
                    .foregroundStyle(Brand.muted)
            }
            if summary.removed {
                Text(L10n.accountVerdictsRemoved(lang))
                    .brandText(TypeStyle(face: .inter, weight: 600, size: 12.5, lineHeight: 1.3, textStyle: .footnote))
                    .foregroundStyle(Brand.muted)
                    .padding(.horizontal, 11)
                    .padding(.vertical, 5)
                    .background(Capsule().fill(Brand.ivory2))
            } else {
                CaseStatusChip(status: summary.status, lang: lang)
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }
}
