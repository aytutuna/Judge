import SwiftData
import SwiftUI

enum HistoryRoute: Hashable {
    case detail(id: String)
    case caseDetail(id: String)
}

/// "Verdicts": the account's verdicts and cases (started or answered) with
/// where each one stands, and verdicts kept only on this phone, newest
/// first. More load near the end, or with Show more.
struct HistoryView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.scenePhase) private var scenePhase
    @Query(sort: \SavedVerdict.createdAt, order: .reverse) private var saved: [SavedVerdict]
    @Query private var cachedRows: [HistoryCacheRow]
    @State private var selection = HistorySelection()
    @State private var confirming: [String]?
    @State private var webLink: WebLink?
    /// Rows near the end that are on screen.
    @State private var tailShown: Set<String> = []

    var body: some View {
        let lang = app.lang
        let list = app.historyList
        let entries = currentEntries
        let selectable = HistorySelection.selectable(entries)
        let thinking = entries.contains { entry in
            if case .account(let item) = entry { return item.historyState?.thinking == true }
            return false
        }
        Group {
            if entries.isEmpty, list.loading {
                message(L10n.caseLoading(lang)) { ProgressView().tint(Brand.muted) }
            } else if entries.isEmpty, list.failed {
                message(L10n.shellLoadFailed(lang)) { retry(lang) }
            } else if entries.isEmpty {
                message(L10n.appHistoryEmpty(lang)) { EmptyView() }
            } else {
                rows(entries, lang: lang)
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
            confirmText(entries, lang: lang),
            isPresented: Binding(get: { confirming != nil }, set: { if !$0 { confirming = nil } }),
            titleVisibility: .visible
        ) {
            Button(L10n.appHistoryDelete(lang), role: .destructive) { remove(confirming ?? [], from: entries) }
            Button(L10n.appCancel(lang), role: .cancel) {}
        }
        .sheet(item: $webLink) { link in
            SafariView(url: link.url).ignoresSafeArea()
        }
        .onChange(of: app.tab) { _, tab in
            if tab != .history { selection.end() }
        }
        // Each appearance reads page 1 again (at most once a minute).
        .onAppear {
            if let seed = app.historySelectionSeed {
                selection.start()
                selection.ids = seed
                app.historySelectionSeed = nil
            }
            refresh()
        }
        .onChange(of: app.historyUser) { _, _ in refresh(force: true) }
        .onChange(of: app.account.features.history) { _, _ in refresh() }
        // While the judges work on a row, the list is read again now and then.
        .task(id: thinking && scenePhase == .active) {
            guard thinking, scenePhase == .active else { return }
            while !Task.isCancelled {
                try? await Task.sleep(for: HistoryListModel.pollEvery)
                if Task.isCancelled { return }
                await list.refresh(user: app.historyUser, enabled: app.account.features.history, force: true)
            }
        }
    }

    private var currentEntries: [HistoryEntry] {
        let user = app.historyUser
        let cached = user.map { id in
            cachedRows.filter { $0.userID == id }
                .compactMap(\.item)
                .sorted { HistoryOrder.before(($0.at, $0.key), ($1.at, $1.key)) }
        } ?? []
        return HistoryEntry.merge(cached: cached, saved: saved, user: user, cutoff: app.historyList.cutoff)
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
                    confirming = Array(selection.ids)
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

    private func refresh(force: Bool = false) {
        let list = app.historyList
        let user = app.historyUser
        let enabled = app.account.features.history
        Task { await list.refresh(user: user, enabled: enabled, force: force) }
    }

    private func confirmText(_ entries: [HistoryEntry], lang: AppLang) -> String {
        let keys = Set(confirming ?? [])
        return HistoryLabels.removeConfirm(entries.filter { keys.contains($0.id) }, lang: lang)
    }

    private func remove(_ keys: [String], from entries: [HistoryEntry]) {
        let wanted = Set(keys)
        let picked = entries.filter { wanted.contains($0.id) }
        let list = app.historyList
        let user = app.historyUser
        let enabled = app.account.features.history
        let selecting = selection.isActive
        Task {
            let failed = await list.remove(picked, user: user, enabled: enabled)
            guard selecting else { return }
            if failed.isEmpty {
                selection.end()
            } else {
                selection.ids = failed
            }
        }
    }

    private func open(_ entry: HistoryEntry) {
        switch entry {
        case .phone(let row):
            app.historyPath.append(.detail(id: row.id))
        case .account(let item):
            guard HistoryLabels.openable(item) else { return }
            if !item.isCase {
                let list = app.historyList
                let user = app.historyUser
                Task {
                    if await list.openVerdict(item, user: user) { app.historyPath.append(.detail(id: item.id)) }
                }
            } else if item.isRespondent, let token = item.inviteToken {
                // Answering is done on the website: the case opens there too.
                webLink = WebLink(url: app.config.siteURL("r").appending(component: token))
            } else {
                app.historyPath.append(.caseDetail(id: item.id))
            }
        }
    }

    private func rows(_ entries: [HistoryEntry], lang: AppLang) -> some View {
        let list = app.historyList
        let now = list.now()
        return List {
            if let notice = list.notice {
                Section {
                    Text(noticeText(notice, lang: lang))
                        .brandText(.body)
                        .foregroundStyle(Brand.danger)
                        .frame(maxWidth: .infinity)
                        .multilineTextAlignment(.center)
                        .listRowBackground(Color.clear)
                }
            }
            if list.failed {
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
                ForEach(Array(entries.enumerated()), id: \.element.id) { index, entry in
                    row(entry, lang: lang, now: now)
                        .onAppear {
                            guard index >= entries.count - 3 else { return }
                            tailShown.insert(entry.id)
                            if list.next != nil {
                                Task { await list.loadMore(user: app.historyUser) }
                            }
                        }
                        .onDisappear {
                            if tailShown.contains(entry.id) { tailShown.remove(entry.id) }
                        }
                }
                if list.next != nil {
                    HStack {
                        Spacer()
                        if list.loadingMore {
                            ProgressView().tint(Brand.muted)
                        } else {
                            Button(L10n.shellLoadMore(lang)) {
                                Task { await list.loadMore(user: app.historyUser) }
                            }
                            .buttonStyle(GhostButtonStyle())
                        }
                        Spacer()
                    }
                    .listRowBackground(Color.clear)
                }
            } footer: {
                if entries.contains(where: \.isPhone) {
                    Text(L10n.appHistoryPhoneOnlyNote(lang))
                        .brandText(.footnote)
                        .foregroundStyle(Brand.muted)
                        .padding(.top, 8)
                }
            }
        }
        .scrollContentBackground(.hidden)
        // A page of rows the phone already had doesn't grow the list, so no
        // new row appears: keep going while the end is on screen.
        .onChange(of: list.next) { _, next in
            guard next != nil, !tailShown.isDisjoint(with: entries.suffix(3).map(\.id)) else { return }
            Task { await list.loadMore(user: app.historyUser) }
        }
        .refreshable { await list.refresh(user: app.historyUser, enabled: app.account.features.history, force: true) }
    }

    @ViewBuilder
    private func row(_ entry: HistoryEntry, lang: AppLang, now: Date) -> some View {
        if selection.isActive {
            if entry.selectable {
                PickableRow(entry: entry, lang: lang, now: now, selected: selection.ids.contains(entry.id)) {
                    selection.toggle(entry.id)
                }
                .listRowBackground(selection.ids.contains(entry.id) ? Brand.terraTint : Brand.paper)
            } else {
                EntryRow(entry: entry, lang: lang, now: now)
                    .opacity(0.4)
                    .disabled(true)
                    .listRowBackground(Brand.paper)
            }
        } else if entry.selectable {
            openButton(entry, lang: lang, now: now)
                .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                    Button(role: .destructive) { confirming = [entry.id] } label: {
                        Label(L10n.appHistoryDelete(lang), systemImage: "trash")
                    }
                }
                .contextMenu {
                    Button(role: .destructive) { confirming = [entry.id] } label: {
                        Label(L10n.appHistoryDelete(lang), systemImage: "trash")
                    }
                }
        } else {
            openButton(entry, lang: lang, now: now)
        }
    }

    private func openButton(_ entry: HistoryEntry, lang: AppLang, now: Date) -> some View {
        let opens = opens(entry)
        return Button { open(entry) } label: {
            HStack {
                EntryRow(entry: entry, lang: lang, now: now)
                if opens {
                    Image(systemName: "chevron.forward")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(Brand.muted)
                        .accessibilityHidden(true)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!opens)
        .listRowBackground(Brand.paper)
    }

    private func opens(_ entry: HistoryEntry) -> Bool {
        if case .account(let item) = entry { return HistoryLabels.openable(item) }
        return true
    }

    private func noticeText(_ notice: HistoryListModel.Notice, lang: AppLang) -> String {
        switch notice {
        case .offline: return L10n.appHistoryOfflineRemove(lang)
        case .removeFailed(let n): return L10n.appHistoryRemoveFailed(lang, n: n)
        case .openFailed: return L10n.errorFallback(lang)
        case .loadMoreFailed: return L10n.shellLoadFailed(lang)
        }
    }

    private func retry(_ lang: AppLang) -> some View {
        Button(L10n.caseRetry(lang)) { refresh(force: true) }
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

/// A row in select mode: a tap picks it instead of opening it.
private struct PickableRow: View {
    let entry: HistoryEntry
    let lang: AppLang
    let now: Date
    let selected: Bool
    let toggle: () -> Void

    var body: some View {
        Button(action: toggle) {
            HStack(spacing: 12) {
                SelectCircle(selected: selected)
                EntryRow(entry: entry, lang: lang, now: now)
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

private struct EntryRow: View {
    let entry: HistoryEntry
    let lang: AppLang
    let now: Date

    var body: some View {
        switch entry {
        case .account(let item): AccountRow(item: item, lang: lang, now: now)
        case .phone(let row): PhoneRow(row: row, lang: lang)
        }
    }
}

/// A row of the account's list: its state from the viewer's side, its
/// title, the date and tags.
private struct AccountRow: View {
    let item: HistoryItem
    let lang: AppLang
    let now: Date

    @Environment(\.sides) private var sides

    var body: some View {
        let status = HistoryLabels.status(item, lang: lang, now: now)
        let muted = HistoryLabels.muted(item, now: now)
        let date = ErrorText.parseISO(item.at).map(dateText)
        let meta = ([date].compactMap { $0 } + HistoryLabels.tags(item, lang: lang)).joined(separator: " · ")
        HStack(alignment: .top, spacing: 12) {
            Circle()
                .fill(dot(HistoryLabels.tone(item, now: now)))
                .frame(width: 12, height: 12)
                .padding(.top, 4)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                if status != nil || item.yourMove {
                    HStack(spacing: 8) {
                        if let status {
                            Text(status)
                                .brandText(.slotTitle)
                                .foregroundStyle(muted ? Brand.muted : Brand.ink)
                        }
                        if item.yourMove { YourMoveChip(text: L10n.historyYourMove(lang)) }
                    }
                }
                Text(HistoryLabels.title(item, lang: lang))
                    .brandText(.slotText)
                    .foregroundStyle(muted ? Brand.muted : Brand.ink2)
                    .lineLimit(2)
                if !meta.isEmpty {
                    Text(meta)
                        .brandText(.footnote)
                        .foregroundStyle(Brand.muted)
                }
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }

    private func dateText(_ date: Date) -> String {
        date.formatted(Date.FormatStyle(date: .abbreviated, time: .shortened).locale(lang.locale))
    }

    private func dot(_ tone: HistoryLabels.Tone) -> Color {
        switch tone {
        case .yours: return sides.mine.ink
        case .theirs: return sides.theirs.ink
        case .neutral: return Brand.ink
        case .thinking: return Brand.stone
        case .waiting: return Brand.terra
        case .attention: return Brand.danger
        case .muted: return Brand.muted
        }
    }
}

/// "Your turn": something waits on the viewer.
private struct YourMoveChip: View {
    let text: String

    var body: some View {
        Text(text)
            .brandText(TypeStyle(face: .inter, weight: 600, size: 12, lineHeight: 1.3, textStyle: .footnote))
            .foregroundStyle(Brand.terraInk)
            .padding(.horizontal, 9)
            .padding(.vertical, 3)
            .background(Capsule().fill(Brand.terraTint))
    }
}

/// A verdict kept on this phone that the account doesn't have.
private struct PhoneRow: View {
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
        let date = row.createdAt.formatted(Date.FormatStyle(date: .abbreviated, time: .shortened).locale(lang.locale))
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
                Text(date + " · " + L10n.appHistoryPhoneOnly(lang))
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

/// A verdict kept on the phone, viewable offline (translations come from
/// the cache first, otherwise they are fetched when online).
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
