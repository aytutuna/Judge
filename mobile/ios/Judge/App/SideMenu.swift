import SwiftData
import SwiftUI
import UIKit

extension View {
    /// A bar button on its own round plate, the size of Apple's round
    /// toolbar buttons: glass on iOS 26, a blurred tint before it, since the
    /// bar has no background and the page scrolls under it.
    @ViewBuilder
    func roundPlate(tint: Color? = nil) -> some View {
        if #available(iOS 26.0, *) {
            frame(width: 44, height: 44)
                .glassEffect(.regular.tint(tint).interactive(), in: Circle())
                .contentShape(Circle())
        } else {
            frame(width: 44, height: 44)
                .background(Circle().fill(tint ?? Brand.ink.opacity(0.08)))
                .background(Circle().fill(.regularMaterial))
                .contentShape(Circle())
        }
    }

    /// No bar at all: no background, and on iOS 26 no blur or fade where the
    /// page scrolls under it, so the buttons float on the page.
    @ViewBuilder
    func clearBar() -> some View {
        if #available(iOS 26.0, *) {
            toolbarBackground(.hidden, for: .navigationBar)
                .scrollEdgeEffectHidden(true, for: .top)
        } else {
            toolbarBackground(.hidden, for: .navigationBar)
        }
    }
}

extension ToolbarContent {
    /// iOS 26 merges neighbouring items into one wide glass pill; the round
    /// buttons draw their own plate, so the shared one is dropped.
    @ToolbarContentBuilder
    func ownBackground() -> some ToolbarContent {
        if #available(iOS 26.0, *) {
            self.sharedBackgroundVisibility(.hidden)
        } else {
            self
        }
    }
}

/// Opens the side menu, at the leading end of a root page's bar.
struct MenuButton: View {
    @Environment(AppModel.self) private var app
    @Environment(\.tabShown) private var tabShown
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @AccessibilityFocusState private var focused: Bool

    var body: some View {
        Button {
            app.openMenu()
        } label: {
            Image(systemName: "line.3.horizontal")
                .font(.system(size: 17, weight: .medium))
                .foregroundStyle(Brand.ink)
                .roundPlate()
        }
        .accessibilityLabel(L10n.navTabs(app.lang))
        .accessibilityFocused($focused)
        .onChange(of: app.menuOpen) { _, open in
            // The panel still confines VoiceOver while it slides out.
            guard !open else { return }
            Task {
                try? await Task.sleep(for: .milliseconds(reduceMotion ? 0 : 300))
                if tabShown { focused = true }
            }
        }
    }
}

/// Starts a new argument, at the trailing end of a root page's bar.
struct ComposeButton: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        Button {
            app.go(.new)
        } label: {
            Image(systemName: "square.and.pencil")
                .font(.system(size: 17, weight: .medium))
                .foregroundStyle(Brand.ink)
                .roundPlate()
        }
        .accessibilityLabel(L10n.shellNew(app.lang))
    }
}

/// The verdict screen's trailing bar end, level with the back button: Copy
/// link (not for the writer, who copies from the share sheet) and Share, each
/// on a round plate.
struct VerdictBarTrailing: ToolbarContent {
    let shareURL: URL
    /// The anonymized original headline.
    let shareSubject: String
    let lang: AppLang
    let writer: Bool

    var body: some ToolbarContent {
        ToolbarItem(placement: .topBarTrailing) {
            VerdictBarButtons(shareURL: shareURL, shareSubject: shareSubject, lang: lang, writer: writer)
        }
        .ownBackground()
    }
}

private struct VerdictBarButtons: View {
    @Environment(AppModel.self) private var app
    let shareURL: URL
    let shareSubject: String
    let lang: AppLang
    let writer: Bool
    @State private var copied = false

    var body: some View {
        HStack(spacing: 0) {
            if !writer {
                Button {
                    UIPasteboard.general.url = shareURL
                    copied = true
                } label: {
                    Image(systemName: copied ? "checkmark" : "link")
                        .font(.system(size: 17, weight: .medium))
                        .foregroundStyle(Brand.ink)
                        .roundPlate()
                }
                .accessibilityLabel(copied ? L10n.copied(lang) : L10n.copyLink(lang))
                .task(id: copied) {
                    guard copied else { return }
                    try? await Task.sleep(for: .seconds(2))
                    if !Task.isCancelled { copied = false }
                }
            }
            ShareLink(item: shareURL, subject: Text(shareSubject), message: Text(L10n.shareText(lang))) {
                Image(systemName: "square.and.arrow.up")
                    .font(.system(size: 17, weight: .medium))
                    .foregroundStyle(Brand.ink)
                    .roundPlate()
            }
            .accessibilityLabel(L10n.share(lang))
            .simultaneousGesture(TapGesture().onEnded { app.analytics.track("share_tapped") })
        }
    }
}

/// The look of the Gamify control: the gamepad on a round plate that lights
/// up when it is on. The label is for VoiceOver only.
private struct GamifyToggleStyle: ToggleStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        let on = configuration.isOn
        return Button {
            configuration.isOn.toggle()
        } label: {
            Image(systemName: "gamecontroller")
                .font(.system(size: 17, weight: .medium))
                .foregroundStyle(on ? Brand.rubyInk : Brand.muted)
                .roundPlate(tint: on ? Brand.ruby.opacity(0.22) : nil)
                .background(Circle().fill(Brand.ruby.opacity(on ? 0.4 : 0)).blur(radius: 6))
                .animation(reduceMotion ? nil : .easeOut(duration: 0.15), value: on)
        }
        .buttonStyle(.plain)
        .accessibilityRepresentation {
            Toggle(isOn: configuration.$isOn) { configuration.label }
        }
    }
}

/// Turns the street court on or off, at the trailing end of a root page's bar.
struct GamifyButton: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        Toggle(L10n.shellGamify(app.lang), isOn: Binding(get: { app.gamify }, set: { app.setGamify($0) }))
            .toggleStyle(GamifyToggleStyle())
    }
}

/// A profile picture: their image, else their initial, else a silhouette.
struct ProfileAvatar: View {
    @Environment(AppModel.self) private var app

    /// First letter of the name, or of the email when there is no name.
    static func initial(name: String, email: String) -> String {
        let source = name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? email : name
        let letter = source.trimmingCharacters(in: .whitespacesAndNewlines).prefix(1).uppercased()
        return letter.isEmpty ? "?" : letter
    }

    var body: some View {
        if app.account.isSignedIn {
            let user = app.account.user
            let initial = Self.initial(name: user?.name ?? "", email: user?.email ?? "")
            if let image = user?.image, let url = URL(string: image) {
                AsyncImage(url: url) { phase in
                    if let loaded = phase.image {
                        loaded.resizable().scaledToFill()
                    } else {
                        letter(initial)
                    }
                }
            } else {
                letter(initial)
            }
        } else {
            ZStack {
                Brand.well
                Image(systemName: "person.fill")
                    .font(.system(size: 17))
                    .foregroundStyle(Brand.muted)
            }
        }
    }

    private func letter(_ initial: String) -> some View {
        ZStack {
            Brand.terraInk
            Text(initial)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Brand.paper)
        }
    }
}

/// The leading end of a root page's bar: the menu button.
struct RootBarLeading: ToolbarContent {
    var locked = false

    var body: some ToolbarContent {
        ToolbarItem(placement: .topBarLeading) { MenuButton().disabled(locked) }
            .ownBackground()
    }
}

/// The trailing end of a root page's bar: the Gamify button and New, each on
/// its own round plate. The profile is in the side menu.
struct RootBarTrailing: ToolbarContent {
    var locked = false

    var body: some ToolbarContent {
        // One item, because the bar spaces separate items too far apart.
        ToolbarItem(placement: .topBarTrailing) {
            HStack(spacing: 0) {
                GamifyButton()
                ComposeButton()
            }
            .disabled(locked)
        }
        .ownBackground()
    }
}

/// The panel the menu button slides in: New, the Verdicts and the Links
/// (cases sent and received) in one list that scrolls, and at the bottom
/// the profile above Settings.
struct SideMenu: View {
    @Environment(AppModel.self) private var app
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.layoutDirection) private var layoutDirection
    @Query(sort: \SavedVerdict.createdAt, order: .reverse) private var saved: [SavedVerdict]
    @Query private var cachedRows: [HistoryCacheRow]
    @State private var pull: CGFloat = 0
    @GestureState private var dragging = false
    @State private var webLink: WebLink?
    @State private var profileOpen = false
    @State private var confirmSignOut = false
    @State private var confirming: [String]?
    @State private var confirmingAll = false
    /// Rows near the end that are on screen.
    @State private var tailShown: Set<String> = []
    /// Where the sides of the owner's waiting links stand, by case id, while the menu is open.
    @State private var live: [String: [CaseLiveSide]] = [:]
    @Environment(\.scenePhase) private var scenePhase
    @AccessibilityFocusState private var focusFirst: Bool

    private var settle: Duration { .milliseconds(reduceMotion ? 0 : 300) }

    private static let rowType = TypeStyle(face: .inter, weight: 500, size: 16, lineHeight: 1.3)
    private static let recentType = TypeStyle(face: .inter, weight: 400, size: 14, lineHeight: 1.3, textStyle: .subheadline)
    private static let stateType = TypeStyle(face: .inter, weight: 600, size: 12.5, lineHeight: 1.3, textStyle: .footnote)
    private static let headingType = TypeStyle(face: .inter, weight: 700, size: 13, lineHeight: 1.3, tracking: 0.04, textStyle: .footnote, maxScale: 1.6)

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                if app.menuOpen {
                    Button(action: close) {
                        Color(light: UIColor(hex: PaletteHex.ink, alpha: 0.28), dark: UIColor(white: 0, alpha: 0.5))
                            .ignoresSafeArea()
                    }
                    .buttonStyle(.plain)
                    .keyboardShortcut(.cancelAction)
                    .accessibilityLabel(L10n.appClose(app.lang))
                    .transition(.opacity)
                    panel(width: min(300, geo.size.width * 0.85), height: geo.size.height)
                        .transition(.move(edge: .leading))
                }
            }
        }
        .allowsHitTesting(app.menuOpen)
        .animation(reduceMotion ? nil : .easeOut(duration: 0.24), value: app.menuOpen)
        .onChange(of: app.menuOpen) { _, open in
            if open { pull = 0 } else { profileOpen = false; live = [:] }
        }
        .onChange(of: app.home.path.count) { close() }
        .onChange(of: app.home.isJudging) { _, judging in
            if judging { close() }
        }
        .sheet(item: $webLink) { link in
            SafariView(url: link.url).ignoresSafeArea()
        }
        .onChange(of: webLink != nil) { _, open in
            app.sheetOpen = open
        }
        .alert(L10n.appAccountSignOutConfirm(app.lang), isPresented: $confirmSignOut) {
            Button(L10n.accountSignOut(app.lang), role: .destructive) {
                close()
                Task { await app.account.signOut() }
            }
            Button(L10n.appCancel(app.lang), role: .cancel) {}
        }
        .confirmationDialog(
            HistoryLabels.removeConfirm(currentEntries.filter { Set(confirming ?? []).contains($0.id) }, lang: app.lang),
            isPresented: Binding(get: { confirming != nil }, set: { if !$0 { confirming = nil; confirmingAll = false } }),
            titleVisibility: .visible
        ) {
            Button(confirmingAll ? L10n.appHistoryRemoveAll(app.lang) : L10n.appHistoryDelete(app.lang), role: .destructive) { remove(confirming ?? []) }
            Button(L10n.appCancel(app.lang), role: .cancel) {}
        }
    }

    private var currentEntries: [HistoryEntry] {
        HistoryEntry.current(app: app, rows: cachedRows, saved: saved)
    }

    private func refresh(force: Bool = false) {
        let list = app.historyList
        let user = app.historyUser
        let enabled = app.account.features.history
        Task { await list.refresh(user: user, enabled: enabled, force: force) }
    }

    /// The owner's links still waiting on someone.
    private func isWaitingLink(_ entry: HistoryEntry, now: Date) -> Bool {
        guard case .account(let item) = entry else { return false }
        return item.isCase && !item.isRespondent && HistoryLabels.state(item, now: now) == .waiting
    }

    /// Reads where the waiting links stand; a link that dropped out of the
    /// answer or gained an answered side changes the list, so it is read again.
    private func pollLive() async {
        guard let cases = try? await app.api.liveCases() else { return }
        let fresh = Dictionary(cases.map { ($0.id, $0.sides) }, uniquingKeysWith: { first, _ in first })
        let moved = live.contains { id, old in
            guard let sides = fresh[id] else { return true }
            return CaseLogic.answeredCount(sides) > CaseLogic.answeredCount(old)
        }
        live = fresh
        if moved { refresh(force: true) }
    }

    private func remove(_ keys: [String]) {
        let wanted = Set(keys)
        let picked = currentEntries.filter { wanted.contains($0.id) }
        let list = app.historyList
        let user = app.historyUser
        let enabled = app.account.features.history
        Task { _ = await list.remove(picked, user: user, enabled: enabled) }
    }

    /// Asks about every link, not just those on the pages loaded so far.
    private func removeAllLinks() {
        let list = app.historyList
        let user = app.historyUser
        Task {
            var cursor = list.next
            while let at = cursor {
                await list.loadMore(user: user)
                if list.next == at { break }
                cursor = list.next
            }
            confirmingAll = true
            confirming = currentEntries.filter { $0.isCase && $0.removable }.map(\.id)
        }
    }

    private func panel(width: CGFloat, height: CGFloat) -> some View {
        let lang = app.lang
        let list = app.historyList
        let entries = currentEntries
        let verdicts = entries.filter { !$0.isCase }
        let links = entries.filter(\.isCase)
        let shown = verdicts + links
        let now = list.now()
        let thinking = entries.contains { entry in
            if case .account(let item) = entry { return item.historyState?.thinking == true }
            return false
        }
        let watching = app.menuOpen && scenePhase == .active && links.contains { isWaitingLink($0, now: now) }
        return VStack(spacing: 0) {
            List {
                row(.new, title: L10n.appTabNew(lang))
                    .accessibilityFocused($focusFirst)
                    .simultaneousGesture(closeDrag(width))
                    .menuListRow()
                if let notice = list.notice {
                    Text(noticeText(notice, lang: lang))
                        .brandText(.footnote)
                        .foregroundStyle(Brand.danger)
                        .padding(.horizontal, 12)
                        .simultaneousGesture(closeDrag(width))
                        .menuListRow()
                }
                if !verdicts.isEmpty {
                    heading(L10n.navVerdicts(lang)).simultaneousGesture(closeDrag(width)).menuListRow()
                    ForEach(verdicts) { entry in
                        entryRow(entry, entries: shown, width: width, lang: lang, now: now)
                    }
                }
                if !links.isEmpty {
                    heading(L10n.navLinks(lang), removeAll: links.contains(where: \.removable) ? { removeAllLinks() } : nil)
                        .simultaneousGesture(closeDrag(width))
                        .menuListRow()
                    ForEach(links) { entry in
                        entryRow(entry, entries: shown, width: width, lang: lang, now: now)
                    }
                }
                if entries.isEmpty {
                    if list.loading {
                        ProgressView().tint(Brand.muted)
                            .frame(maxWidth: .infinity)
                            .padding(.top, 16)
                            .simultaneousGesture(closeDrag(width))
                            .menuListRow()
                    } else if list.failed {
                        loadFailed(lang).simultaneousGesture(closeDrag(width)).menuListRow()
                    } else {
                        Text(L10n.appHistoryEmpty(lang))
                            .brandText(.footnote)
                            .foregroundStyle(Brand.muted)
                            .padding(.horizontal, 12)
                            .padding(.top, 8)
                            .simultaneousGesture(closeDrag(width))
                            .menuListRow()
                        if !app.account.isSignedIn {
                            Button(L10n.shellLocalSignIn(lang)) {
                                app.menuOpen = false
                                app.account.presentSignIn()
                            }
                            .buttonStyle(GhostButtonStyle())
                            .frame(maxWidth: .infinity)
                            .simultaneousGesture(closeDrag(width))
                            .menuListRow()
                        }
                    }
                } else if list.failed {
                    loadFailed(lang).simultaneousGesture(closeDrag(width)).menuListRow()
                }
                if list.next != nil {
                    Group {
                        if list.loadingMore {
                            ProgressView().tint(Brand.muted)
                        } else {
                            Button(L10n.shellLoadMore(lang)) {
                                Task { await list.loadMore(user: app.historyUser) }
                            }
                            .buttonStyle(GhostButtonStyle())
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .simultaneousGesture(closeDrag(width))
                    .menuListRow()
                }
                if entries.contains(where: \.isPhone) {
                    Text(L10n.appHistoryPhoneOnlyNote(lang))
                        .brandText(.footnote)
                        .foregroundStyle(Brand.muted)
                        .padding(.horizontal, 12)
                        .padding(.top, 8)
                        .simultaneousGesture(closeDrag(width))
                        .menuListRow()
                }
                // The list's own empty area takes the touch itself, so a plain row stands in
                // for it. It only fills what the rows leave, or the list would always scroll.
                Color.clear
                    .frame(height: max(0, height - 242 - Self.rowsHeight(shown.count)))
                    .contentShape(Rectangle())
                    .simultaneousGesture(closeDrag(width))
                    .menuListRow()
                    .accessibilityHidden(true)
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .scrollBounceBehavior(.basedOnSize)
            // A page of rows the phone already had doesn't grow the list, so no
            // new row appears: keep going while the end is on screen.
            .onChange(of: list.next) { _, next in
                guard next != nil, !tailShown.isDisjoint(with: shown.suffix(3).map(\.id)) else { return }
                Task { await list.loadMore(user: app.historyUser) }
            }
            .refreshable { await list.refresh(user: app.historyUser, enabled: app.account.features.history, force: true) }
            VStack(spacing: 4) {
                if profileOpen { profileItems(lang) }
                profile(lang)
                row(.settings, title: L10n.appTabSettings(lang), icon: "gearshape")
            }
            .padding(.top, 12)
            .contentShape(Rectangle())
            .simultaneousGesture(closeDrag(width))
        }
        // While the judges work on a row, the list is read again now and then.
        .task(id: thinking) {
            guard thinking else { return }
            while !Task.isCancelled {
                try? await Task.sleep(for: HistoryListModel.pollEvery)
                if Task.isCancelled { return }
                await list.refresh(user: app.historyUser, enabled: app.account.features.history, force: true)
            }
        }
        .task(id: watching) {
            guard watching else { return }
            while !Task.isCancelled {
                await pollLive()
                try? await Task.sleep(for: .seconds(3))
            }
        }
        .padding(.horizontal, 12)
        .padding(.top, 20)
        .padding(.bottom, 22)
        .frame(width: width)
        .frame(maxHeight: .infinity)
        .background(Brand.ivory2.ignoresSafeArea().gesture(closeDrag(width)))
        .offset(x: layoutDirection == .rightToLeft ? pull : -pull)
        .onChange(of: dragging) { _, active in
            // A cancelled drag never reaches onEnded.
            if !active, app.menuOpen {
                withAnimation(reduceMotion ? nil : .easeOut(duration: 0.2)) { pull = 0 }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityAddTraits(.isModal)
        .accessibilityAction(.escape) { close() }
        .onAppear {
            refresh()
            Task {
                try? await Task.sleep(for: settle)
                focusFirst = true
            }
        }
        .onChange(of: app.historyUser) { _, _ in refresh(force: true) }
        .onDisappear { focusFirst = false }
    }

    private func row(_ tab: RootTab, title: String, icon: String? = nil) -> some View {
        let selected = app.tab == tab
        return Button {
            app.menuOpen = false
            app.go(tab)
        } label: {
            HStack(spacing: 12) {
                if let icon {
                    Image(systemName: icon)
                        .font(.system(size: 18))
                        .frame(width: 36)
                        .accessibilityHidden(true)
                }
                Text(title)
                    .brandText(Self.rowType)
                    .multilineTextAlignment(.leading)
            }
            .foregroundStyle(Brand.ink)
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .frame(maxWidth: .infinity, minHeight: 48, alignment: .leading)
            .background {
                if selected {
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(Brand.paper)
                        .shadow(color: Brand.shadow(0.1, dark: 0.3), radius: 1.5, y: 1)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    /// A generous guess at the height of the rows and headings shown, so the
    /// filler never pushes the list past the panel.
    private static func rowsHeight(_ count: Int) -> CGFloat { 180 + CGFloat(count) * 72 }

    private func heading(_ title: String, removeAll: (() -> Void)? = nil) -> some View {
        HStack(spacing: 8) {
            Text(title)
                .brandText(Self.headingType)
                .foregroundStyle(Brand.muted)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: 0)
            if let removeAll {
                Button(action: removeAll) {
                    Text(L10n.appHistoryRemoveAll(app.lang))
                        .brandText(Self.stateType)
                        .foregroundStyle(Brand.danger)
                        .padding(.leading, 12)
                        .frame(minHeight: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 12)
        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
        .overlay(alignment: .bottom) { Rectangle().fill(Brand.line).frame(height: 1) }
        .padding(.top, 8)
    }

    /// One verdict or link as its own card: green when the ruling went the viewer's
    /// way, red when it went the other's. The result words stay under the
    /// title so colour is never the only signal.
    private func recent(_ entry: HistoryEntry, lang: AppLang, now: Date) -> some View {
        let tone = entry.tone(now: now)
        var muted = false
        if case .account(let item) = entry { muted = HistoryLabels.muted(item, now: now) }
        var status = entry.status(lang: lang, now: now)
        if case .account(let item) = entry, isWaitingLink(entry, now: now), let sides = live[item.id],
           let label = CaseLogic.liveLabel(sides, lang: lang) {
            status = label
        }
        let (fill, edge, words): (Color, Color, Color) = switch tone {
        case .yours: (Brand.sageTint, Brand.sageStrong, Brand.sageInk)
        case .theirs: (Brand.terraTint, Brand.terra, Brand.terraInk)
        default: (Brand.paper, Brand.line2, Brand.muted)
        }
        return Button {
            app.menuOpen = false
            Task {
                if let url = await app.openRecent(entry) { webLink = WebLink(url: url) }
            }
        } label: {
            VStack(alignment: .leading, spacing: 2) {
                Text(entry.title(lang: lang))
                    .brandText(Self.recentType)
                    .foregroundStyle(Brand.ink)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                if let status {
                    Text(status)
                        .brandText(Self.stateType)
                        .foregroundStyle(words)
                        .lineLimit(1)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity, minHeight: 52, alignment: .leading)
            .paperSurface(radius: 12, fill: fill, border: edge)
            .opacity(muted ? 0.6 : 1)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!entry.opens)
        .accessibilityIdentifier(entry.isCase ? "menu.link" : "menu.verdict")
    }

    /// A card with delete on a swipe and a long press, where the entry can
    /// be removed. A full swipe asks the same question the long press does.
    @ViewBuilder
    private func entryRow(_ entry: HistoryEntry, entries: [HistoryEntry], width: CGFloat, lang: AppLang, now: Date) -> some View {
        let card = recent(entry, lang: lang, now: now)
            .menuListRow()
            .onAppear {
                guard let index = entries.firstIndex(where: { $0.id == entry.id }), index >= entries.count - 3 else { return }
                tailShown.insert(entry.id)
                if app.historyList.next != nil {
                    Task { await app.historyList.loadMore(user: app.historyUser) }
                }
            }
            .onDisappear { tailShown.remove(entry.id) }
        if entry.removable {
            card
                .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                    // No destructive role: that would take the row away before the question is answered.
                    Button { confirming = [entry.id] } label: {
                        Image(systemName: "trash")
                    }
                    .tint(Brand.danger)
                    .accessibilityLabel(L10n.appHistoryDelete(lang))
                }
                .contextMenu {
                    Button(role: .destructive) { confirming = [entry.id] } label: {
                        Label(L10n.appHistoryDelete(lang), systemImage: "trash")
                    }
                }
        } else {
            card.simultaneousGesture(closeDrag(width))
        }
    }

    private func loadFailed(_ lang: AppLang) -> some View {
        VStack(spacing: 10) {
            Text(L10n.shellLoadFailed(lang))
                .brandText(.footnote)
                .foregroundStyle(Brand.danger)
                .multilineTextAlignment(.center)
            Button(L10n.caseRetry(lang)) { refresh(force: true) }
                .buttonStyle(GhostButtonStyle())
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 8)
    }

    private func noticeText(_ notice: HistoryListModel.Notice, lang: AppLang) -> String {
        switch notice {
        case .offline: return L10n.appHistoryOfflineRemove(lang)
        case .removeFailed(let n): return L10n.appHistoryRemoveFailed(lang, n: n)
        case .openFailed: return L10n.errorFallback(lang)
        case .loadMoreFailed: return L10n.shellLoadFailed(lang)
        }
    }

    /// The picture and name of the account; it opens Pricing, Sign in or Sign out.
    private func profile(_ lang: AppLang) -> some View {
        let user = app.account.isSignedIn ? app.account.user : nil
        let name = user.map { $0.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? $0.email : $0.name } ?? L10n.navAccount(lang)
        return Button {
            withAnimation(reduceMotion ? nil : .easeOut(duration: 0.2)) { profileOpen.toggle() }
        } label: {
            HStack(spacing: 12) {
                ProfileAvatar()
                    .frame(width: 44, height: 44)
                    .clipShape(Circle())
                Text(name)
                    .brandText(Self.rowType)
                    .foregroundStyle(Brand.ink)
                    .lineLimit(1)
                Spacer(minLength: 0)
                Image(systemName: profileOpen ? "chevron.up" : "chevron.down")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(Brand.muted)
                    .accessibilityHidden(true)
            }
            .padding(.horizontal, 12)
            .frame(maxWidth: .infinity, minHeight: 56, alignment: .leading)
            .background {
                if profileOpen {
                    RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Brand.paper)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(L10n.navAccount(lang))
        .accessibilityValue(user == nil ? "" : name)
        .accessibilityAddTraits(profileOpen ? .isSelected : [])
    }

    private func profileItems(_ lang: AppLang) -> some View {
        VStack(spacing: 0) {
            profileItem(L10n.navPricing(lang)) {
                app.menuOpen = false
                app.openPricing()
            }
            if app.account.isSignedIn {
                profileItem(L10n.navSignOut(lang), destructive: true) { confirmSignOut = true }
            } else {
                profileItem(L10n.navSignIn(lang)) {
                    app.menuOpen = false
                    app.account.presentSignIn()
                }
            }
        }
    }

    private func profileItem(_ title: String, destructive: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .brandText(Self.rowType)
                .foregroundStyle(destructive ? Brand.danger : Brand.ink)
                .padding(.leading, 60)
                .padding(.trailing, 12)
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    /// Dragging the panel toward its edge closes it. It is left off the rows
    /// that swipe to remove, whose own leftward swipe it would fight.
    private func closeDrag(_ width: CGFloat) -> some Gesture {
        DragGesture(coordinateSpace: .global)
            .updating($dragging) { _, state, _ in state = true }
            .onChanged { pull = max(0, closing($0.translation.width)) }
            .onEnded { value in
                if closing(value.predictedEndTranslation.width) > width / 2 { close() }
            }
    }

    /// How far a drag has moved toward the panel's own edge.
    private func closing(_ dx: CGFloat) -> CGFloat {
        layoutDirection == .rightToLeft ? dx : -dx
    }

    private func close() {
        app.menuOpen = false
    }
}

extension AppModel {
    /// Goes to a tab. The hidden pages keep the keyboard otherwise.
    func go(_ target: RootTab) {
        if target != tab { dismissKeyboard() }
        select(target)
    }

    /// The Pricing page, under Settings so Back lands on the list.
    func openPricing() {
        go(.settings)
        settingsPath = [.pricing]
    }

    func openMenu() {
        dismissKeyboard()
        menuOpen = true
    }

    /// A menu row: opens on its page from a fresh New tab.
    func openRecent(_ entry: HistoryEntry) async -> URL? {
        // An invite is answered in the browser, so the tab stays as it is.
        if let url = inviteURL(entry) { return url }
        go(.new)
        return await openHistory(entry)
    }

    private func dismissKeyboard() {
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
    }
}

extension View {
    /// A row of the menu's list: no separator or background, and the card's
    /// own spacing.
    fileprivate func menuListRow() -> some View {
        listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0))
            .listRowSeparator(.hidden)
            .listRowBackground(Color.clear)
    }
}
