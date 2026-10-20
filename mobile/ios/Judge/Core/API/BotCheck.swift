import Foundation
import Observation
import WebKit

/// Produces a fresh single-use bot-check token just before each free verdict.
@MainActor
protocol BotCheck: AnyObject, Sendable {
    /// A token, or nil when no check is configured. Throws when the check fails.
    func token() async throws -> String?
}

enum BotCheckError: Error, Equatable {
    case failed
    case timedOut
    case dismissed
}

/// No site key configured (local or dev servers without a Turnstile secret).
@MainActor
final class NoBotCheck: BotCheck {
    func token() async throws -> String? { nil }
}

/// Invisible Cloudflare Turnstile in a WKWebView whose base URL is the
/// website's origin, so the widget hostname matches the site key's allowed
/// domain and the server verifies the token exactly as for the website.
/// When Cloudflare wants an interaction, `needsInteraction` turns on and the
/// root view shows the web view in a sheet.
@MainActor
@Observable
final class TurnstileBotCheck: BotCheck {
    /// Drives the sheet that hosts `webView` when the widget needs a tap.
    var needsInteraction = false

    let webView: WKWebView
    private let bridge: TurnstileBridge
    private let siteKey: String
    private let origin: URL
    @ObservationIgnored private var pending: CheckedContinuation<String?, any Error>?
    @ObservationIgnored private var timeout: Task<Void, Never>?

    /// How long an invisible check may take before it counts as failed.
    static let invisibleTimeout: Duration = .seconds(25)
    /// How long the user has to finish an interactive check.
    static let interactiveTimeout: Duration = .seconds(180)

    init(siteKey: String, origin: URL) {
        self.siteKey = siteKey
        self.origin = origin
        let bridge = TurnstileBridge()
        let configuration = WKWebViewConfiguration()
        configuration.userContentController.add(bridge, name: TurnstileBridge.name)
        let view = WKWebView(frame: CGRect(x: 0, y: 0, width: 340, height: 140), configuration: configuration)
        view.isOpaque = false
        view.backgroundColor = .clear
        view.scrollView.isScrollEnabled = false
        self.bridge = bridge
        self.webView = view
        bridge.onMessage = { [weak self] message in self?.handle(message) }
    }

    func token() async throws -> String? {
        finish(.failure(BotCheckError.failed))
        return try await withCheckedThrowingContinuation { continuation in
            pending = continuation
            arm(Self.invisibleTimeout)
            webView.loadHTMLString(Self.page(siteKey: siteKey), baseURL: origin.appending(path: "/"))
        }
    }

    /// The user closed the interactive sheet.
    func dismissInteraction() {
        needsInteraction = false
        finish(.failure(BotCheckError.dismissed))
    }

    private func handle(_ message: TurnstileBridge.Message) {
        switch message {
        case .token(let token):
            finish(.success(token))
        case .interactive:
            needsInteraction = true
            arm(Self.interactiveTimeout)
        case .error, .expired:
            finish(.failure(BotCheckError.failed))
        }
    }

    private func arm(_ duration: Duration) {
        timeout?.cancel()
        timeout = Task { [weak self] in
            try? await Task.sleep(for: duration)
            guard !Task.isCancelled else { return }
            self?.finish(.failure(BotCheckError.timedOut))
        }
    }

    private func finish(_ outcome: Result<String?, any Error>) {
        timeout?.cancel()
        timeout = nil
        needsInteraction = false
        guard let continuation = pending else { return }
        pending = nil
        continuation.resume(with: outcome)
        webView.stopLoading()
    }

    /// The widget page. Turnstile calls `ready` once api.js has loaded.
    static func page(siteKey: String) -> String {
        let key = (try? JSONEncoder().encode(siteKey)).map { String(decoding: $0, as: UTF8.self) } ?? "\"\""
        return """
        <!doctype html>
        <html><head>
        <meta name="viewport" content="width=device-width,initial-scale=1">
        <style>html,body{margin:0;background:transparent;display:flex;justify-content:center;align-items:center;min-height:100%}</style>
        <script>
        function send(m){try{window.webkit.messageHandlers.\(TurnstileBridge.name).postMessage(m)}catch(e){}}
        function ready(){
          try{
            turnstile.render('#w',{
              sitekey:\(key),
              appearance:'interaction-only',
              callback:function(t){send({type:'token',token:t})},
              'error-callback':function(){send({type:'error'})},
              'expired-callback':function(){send({type:'expired'})},
              'before-interactive-callback':function(){send({type:'interactive'})}
            });
          }catch(e){send({type:'error'})}
        }
        </script>
        <script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=ready" async defer onerror="send({type:'error'})"></script>
        </head><body><div id="w"></div></body></html>
        """
    }
}

/// Receives the widget's messages. WebKit declares WKScriptMessageHandler
/// main-actor isolated, so the conformance needs no annotation.
@MainActor
final class TurnstileBridge: NSObject, WKScriptMessageHandler {
    static let name = "judgeTurnstile"

    enum Message: Sendable, Equatable {
        case token(String)
        case interactive
        case error
        case expired
    }

    var onMessage: ((Message) -> Void)?

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        switch type {
        case "token":
            if let token = body["token"] as? String, !token.isEmpty {
                onMessage?(.token(token))
            } else {
                onMessage?(.error)
            }
        case "interactive": onMessage?(.interactive)
        case "expired": onMessage?(.expired)
        default: onMessage?(.error)
        }
    }
}
