import SwiftData
import SwiftUI

enum HistoryRoute: Hashable {
    case detail(id: String)
    case caseDetail(id: String)
}

/// A row of the Verdicts list: a verdict saved on this phone or one of the
/// account's cases.
enum HistoryEntry: Identifiable {
    case savedVerdict(SavedVerdict)
    case caseSummary(CaseSummary)

    var id: String {
        switch self {
        case .savedVerdict(let row): return "v:" + row.id
        case .caseSummary(let summary): return "c:" + summary.id
        }
    }

    var date: Date {
        switch self {
        case .savedVerdict(let row): return row.createdAt
        case .caseSummary(let summary): return ErrorText.parseISO(summary.createdAt) ?? .distantPast
        }
    }

    /// Both kinds in one list, newest first (mergeHistory on the web).
    static func merge(saved: [SavedVerdict], cases: [CaseSummary]) -> [HistoryEntry] {
        // date parses the case's ISO string, so do it once per entry, not per comparison
        let entries = saved.map(HistoryEntry.savedVerdict) + cases.map(HistoryEntry.caseSummary)
        return entries.map { ($0, $0.date) }.sorted { $0.1 > $1.1 }.map(\.0)
    }
}

/// "Verdicts": everything judged on this phone and, signed in where the
/// server offers cases, the account's cases with their state, newest first.
struct HistoryView: View {
    @Environment(AppModel.self) private var app
    @Query(sort: \SavedVerdict.createdAt, order: .reverse) private var saved: [SavedVerdict]
    @State private var confirmClear = false

    var body: some View {
        let lang = app.lang
        let list = app.caseList
        let casesShown = app.caseListOffered && app.account.isSignedIn
        let entries = HistoryEntry.merge(saved: saved, cases: casesShown ? readyCases : [])
        Group {
            if entries.isEmpty, casesShown, list.state == .idle || list.state == .loading {
                message(L10n.caseLoading(lang)) { ProgressView().tint(Brand.muted) }
            } else if entries.isEmpty, casesShown, list.state == .failed {
                message(L10n.shellLoadFailed(lang)) { retry(lang) }
            } else if entries.isEmpty {
                message(L10n.appHistoryEmpty(lang)) { EmptyView() }
            } else {
                rows(entries, lang: lang, casesFailed: casesShown && list.state == .failed)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Brand.ivory.ignoresSafeArea())
        .navigationTitle(L10n.navVerdicts(lang))
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Brand.ivory, for: .navigationBar)
        .toolbar {
            if !saved.isEmpty {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(L10n.appHistoryClearAll(lang), role: .destructive) { confirmClear = true }
                        .tint(Brand.danger)
                }
            }
            ToolbarItem(placement: .topBarTrailing) {
                NewArgumentButton(lang: lang) { app.newArgument() }
                    .disabled(app.home.isBusy)
            }
        }
        .confirmationDialog(L10n.appHistoryClearConfirm(lang), isPresented: $confirmClear, titleVisibility: .visible) {
            Button(L10n.appHistoryClearYes(lang), role: .destructive) { try? app.history.deleteAll() }
            Button(L10n.appCancel(lang), role: .cancel) {}
        }
        // Each appearance refreshes the cases (they may have changed
        // meanwhile); signing in loads them. A load already running is not
        // repeated.
        .onAppear { loadCases() }
        .onChange(of: app.account.isSignedIn) { _, signedIn in
            if signedIn { loadCases() } else { list.reset() }
        }
    }

    private var readyCases: [CaseSummary] {
        if case .ready(let cases) = app.caseList.state { return cases }
        return []
    }

    private func loadCases() {
        guard app.caseListOffered else { return }
        Task { await app.caseList.load(api: app.api, account: app.account) }
    }

    private func rows(_ entries: [HistoryEntry], lang: AppLang, casesFailed: Bool) -> some View {
        List {
            if casesFailed {
                Section {
                    VStack(spacing: 10) {
                        Text(L10n.shellLoadFailed(lang))
                            .brandText(.body)
                            .foregroundStyle(Brand.danger)
                            .multilineTextAlignment(.center)
                        retry(lang)
                    }
                    .frame(maxWidth: .infinity)
                    .listRowBackground(Color.clear)
                }
            }
            Section {
                ForEach(entries) { entry in
                    switch entry {
                    case .savedVerdict(let row):
                        NavigationLink(value: HistoryRoute.detail(id: row.id)) {
                            HistoryRow(row: row, lang: lang)
                        }
                        .listRowBackground(Brand.paper)
                        .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                            Button(role: .destructive) {
                                try? app.history.delete(id: row.id)
                            } label: {
                                Label(L10n.appHistoryDelete(lang), systemImage: "trash")
                            }
                        }
                        .contextMenu {
                            Button(role: .destructive) {
                                try? app.history.delete(id: row.id)
                            } label: {
                                Label(L10n.appHistoryDelete(lang), systemImage: "trash")
                            }
                        }
                    case .caseSummary(let summary):
                        NavigationLink(value: HistoryRoute.caseDetail(id: summary.id)) {
                            CaseRow(summary: summary, lang: lang)
                        }
                        .listRowBackground(Brand.paper)
                    }
                }
            } footer: {
                if !saved.isEmpty {
                    Text(L10n.appHistoryDeviceOnly(lang))
                        .brandText(.footnote)
                        .foregroundStyle(Brand.muted)
                        .padding(.top, 8)
                }
            }
        }
        .scrollContentBackground(.hidden)
        .refreshable { await app.caseList.load(api: app.api, account: app.account) }
    }

    private func retry(_ lang: AppLang) -> some View {
        Button(L10n.caseRetry(lang)) { loadCases() }
            .buttonStyle(GhostButtonStyle())
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

private struct HistoryRow: View {
    let row: SavedVerdict
    let lang: AppLang

    @Environment(\.sides) private var sides

    var body: some View {
        let nameMap = row.nameMap
        let selfLang = row.contentLang
        let parties = Names.partyNames(nameMap, lang: lang, selfLang: selfLang)
        // Display-only: the stored headline stays anonymized. It is the
        // original's, so it is written in the language it was judged in.
        let headline = Names.restoreNames(row.headline, parties: Names.resolveParties(nameMap, selfLang: selfLang), textLang: selfLang)
        let verdict = row.finalVerdict
        HStack(alignment: .top, spacing: 12) {
            Circle()
                .fill(sealColor(VerdictDisplay.seal(verdict)))
                .frame(width: 12, height: 12)
                .padding(.top, 4)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text(VerdictDisplay.label(verdict, parties: parties, lang: lang))
                    .brandText(.slotTitle)
                    .foregroundStyle(Brand.ink)
                Text(headline)
                    .brandText(.slotText)
                    .foregroundStyle(Brand.ink2)
                    .lineLimit(2)
                Text(row.createdAt.formatted(Date.FormatStyle(date: .abbreviated, time: .shortened).locale(lang.locale)))
                    .brandText(.footnote)
                    .foregroundStyle(Brand.muted)
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }

    private func sealColor(_ seal: VerdictDisplay.Seal) -> Color {
        switch seal {
        case .a: return sides.a.ink
        case .b: return sides.b.ink
        case .none: return Brand.ink
        }
    }
}

/// A saved verdict, viewable offline (translations come from the cache
/// first, otherwise they are fetched when online).
struct HistoryDetailView: View {
    @Environment(AppModel.self) private var app
    let id: String

    var body: some View {
        if let row = try? app.history.find(id: id), let session = row.session() {
            VerdictScreen(session: session)
        } else {
            MissingVerdictView()
        }
    }
}
