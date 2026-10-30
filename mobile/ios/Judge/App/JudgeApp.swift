import SwiftData
import SwiftUI

@main
struct JudgeApp: App {
    private let container: ModelContainer
    @State private var app: AppModel
    private let sceneLive: Bool

    init() {
        #if DEBUG
        if let screenshot = ScreenshotState.fromLaunchArguments() {
            let container = HistoryContainer.inMemory()
            self.container = container
            let model = screenshot.makeModel(container: container)
            model.tab = screenshot.tab
            _app = State(initialValue: model)
            sceneLive = false
            return
        }
        #endif
        let config = AppConfig.load()
        // Hosted unit tests launch the app too; their runs stay out of the counts
        // and out of the crash reports.
        let testing = ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] != nil
        if !testing { CrashReporting.start(config) }
        let container = HistoryContainer.make()
        self.container = container
        _app = State(initialValue: AppModel(config: config, container: container, analyticsFile: Analytics.defaultFile, sendsUsageEvents: !testing))
        sceneLive = true
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(app)
                .environment(\.sceneLive, sceneLive)
                .modelContainer(container)
                .tint(Brand.terraInk)
        }
    }
}

enum RootTab: Hashable {
    case new, history, settings
}

struct RootView: View {
    @Environment(AppModel.self) private var app
    @State private var showLaunchMark = true
    @State private var webLink: WebLink?
    @State private var ageWindow = AgeGateWindow()
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        let lang = app.lang
        @Bindable var model = app
        @Bindable var account = app.account
        TabView(selection: $model.tab) {
            HomeTab()
                .tabItem { Label(L10n.appTabNew(lang), systemImage: "square.and.pencil") }
                .tag(RootTab.new)
            HistoryTab()
                .tabItem { Label(L10n.navVerdicts(lang), systemImage: "clock.arrow.circlepath") }
                .tag(RootTab.history)
            SettingsView()
                .tabItem { Label(L10n.appTabSettings(lang), systemImage: "gearshape") }
                .tag(RootTab.settings)
        }
        .toolbarBackground(Brand.ivory, for: .tabBar)
        .toolbarBackground(.visible, for: .tabBar)
        .accessibilityHidden(ageCovered)
        .sheet(isPresented: $account.isSignInPresented, onDismiss: { app.account.signInDismissed() }) {
            SignInView()
                .environment(app)
                .presentationDragIndicator(.visible)
        }
        .task { await app.account.start() }
        .onChange(of: scenePhase, initial: true) { _, phase in
            if phase == .active { app.analytics.becameActive() }
            if phase == .background { app.analytics.enteredBackground() }
        }
        .onChange(of: app.account.isSignedIn) { _, signedIn in
            if signedIn { app.analytics.track("sign_in_completed") }
        }
        .onOpenURL { url in open(url) }
        .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
            if let url = activity.webpageURL { open(url) }
        }
        .sheet(item: $webLink) { link in
            SafariView(url: link.url).ignoresSafeArea()
        }
        // Outside the sheets, so they follow the app's language too.
        .environment(\.locale, lang.locale)
        .environment(\.layoutDirection, lang.isRTL ? .rightToLeft : .leftToRight)
        .preferredColorScheme(app.appearance.colorScheme)
        .onChange(of: ageCovered, initial: true) { _, covered in
            ageWindow.show(covered, app: app)
        }
        .onChange(of: app.account.needsPlatformAge(onSignIn: false), initial: true) { _, needed in
            // A signed-in account that still has to confirm asks the phone first.
            if needed { Task { await app.account.checkPlatformAge() } }
        }
        .overlay {
            // The first frame repeats the launch screen, then fades into Home.
            if showLaunchMark {
                ZStack {
                    Brand.ivory.ignoresSafeArea()
                    Image("LaunchMark").accessibilityHidden(true)
                }
                .transition(.opacity)
                .task {
                    try? await Task.sleep(for: .milliseconds(reduceMotion ? 0 : 350))
                    withAnimation(reduceMotion ? nil : .easeOut(duration: 0.35)) { showLaunchMark = false }
                }
            }
        }
    }

    /// The age gate is up, unless the phone's own prompt may still be on
    /// screen (the gate would cover it).
    private var ageCovered: Bool {
        app.account.ageGate != .none && !app.account.platformPrompting
    }

    /// An okjudge.com link: an invite opens in Safari (answering happens on
    /// the website), a case opens on its page.
    private func open(_ url: URL) {
        guard let link = AppLink.parse(url, site: app.config.shareBaseURL) else { return }
        if let web = app.open(link) { webLink = WebLink(url: web) }
    }
}

private struct HomeTab: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        @Bindable var home = app.home
        NavigationStack(path: $home.path) {
            HomeView()
                .navigationDestination(for: HomeRoute.self) { route in
                    switch route {
                    case .verdict(let id):
                        if let session = home.session(id) {
                            VerdictScreen(session: session, thread: true)
                        } else {
                            MissingVerdictView()
                        }
                    case .saved(let id):
                        HistoryDetailView(id: id)
                    case .pricing:
                        PricingView()
                    case .caseDetail(let id):
                        CaseScreen(id: id)
                    }
                }
        }
    }
}

private struct HistoryTab: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        @Bindable var model = app
        NavigationStack(path: $model.historyPath) {
            HistoryView()
                .navigationDestination(for: HistoryRoute.self) { route in
                    switch route {
                    case .detail(let id): HistoryDetailView(id: id)
                    case .caseDetail(let id): CaseScreen(id: id)
                    }
                }
        }
    }
}

/// Shown when a route points at a verdict that is no longer available.
struct MissingVerdictView: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        VStack(spacing: 10) {
            Text(L10n.notFoundTitle(app.lang)).brandText(.slotTitle).foregroundStyle(Brand.ink)
            Text(L10n.notFoundBody(app.lang)).brandText(.slotText).foregroundStyle(Brand.muted)
        }
        .multilineTextAlignment(.center)
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Brand.ivory)
    }
}
