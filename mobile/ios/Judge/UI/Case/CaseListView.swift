import Observation
import SwiftUI

/// The account's cases for the Verdicts list: GET /api/v1/cases?limit=20,
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
    @ObservationIgnored private var inFlight = false

    /// Signed out: nothing of the last account's list stays.
    func reset() {
        state = .idle
    }

    func load(api: JudgeAPI, account: AccountModel) async {
        guard usesNetwork, account.isSignedIn, !inFlight else { return }
        inFlight = true
        defer { inFlight = false }
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

/// A case in the Verdicts list: its title, start date and state, or the
/// removed mark.
struct CaseRow: View {
    let summary: CaseSummary
    let lang: AppLang

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(CaseLogic.listTitle(summary, lang: lang))
                .brandText(.slotTitle)
                .foregroundStyle(Brand.ink)
                .lineLimit(2)
            if let date = ErrorText.formatDate(summary.createdAt, lang: lang) {
                Text(date)
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
