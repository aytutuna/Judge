import SwiftData
import SwiftUI
import UIKit

extension View {
    /// A bar button on its own small round plate, as the website's header
    /// buttons, as large as Apple's own round toolbar buttons.
    fileprivate func roundPlate() -> some View {
        frame(width: 44, height: 44)
            .background(Circle().fill(Brand.ink.opacity(0.08)))
            .contentShape(Rectangle())
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
                .font(.system(size: 22, weight: .semibold))
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
                .font(.system(size: 22, weight: .semibold))
                .foregroundStyle(Brand.ink)
                .roundPlate()
        }
        .accessibilityLabel(L10n.shellNew(app.lang))
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
                .font(.system(size: 22, weight: .semibold))
                .foregroundStyle(on ? Brand.terraInk : Brand.muted)
                .frame(width: 44, height: 44)
                .background(
                    ZStack {
                        Circle()
                            .fill(Brand.terra.opacity(on ? 0.4 : 0))
                            .blur(radius: 6)
                        Circle()
                            .fill(on ? Brand.terra.opacity(0.16) : Brand.ink.opacity(0.08))
                    }
                )
                .contentShape(Rectangle())
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
    var body: some ToolbarContent {
        ToolbarItem(placement: .topBarLeading) { MenuButton() }
            .ownBackground()
    }
}

/// The trailing end of a root page's bar: the Gamify button and New, each on
/// its own round plate. The profile is in the side menu.
struct RootBarTrailing: ToolbarContent {
    var body: some ToolbarContent {
        // One item, because the bar spaces separate items too far apart.
        ToolbarItem(placement: .topBarTrailing) {
            HStack(spacing: 0) {
                GamifyButton()
                ComposeButton()
            }
        }
        .ownBackground()
    }
}

/// The panel the menu button slides in: New, a Verdicts heading over the
/// newest few verdicts, and at the bottom the profile above Settings.
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
    @AccessibilityFocusState private var focusFirst: Bool

    private var settle: Duration { .milliseconds(reduceMotion ? 0 : 300) }

    private static let recentCount = 5
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
                    panel(width: min(300, geo.size.width * 0.85))
                        .transition(.move(edge: .leading))
                }
            }
        }
        .allowsHitTesting(app.menuOpen)
        .animation(reduceMotion ? nil : .easeOut(duration: 0.24), value: app.menuOpen)
        .onChange(of: app.menuOpen) { _, open in
            if open { pull = 0 } else { profileOpen = false }
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
    }

    private func panel(width: CGFloat) -> some View {
        let lang = app.lang
        let recents = HistoryEntry.current(app: app, rows: cachedRows, saved: saved)
            .filter(\.opens)
            .prefix(Self.recentCount)
        let now = app.historyList.now()
        return VStack(spacing: 0) {
            ScrollView {
                VStack(spacing: 8) {
                    row(.new, title: L10n.appTabNew(lang))
                        .accessibilityFocused($focusFirst)
                    heading(L10n.navVerdicts(lang))
                    ForEach(Array(recents)) { entry in
                        recent(entry, lang: lang, now: now)
                    }
                }
            }
            .scrollBounceBehavior(.basedOnSize)
            VStack(spacing: 4) {
                if profileOpen { profileItems(lang) }
                profile(lang)
                row(.settings, title: L10n.appTabSettings(lang), icon: "gearshape")
            }
            .padding(.top, 12)
        }
        .padding(.horizontal, 12)
        .padding(.top, 20)
        .padding(.bottom, 22)
        .frame(width: width)
        .frame(maxHeight: .infinity)
        .background(Brand.ivory2.ignoresSafeArea())
        .offset(x: layoutDirection == .rightToLeft ? pull : -pull)
        .gesture(
            DragGesture(coordinateSpace: .global)
                .updating($dragging) { _, state, _ in state = true }
                .onChanged { pull = max(0, closing($0.translation.width)) }
                .onEnded { value in
                    if closing(value.predictedEndTranslation.width) > width / 2 { close() }
                }
        )
        .onChange(of: dragging) { _, active in
            // A cancelled drag never reaches onEnded.
            if !active, app.menuOpen {
                withAnimation(reduceMotion ? nil : .easeOut(duration: 0.2)) { pull = 0 }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityAddTraits(.isModal)
        .accessibilityAction(.escape, close)
        .onAppear {
            Task {
                try? await Task.sleep(for: settle)
                focusFirst = true
            }
        }
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

    /// A section heading that still opens the list.
    private func heading(_ title: String) -> some View {
        let selected = app.tab == .history
        return Button {
            app.menuOpen = false
            app.go(.history)
        } label: {
            HStack {
                Text(title)
                    .brandText(Self.headingType)
                    .foregroundStyle(selected ? Brand.ink : Brand.muted)
                Spacer(minLength: 8)
                Image(systemName: "chevron.forward")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(Brand.muted)
                    .accessibilityHidden(true)
            }
            .padding(.horizontal, 12)
            .frame(maxWidth: .infinity, minHeight: 44)
            .overlay(alignment: .bottom) { Rectangle().fill(Brand.line).frame(height: 1) }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .padding(.top, 8)
        .accessibilityAddTraits(selected ? [.isHeader, .isSelected] : .isHeader)
    }

    /// One verdict as its own card: green when the ruling went the viewer's
    /// way, red when it went the other's. The result words stay under the
    /// title so colour is never the only signal.
    private func recent(_ entry: HistoryEntry, lang: AppLang, now: Date) -> some View {
        let tone = entry.tone(now: now)
        let status = entry.status(lang: lang, now: now)
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
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
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

    /// A recent row: opens like in Verdicts, from a fresh list.
    func openRecent(_ entry: HistoryEntry) async -> URL? {
        go(.history)
        historyPath.removeAll()
        return await openHistory(entry)
    }

    private func dismissKeyboard() {
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
    }
}
