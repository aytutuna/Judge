import SwiftUI
import UIKit
import WebKit

/// The street court (Resources/Court, built by mobile/shared/scene) in a web
/// view, driven through `window.judgeCourt`. Decorative: the log around it
/// carries the meaning, and touches never reach the page. The still ground
/// is drawn instead in screenshot states and tests, when the page fails, and
/// until the page has painted its first frame. `covered` pauses it (the page
/// is removed) while something is over the screen.
struct CourtView: View {
    let scene: CourtScene
    var covered = false

    @Environment(\.sceneLive) private var live
    @Environment(\.tabShown) private var tabShown
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var ready = false
    @State private var failed = false

    private var running: Bool { live && !failed && tabShown && !covered }

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: Radius.field, style: .continuous)
        ZStack {
            Image("CourtGround")
                .resizable()
                .interpolation(.none)
            if running {
                CourtWebView(scene: scene, reduced: reduceMotion, onReady: { ready = true }, onFailed: { failed = true })
                    .opacity(ready ? 1 : 0)
                    .animation(.easeOut(duration: 0.25), value: ready)
            }
        }
        .aspectRatio(16.0 / 9.0, contentMode: .fit)
        .clipShape(shape)
        .overlay(shape.strokeBorder(Brand.line, lineWidth: 1))
        .allowsHitTesting(false)
        .accessibilityHidden(true)
        .onChange(of: running) { _, isRunning in
            if !isRunning { ready = false }
        }
    }
}

/// The New page's court in the room the form leaves, and nothing at all
/// when that is too little to see. It grows with the screen up to 1100pt wide.
struct HomeCourt: View {
    let busy: Bool
    let covered: Bool

    static let minHeight: CGFloat = 110
    private static let maxWidth: CGFloat = 1100

    var body: some View {
        GeometryReader { geo in
            if geo.size.height >= Self.minHeight {
                CourtView(scene: .home(busy: busy), covered: covered)
                    .frame(maxWidth: min(geo.size.width, Self.maxWidth), maxHeight: .infinity)
                    .frame(width: geo.size.width, height: geo.size.height)
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

private struct CourtWebView: UIViewRepresentable {
    let scene: CourtScene
    let reduced: Bool
    let onReady: () -> Void
    let onFailed: () -> Void

    func makeCoordinator() -> CourtBridge { CourtBridge() }

    func makeUIView(context: Context) -> WKWebView {
        let bridge = context.coordinator
        let configuration = WKWebViewConfiguration()
        // The page posts "ready" once its art is drawn.
        configuration.userContentController.add(bridge, name: CourtBridge.name)
        let view = WKWebView(frame: .zero, configuration: configuration)
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
        bridge.attach(view, scene: scene, reduced: reduced, onReady: onReady, onFailed: onFailed)
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {
        let bridge = context.coordinator
        bridge.onReady = onReady
        bridge.onFailed = onFailed
        bridge.show(scene, reduced: reduced)
    }

    static func dismantleUIView(_ view: WKWebView, coordinator: CourtBridge) {
        view.stopLoading()
        view.navigationDelegate = nil
        view.configuration.userContentController.removeScriptMessageHandler(forName: CourtBridge.name)
    }
}

/// Loads the page, sends it the scene and the motion setting once it has
/// finished loading (the page holds an early scene until its art is in) and
/// hears "ready" back. WebKit declares both protocols main-actor isolated.
@MainActor
final class CourtBridge: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
    static let name = "judgeCourt"

    /// The bundled page. The Judge folder is a synchronized group, which
    /// copies resources flat into the bundle; a folder reference would keep
    /// Court/, so both places are tried.
    static var pageURL: URL? {
        Bundle.main.url(forResource: "court", withExtension: "html", subdirectory: "Court")
            ?? Bundle.main.url(forResource: "court", withExtension: "html")
    }

    var onReady: () -> Void = {}
    var onFailed: () -> Void = {}
    private weak var webView: WKWebView?
    private var scene: CourtScene?
    private var reduced = false
    private var loaded = false

    func attach(_ view: WKWebView, scene: CourtScene, reduced: Bool, onReady: @escaping () -> Void, onFailed: @escaping () -> Void) {
        webView = view
        self.scene = scene
        self.reduced = reduced
        self.onReady = onReady
        self.onFailed = onFailed
        guard let url = Self.pageURL else {
            // Called from a view update: report on the next turn.
            Task { [weak self] in self?.onFailed() }
            return
        }
        view.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
    }

    func show(_ scene: CourtScene, reduced: Bool) {
        guard scene != self.scene || reduced != self.reduced else { return }
        let motionChanged = reduced != self.reduced
        self.scene = scene
        self.reduced = reduced
        send(motion: motionChanged)
    }

    private func send(motion: Bool) {
        guard loaded, let scene, let webView else { return }
        if motion {
            webView.evaluateJavaScript("window.judgeCourt.setReduced(\(reduced))", completionHandler: nil)
        }
        webView.evaluateJavaScript("window.judgeCourt.set(\(scene.json))", completionHandler: nil)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        loaded = true
        webView.evaluateJavaScript("window.judgeCourt.setReduced(\(reduced))", completionHandler: nil)
        send(motion: false)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: any Error) {
        failed(error)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: any Error) {
        failed(error)
    }

    private func failed(_ error: any Error) {
        guard (error as NSError).code != NSURLErrorCancelled else { return }
        onFailed()
    }

    /// Usually memory pressure, which a reload would only repeat, so the
    /// still ground takes over for good.
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        onFailed()
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], body["type"] as? String == "ready" else { return }
        onReady()
    }
}
