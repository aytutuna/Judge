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
/// captions around it carry the meaning, and touches go to the page. With
/// `play` a touch that starts on a ball plays with it and the enclosing scroll
/// view holds still until the ball is let go; any other touch scrolls as usual.
/// `fallback` is drawn instead when the page reports it cannot render. The
/// viewer's side is drawn green (`\.sides`), and the page takes the light or
/// dark look from the colour scheme.
struct SceneView<Fallback: View>: View {
    let mode: SceneMode
    var play = false
    @ViewBuilder var fallback: Fallback

    @Environment(\.sceneLive) private var live
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.tabShown) private var tabShown
    @Environment(\.sides) private var sides
    @Environment(\.colorScheme) private var colorScheme
    @State private var visible = false
    @State private var failed = false

    var body: some View {
        ZStack {
            Brand.paper
            if live && !failed {
                SceneWebView(mode: mode, play: play, you: sides.you == .b ? .b : .a, dark: colorScheme == .dark, active: visible && scenePhase == .active && tabShown) {
                    failed = true
                }
            } else {
                fallback
                    .padding(.horizontal, 32)
                    .padding(.vertical, 24)
            }
        }
        .allowsHitTesting(play)
        .accessibilityHidden(true)
        .onAppear { visible = true }
        .onDisappear { visible = false }
    }
}

extension SceneView where Fallback == BalanceCanvas {
    /// A still flat balance as the fallback, at the mode's tilt.
    init(mode: SceneMode, play: Bool = false) {
        self.mode = mode
        self.play = play
        fallback = BalanceCanvas(angle: mode.fallbackAngle)
    }
}

private struct SceneWebView: UIViewRepresentable {
    let mode: SceneMode
    let play: Bool
    let you: Party
    let dark: Bool
    /// On screen with the app in front.
    let active: Bool
    let onFallback: () -> Void

    func makeCoordinator() -> SceneBridge { SceneBridge() }

    func makeUIView(context: Context) -> WKWebView {
        let bridge = context.coordinator
        let configuration = WKWebViewConfiguration()
        // The page posts "ready", "fallback" and "lost" from its first script.
        configuration.userContentController.add(bridge, name: SceneBridge.name)
        let view = PlayWebView(frame: .zero, configuration: configuration)
        view.plays = play
        // Clear, so the paper behind shows until the page paints, in either
        // appearance.
        view.isOpaque = false
        view.backgroundColor = .clear
        view.scrollView.backgroundColor = .clear
        view.scrollView.isScrollEnabled = false
        view.scrollView.bounces = false
        view.scrollView.minimumZoomScale = 1
        view.scrollView.maximumZoomScale = 1
        view.scrollView.contentInsetAdjustmentBehavior = .never
        view.allowsLinkPreview = false
        view.accessibilityElementsHidden = true
        view.navigationDelegate = bridge
        bridge.attach(view, mode: mode, play: play, you: you, dark: dark, onFallback: onFallback)
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {
        let bridge = context.coordinator
        bridge.onFallback = onFallback
        bridge.show(mode, play: play, you: you, dark: dark)
        bridge.setActive(active)
    }

    static func dismantleUIView(_ view: WKWebView, coordinator: SceneBridge) {
        (view as? PlayWebView)?.delayAgain()
        coordinator.letGo()
        view.stopLoading()
        view.navigationDelegate = nil
        view.configuration.userContentController.removeScriptMessageHandler(forName: SceneBridge.name)
    }
}

/// A touch that lands on the page reaches it at once instead of after the
/// scroll view's delay, so a quick throw is not taken for the start of a
/// scroll. The delay comes back shortly after, so the page's other buttons
/// keep it.
private final class PlayWebView: WKWebView {
    var plays = false
    private weak var relaxed: UIScrollView?
    private var restore: DispatchWorkItem?

    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        let hit = super.hitTest(point, with: event)
        if plays, hit != nil, event?.type == .touches, let scroll = enclosingScrollView {
            if relaxed == nil {
                relaxed = scroll
                scroll.delaysContentTouches = false
            }
            restore?.cancel()
            let work = DispatchWorkItem { [weak self] in self?.delayAgain() }
            restore = work
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.6, execute: work)
        }
        return hit
    }

    func delayAgain() {
        restore?.cancel()
        relaxed?.delaysContentTouches = true
        relaxed = nil
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        if window == nil { delayAgain() }
    }
}

extension UIView {
    /// The nearest scroll view above this view (not this view's own).
    var enclosingScrollView: UIScrollView? {
        var up = superview
        while let view = up, !(view is UIScrollView) { up = view.superview }
        return up as? UIScrollView
    }
}

/// Loads the page, sends it the theme and mode once it has finished loading
/// (again after every reload) and hears its events. WebKit declares both
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
    private var play = false
    /// The scroll view whose pan is off while the page holds a ball.
    private weak var held: UIScrollView?
    private var you = Party.a
    private var dark = false
    private var page = Page.idle
    private var active = false
    /// WebGL dropped its context (usually in the background): the page shows
    /// its flat drawing until it is loaded again.
    private var lost = false

    func attach(_ view: WKWebView, mode: SceneMode, play: Bool, you: Party, dark: Bool, onFallback: @escaping () -> Void) {
        webView = view
        self.mode = mode
        self.play = play
        self.you = you
        self.dark = dark
        self.onFallback = onFallback
    }

    func show(_ mode: SceneMode, play: Bool, you: Party, dark: Bool) {
        guard mode != self.mode || play != self.play || you != self.you || dark != self.dark else { return }
        self.mode = mode
        self.play = play
        self.you = you
        self.dark = dark
        send()
    }

    /// Loads when the view comes on screen (and again after a lost context);
    /// a load still running when it goes away is stopped.
    func setActive(_ value: Bool) {
        guard value != active else { return }
        active = value
        if value {
            if page == .idle || lost { load() }
        } else {
            letGo()
            if page == .loading {
                webView?.stopLoading()
                page = .idle
            }
        }
    }

    /// Gives the enclosing scroll view its pan back.
    func letGo() {
        held?.panGestureRecognizer.isEnabled = true
        held = nil
    }

    private func hold() {
        guard held == nil, let scroll = webView?.enclosingScrollView else { return }
        held = scroll
        // Switching a pan off mid-touch cancels it, so the drag stays with the ball.
        scroll.panGestureRecognizer.isEnabled = false
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
        let theme = dark ? "dark" : "light"
        webView.evaluateJavaScript("window.judgeScene.setTheme(\"\(theme)\")", completionHandler: nil)
        webView.evaluateJavaScript("window.judgeScene.setYou(\"\(you.rawValue)\")", completionHandler: nil)
        webView.evaluateJavaScript("window.judgeScene.setPlay(\(play))", completionHandler: nil)
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
        failed(error)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: any Error) {
        failed(error)
    }

    private func failed(_ error: any Error) {
        guard (error as NSError).code != NSURLErrorCancelled else { return }
        page = .idle
        onFallback()
    }

    /// Usually memory pressure, which a reload would only repeat, so the flat
    /// balance takes over for good.
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        page = .idle
        onFallback()
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        switch type {
        case "fallback":
            onFallback()
        case "lost":
            lost = true
            letGo()
        case "grab":
            hold()
        case "release":
            letGo()
        default:
            // "ready": the mode already went with the load.
            break
        }
    }
}
