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

/// Select mode of the Verdicts list. Only verdicts saved on this phone can
/// be picked: a case has no delete in the app.
struct HistorySelection: Equatable {
    var isActive = false
    var ids: Set<String> = []

    static func selectable(_ entries: [HistoryEntry]) -> [String] {
        entries.compactMap { entry in
            if case .savedVerdict(let row) = entry { return row.id }
            return nil
        }
    }

    mutating func start() {
        isActive = true
        ids = []
    }

    mutating func end() {
        isActive = false
        ids = []
    }

    mutating func toggle(_ id: String) {
        if ids.contains(id) { ids.remove(id) } else { ids.insert(id) }
    }

    func allOf(_ selectable: [String]) -> Bool {
        !selectable.isEmpty && ids.isSuperset(of: selectable)
    }

    mutating func toggleAll(_ selectable: [String]) {
        ids = allOf(selectable) ? [] : Set(selectable)
    }

    /// Deletes each picked verdict as its row's own Delete does, then leaves
    /// select mode.
    @MainActor
    mutating func deleteSelected(from history: HistoryStore) {
        for id in ids { try? history.delete(id: id) }
        end()
    }
}

/// "Verdicts": everything judged on this phone and, signed in where the
/// server offers cases, the account's cases with their state, newest first.
struct HistoryView: View {
    @Environment(AppModel.self) private var app
    @Query(sort: \SavedVerdict.createdAt, order: .reverse) private var saved: [SavedVerdict]
    @State private var selection = HistorySelection()
    @State private var confirmDelete = false

    var body: some View {
        let lang = app.lang
        let list = app.caseList
        let casesShown = app.caseListOffered && app.account.isSignedIn
        let entries = HistoryEntry.merge(saved: saved, cases: casesShown ? readyCases : [])
        let selectable = HistorySelection.selectable(entries)
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
        .navigationTitle(selection.isActive ? L10n.appHistorySelected(lang, n: selection.ids.count) : L10n.navVerdicts(lang))
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Brand.ivory, for: .navigationBar, .bottomBar)
        // As in Photos, the delete bar takes the tab bar's place while selecting.
        .toolbar(selection.isActive ? .hidden : .visible, for: .tabBar)
        .toolbar { toolbarItems(lang, selectable: selectable) }
        .confirmationDialog(
            L10n.appHistoryDeleteConfirm(lang, n: selection.ids.count),
            isPresented: $confirmDelete,
            titleVisibility: .visible
        ) {
            Button(L10n.appHistoryDelete(lang), role: .destructive) { selection.deleteSelected(from: app.history) }
            Button(L10n.appCancel(lang), role: .cancel) {}
        }
        .onChange(of: app.tab) { _, tab in
            if tab != .history { selection.end() }
        }
        // Each appearance refreshes the cases (they may have changed
        // meanwhile); signing in loads them. A load already running is not
        // repeated.
        .onAppear {
            if let seed = app.historySelectionSeed {
                selection.start()
                selection.ids = seed
                app.historySelectionSeed = nil
            }
            loadCases()
        }
        .onChange(of: app.account.isSignedIn) { _, signedIn in
            if signedIn { loadCases() } else { list.reset() }
        }
    }

    @ToolbarContentBuilder
    private func toolbarItems(_ lang: AppLang, selectable: [String]) -> some ToolbarContent {
        if selection.isActive {
            ToolbarItem(placement: .topBarLeading) {
                Button(selection.allOf(selectable) ? L10n.appHistoryDeselectAll(lang) : L10n.appHistorySelectAll(lang)) {
                    selection.toggleAll(selectable)
                }
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button(L10n.appCancel(lang)) { selection.end() }
                    .fontWeight(.semibold)
            }
            ToolbarItem(placement: .bottomBar) {
                Button(L10n.appHistoryDeleteCount(lang, count: String(selection.ids.count)), role: .destructive) {
                    confirmDelete = true
                }
                .tint(Brand.danger)
                .disabled(selection.ids.isEmpty)
            }
        } else {
            if !selectable.isEmpty {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(L10n.appHistorySelect(lang)) { selection.start() }
                }
            }
            ToolbarItem(placement: .topBarTrailing) {
                NewArgumentButton(lang: lang) { app.newArgument() }
                    .disabled(app.home.isBusy)
            }
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
                        if selection.isActive {
                            PickableRow(row: row, lang: lang, selected: selection.ids.contains(row.id)) {
                                selection.toggle(row.id)
                            }
                            .listRowBackground(selection.ids.contains(row.id) ? Brand.terraTint : Brand.paper)
                        } else {
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
                        }
                    case .caseSummary(let summary):
                        if selection.isActive {
                            CaseRow(summary: summary, lang: lang)
                                .opacity(0.4)
                                .disabled(true)
                                .listRowBackground(Brand.paper)
                        } else {
                            NavigationLink(value: HistoryRoute.caseDetail(id: summary.id)) {
                                CaseRow(summary: summary, lang: lang)
                            }
                            .listRowBackground(Brand.paper)
                        }
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

/// A saved verdict in select mode: a tap picks it instead of opening it.
private struct PickableRow: View {
    let row: SavedVerdict
    let lang: AppLang
    let selected: Bool
    let toggle: () -> Void

    var body: some View {
        Button(action: toggle) {
            HStack(spacing: 12) {
                SelectCircle(selected: selected)
                HistoryRow(row: row, lang: lang)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityValue(selected ? L10n.appHistoryRowSelected(lang) : L10n.appHistoryRowNotSelected(lang))
    }
}

private struct SelectCircle: View {
    let selected: Bool

    var body: some View {
        Image(systemName: selected ? "checkmark.circle.fill" : "circle")
            .font(.system(size: 22))
            .foregroundStyle(selected ? Brand.terraInk : Brand.muted)
            .accessibilityHidden(true)
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
