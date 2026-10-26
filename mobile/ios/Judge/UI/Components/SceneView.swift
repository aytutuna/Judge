import SwiftUI
import UIKit
import WebKit

extension EnvironmentValues {
    /// Off in screenshot states: the flat balance stands in for the web view
    /// so simulator shots come out the same every run.
    var sceneLive: Bool {
        get { self[SceneLiveKey.self] }
        set { self[SceneLiveKey.self] = newValue }
    }
}

private struct SceneLiveKey: EnvironmentKey {
    static let defaultValue = true
}

/// The web's three.js balance (Resources/Scene, built by mobile/shared/scene)
/// in a web view, driven through `window.judgeScene`. Decorative: the
/// captions around it carry the meaning, and touches go to the page.
/// `fallback` is drawn instead when the page reports it cannot render.
struct SceneView<Fallback: View>: View {
    let mode: SceneMode
    @ViewBuilder var fallback: Fallback

    @Environment(\.sceneLive) private var live
    @Environment(\.scenePhase) private var scenePhase
    @State private var visible = false
    @State private var failed = false

    var body: some View {
        ZStack {
            Brand.paper
            if live && !failed {
                SceneWebView(mode: mode, active: visible && scenePhase == .active) { failed = true }
            } else {
                fallback
                    .padding(.horizontal, 32)
                    .padding(.vertical, 24)
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
        .onAppear { visible = true }
        .onDisappear { visible = false }
    }
}

extension SceneView where Fallback == BalanceCanvas {
    /// A still flat balance as the fallback, at the mode's tilt.
    init(mode: SceneMode) {
        self.mode = mode
        fallback = BalanceCanvas(angle: mode.fallbackAngle)
    }
}

private struct SceneWebView: UIViewRepresentable {
    let mode: SceneMode
    /// On screen with the app in front.
    let active: Bool
    let onFallback: () -> Void

    func makeCoordinator() -> SceneBridge { SceneBridge() }

    func makeUIView(context: Context) -> WKWebView {
        let bridge = context.coordinator
        let configuration = WKWebViewConfiguration()
        // The page posts "ready", "fallback" and "lost" from its first script.
        configuration.userContentController.add(bridge, name: SceneBridge.name)
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.isOpaque = false
        view.backgroundColor = UIColor(Brand.paper)
        view.scrollView.backgroundColor = UIColor(Brand.paper)
        view.scrollView.isScrollEnabled = false
        view.scrollView.bounces = false
        view.scrollView.minimumZoomScale = 1
        view.scrollView.maximumZoomScale = 1
        view.scrollView.contentInsetAdjustmentBehavior = .never
        view.allowsLinkPreview = false
        view.accessibilityElementsHidden = true
        view.navigationDelegate = bridge
        bridge.attach(view, mode: mode, onFallback: onFallback)
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {
        let bridge = context.coordinator
        bridge.onFallback = onFallback
        bridge.show(mode)
        bridge.setActive(active)
    }

    static func dismantleUIView(_ view: WKWebView, coordinator: SceneBridge) {
        view.stopLoading()
        view.navigationDelegate = nil
        view.configuration.userContentController.removeScriptMessageHandler(forName: SceneBridge.name)
    }
}

/// Loads the page, sends it the mode once it has finished loading (again
/// after every reload) and hears its events. WebKit declares both
/// protocols main-actor isolated.
@MainActor
final class SceneBridge: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
    static let name = "judgeScene"

    /// The bundled page. The Judge folder is a synchronized group, which
    /// copies resources flat into the bundle; a folder reference would keep
    /// Scene/, so both places are tried.
    static var pageURL: URL? {
        Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "Scene")
            ?? Bundle.main.url(forResource: "index", withExtension: "html")
    }

    private enum Page {
        case idle, loading, ready
    }

    var onFallback: () -> Void = {}
    private weak var webView: WKWebView?
    private var mode: SceneMode?
    private var page = Page.idle
    private var active = false
    /// WebGL dropped its context (usually in the background): the page shows
    /// its flat drawing until it is loaded again.
    private var lost = false

    func attach(_ view: WKWebView, mode: SceneMode, onFallback: @escaping () -> Void) {
        webView = view
        self.mode = mode
        self.onFallback = onFallback
    }

    func show(_ mode: SceneMode) {
        guard mode != self.mode else { return }
        self.mode = mode
        send()
    }

    /// Loads when the view comes on screen (and again after a lost context);
    /// a load still running when it goes away is stopped.
    func setActive(_ value: Bool) {
        guard value != active else { return }
        active = value
        if value {
            if page == .idle || lost { load() }
        } else if page == .loading {
            webView?.stopLoading()
            page = .idle
        }
    }

    private func load() {
        guard let webView else { return }
        guard let url = Self.pageURL else {
            // Called from a view update: report on the next turn.
            Task { [weak self] in self?.onFallback() }
            return
        }
        lost = false
        page = .loading
        webView.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
    }

    private func send() {
        guard page == .ready, let mode, let webView else { return }
        webView.evaluateJavaScript("window.judgeScene.setMode(\(mode.json))", completionHandler: nil)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        page = .ready
        if UIAccessibility.isReduceMotionEnabled {
            webView.evaluateJavaScript("window.judgeScene.setReduced(true)", completionHandler: nil)
        }
        send()
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: any Error) {
        guard (error as NSError).code != NSURLErrorCancelled else { return }
        page = .idle
        onFallback()
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        page = .idle
        lost = true
        if active { load() }
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        switch type {
        case "fallback":
            onFallback()
        case "lost":
            lost = true
        default:
            // "ready": the mode already went with the load.
            break
        }
    }
}
