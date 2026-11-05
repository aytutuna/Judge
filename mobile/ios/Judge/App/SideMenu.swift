import SwiftData
import SwiftUI
import UIKit

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
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(Brand.ink)
                .frame(minWidth: 44, minHeight: 44)
                .contentShape(Rectangle())
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
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(Brand.ink)
                .frame(minWidth: 44, minHeight: 44)
                .contentShape(Rectangle())
        }
        .accessibilityLabel(L10n.shellNew(app.lang))
    }
}

/// The panel the menu button slides in: New, Verdicts and the newest few
/// verdicts, with Settings at the bottom.
struct SideMenu: View {
    @Environment(AppModel.self) private var app
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.layoutDirection) private var layoutDirection
    @Query(sort: \SavedVerdict.createdAt, order: .reverse) private var saved: [SavedVerdict]
    @Query private var cachedRows: [HistoryCacheRow]
    @State private var pull: CGFloat = 0
    @GestureState private var dragging = false
    @State private var webLink: WebLink?
    @AccessibilityFocusState private var focusFirst: Bool

    private var settle: Duration { .milliseconds(reduceMotion ? 0 : 300) }

    private static let recentCount = 5
    private static let rowType = TypeStyle(face: .inter, weight: 500, size: 16, lineHeight: 1.3)
    private static let recentType = TypeStyle(face: .inter, weight: 400, size: 14, lineHeight: 1.3, textStyle: .subheadline)

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
            if open { pull = 0 }
        }
        .onChange(of: app.home.path.count) { close() }
        .onChange(of: app.home.isJudging) { _, judging in
            if judging { close() }
        }
        .sheet(item: $webLink) { link in
            SafariView(url: link.url).ignoresSafeArea()
        }
    }

    private func panel(width: CGFloat) -> some View {
        let lang = app.lang
        let recents = HistoryEntry.current(app: app, rows: cachedRows, saved: saved)
            .filter(\.opens)
            .prefix(Self.recentCount)
        return VStack(spacing: 0) {
            ScrollView {
                VStack(spacing: 4) {
                    row(.new, title: L10n.appTabNew(lang))
                        .accessibilityFocused($focusFirst)
                    row(.history, title: L10n.navVerdicts(lang))
                    ForEach(Array(recents)) { entry in
                        recent(entry, lang: lang)
                    }
                }
            }
            .scrollBounceBehavior(.basedOnSize)
            row(.settings, title: L10n.appTabSettings(lang))
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

    private func row(_ tab: RootTab, title: String) -> some View {
        let selected = app.tab == tab
        return Button {
            app.menuOpen = false
            app.go(tab)
        } label: {
            Text(title)
                .brandText(Self.rowType)
                .foregroundStyle(Brand.ink)
                .multilineTextAlignment(.leading)
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

    private func recent(_ entry: HistoryEntry, lang: AppLang) -> some View {
        Button {
            app.menuOpen = false
            Task {
                if let url = await app.openRecent(entry) { webLink = WebLink(url: url) }
            }
        } label: {
            Text(entry.title(lang: lang))
                .brandText(Self.recentType)
                .foregroundStyle(Brand.ink2)
                .lineLimit(1)
                .padding(.horizontal, 12)
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
