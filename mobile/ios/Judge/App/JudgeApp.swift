import SwiftData
import SwiftUI
import WebKit

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
        let container = HistoryContainer.make()
        self.container = container
        _app = State(initialValue: AppModel(config: .load(), container: container))
        sceneLive = true
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(app)
                .environment(\.sceneLive, sceneLive)
                .modelContainer(container)
                .preferredColorScheme(.light)
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
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let lang = app.lang
        @Bindable var model = app
        @Bindable var account = app.account
        TabView(selection: $model.tab) {
            HomeTab()
                .tabItem { Label(L10n.appTabNew(lang), systemImage: "square.and.pencil") }
                .tag(RootTab.new)
            HistoryTab()
                .tabItem { Label(L10n.appTabHistory(lang), systemImage: "clock.arrow.circlepath") }
                .tag(RootTab.history)
            SettingsView()
                .tabItem { Label(L10n.appTabSettings(lang), systemImage: "gearshape") }
                .tag(RootTab.settings)
        }
        .toolbarBackground(Brand.ivory, for: .tabBar)
        .toolbarBackground(.visible, for: .tabBar)
        .environment(\.locale, lang.locale)
        .turnstileHost(app.turnstile, lang: lang)
        .sheet(isPresented: $account.isSignInPresented, onDismiss: { app.account.signInDismissed() }) {
            SignInView()
                .environment(app)
                .presentationDragIndicator(.visible)
        }
        .task { await app.account.start() }
        .onOpenURL { url in open(url) }
        .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
            if let url = activity.webpageURL { open(url) }
        }
        .sheet(item: $webLink) { link in
            SafariView(url: link.url).ignoresSafeArea()
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

    /// An okjudge.com link: an invite opens in Safari (answering happens on
    /// the website), a case opens on its page.
    private func open(_ url: URL) {
        guard let link = AppLink.parse(url, site: app.config.shareBaseURL) else { return }
        if let web = app.open(link) { webLink = WebLink(url: web) }
    }
}

/// Keeps the Turnstile web view in the window (1 pt, invisible) so its
/// scripts run normally, and moves it into a sheet when Cloudflare wants a tap.
private struct TurnstileHost: ViewModifier {
    @Bindable var check: TurnstileBotCheck
    let lang: AppLang

    func body(content: Content) -> some View {
        content
            .overlay(alignment: .bottomTrailing) {
                if !check.needsInteraction {
                    WebViewHost(webView: check.webView)
                        .frame(width: 1, height: 1)
                        .opacity(0.01)
                        .allowsHitTesting(false)
                        .accessibilityHidden(true)
                }
            }
            .sheet(isPresented: $check.needsInteraction, onDismiss: { check.dismissInteraction() }) {
                TurnstileSheet(webView: check.webView, lang: lang)
                    .presentationDetents([.height(260)])
            }
    }
}

extension View {
    @ViewBuilder
    func turnstileHost(_ check: TurnstileBotCheck?, lang: AppLang) -> some View {
        if let check {
            modifier(TurnstileHost(check: check, lang: lang))
        } else {
            self
        }
    }
}

/// Hosts an existing web view (the Turnstile widget).
struct WebViewHost: UIViewRepresentable {
    let webView: WKWebView

    func makeUIView(context: Context) -> WKWebView { webView }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
}

private struct TurnstileSheet: View {
    let webView: WKWebView
    let lang: AppLang

    var body: some View {
        VStack(spacing: 16) {
            Text(L10n.turnstileLabel(lang))
                .brandText(.slotTitle)
                .foregroundStyle(Brand.ink)
                .multilineTextAlignment(.center)
            WebViewHost(webView: webView)
                .frame(width: 320, height: 90)
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Brand.ivory)
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
                            VerdictScreen(session: session, onJudgeAnother: { home.judgeAnother() })
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
    var body: some View {
        NavigationStack {
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
