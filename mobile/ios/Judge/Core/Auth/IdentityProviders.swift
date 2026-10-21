import AuthenticationServices
import CryptoKit
import Foundation
import os
import UIKit

/// Why a provider sheet ended without an identity. `cancelled` is the
/// user closing it and is never shown.
enum IdentityProviderError: Error, Sendable, Equatable {
    case cancelled
    case failed
    /// The provider answered, but its token exchange failed.
    case network(APIError)
}

/// Sign in with Apple: the system sheet, ending in an identity token.
@MainActor
protocol AppleAuthorizing: AnyObject {
    func authorize() async throws -> AppleIdentity
}

/// Google: an OAuth sign-in in a web authentication sheet, ending in an ID
/// token carrying the request's nonce.
@MainActor
protocol GoogleAuthorizing: AnyObject {
    func authorize() async throws -> GoogleIdentity
}

/// Random strings and hashes for nonces, PKCE and OAuth state.
enum AuthCrypto {
    static func randomString(byteCount: Int = 32) -> String {
        var bytes = [UInt8](repeating: 0, count: byteCount)
        if SecRandomCopyBytes(kSecRandomDefault, byteCount, &bytes) != errSecSuccess {
            var generator = SystemRandomNumberGenerator()
            bytes = (0..<byteCount).map { _ in UInt8.random(in: .min ... .max, using: &generator) }
        }
        return base64URL(Data(bytes))
    }

    /// Lowercase hex SHA-256: what Apple's request carries as the nonce
    /// (the server hashes the raw nonce the same way to compare).
    static func sha256Hex(_ text: String) -> String {
        SHA256.hash(data: Data(text.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    /// RFC 7636 S256 code challenge.
    static func codeChallenge(for verifier: String) -> String {
        base64URL(Data(SHA256.hash(data: Data(verifier.utf8))))
    }

    static func base64URL(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}

/// The key window, for presenting the system sign-in sheets.
@MainActor
enum PresentationAnchor {
    static func current() -> ASPresentationAnchor {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        if let window = scenes.flatMap(\.windows).first(where: \.isKeyWindow) ?? scenes.first?.windows.first {
            return window
        }
        if let scene = scenes.first { return UIWindow(windowScene: scene) }
        return ASPresentationAnchor()
    }
}

/// Sign in with Apple through ASAuthorizationController, asking for name
/// and email, with a SHA-256 hashed nonce.
@MainActor
final class AppleAuthorizer: NSObject, AppleAuthorizing {
    private var controller: ASAuthorizationController?
    private var pending: CheckedContinuation<AppleIdentity, any Error>?
    private var rawNonce = ""

    func authorize() async throws -> AppleIdentity {
        finish(.failure(IdentityProviderError.cancelled))
        let nonce = AuthCrypto.randomString()
        rawNonce = nonce
        let request = ASAuthorizationAppleIDProvider().createRequest()
        request.requestedScopes = [.fullName, .email]
        request.nonce = AuthCrypto.sha256Hex(nonce)
        let controller = ASAuthorizationController(authorizationRequests: [request])
        controller.delegate = self
        controller.presentationContextProvider = self
        self.controller = controller
        return try await withCheckedThrowingContinuation { continuation in
            pending = continuation
            controller.performRequests()
        }
    }

    fileprivate func finish(_ outcome: Result<AppleIdentity, any Error>) {
        controller = nil
        guard let continuation = pending else { return }
        pending = nil
        continuation.resume(with: outcome)
    }

    fileprivate func complete(token: String?, firstName: String?, lastName: String?, email: String?) {
        guard let token, !token.isEmpty else {
            finish(.failure(IdentityProviderError.failed))
            return
        }
        finish(.success(AppleIdentity(identityToken: token, rawNonce: rawNonce, firstName: firstName, lastName: lastName, email: email)))
    }
}

extension AppleAuthorizer: ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
    nonisolated func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        let credential = authorization.credential as? ASAuthorizationAppleIDCredential
        let token = credential?.identityToken.flatMap { String(data: $0, encoding: .utf8) }
        let first = credential?.fullName?.givenName
        let last = credential?.fullName?.familyName
        let email = credential?.email
        MainActor.assumeIsolated {
            self.complete(token: token, firstName: first, lastName: last, email: email)
        }
    }

    nonisolated func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: any Error) {
        let cancelled = (error as? ASAuthorizationError)?.code == .canceled
        MainActor.assumeIsolated {
            self.finish(.failure(cancelled ? IdentityProviderError.cancelled : IdentityProviderError.failed))
        }
    }

    nonisolated func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        MainActor.assumeIsolated { PresentationAnchor.current() }
    }
}

/// The Google iOS OAuth client (no secret: an installed-app client).
enum GoogleOAuthClient {
    static let clientID = "173777773521-rh4lbrotjdeufmq3rd50r924b7nn0l1r.apps.googleusercontent.com"
    /// The reversed client id, registered in Info.plist CFBundleURLTypes.
    static let scheme = "com.googleusercontent.apps.173777773521-rh4lbrotjdeufmq3rd50r924b7nn0l1r"
    static let redirectURI = "\(scheme):/oauth2redirect"
    static let scope = "openid email profile"
    static let authorizeURL = URL(string: "https://accounts.google.com/o/oauth2/v2/auth")
    static let tokenURL = URL(string: "https://oauth2.googleapis.com/token")

    /// The authorization request for one sign-in (code flow with PKCE).
    static func authorizationURL(state: String, nonce: String, codeChallenge: String) -> URL? {
        guard let base = authorizeURL else { return nil }
        return base.appending(queryItems: [
            URLQueryItem(name: "client_id", value: clientID),
            URLQueryItem(name: "redirect_uri", value: redirectURI),
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "scope", value: scope),
            URLQueryItem(name: "state", value: state),
            URLQueryItem(name: "nonce", value: nonce),
            URLQueryItem(name: "code_challenge", value: codeChallenge),
            URLQueryItem(name: "code_challenge_method", value: "S256"),
            URLQueryItem(name: "prompt", value: "select_account"),
        ])
    }

    /// The authorization code from the redirect, after checking `state`.
    static func code(fromCallback url: URL, state: String) throws -> String {
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        func value(_ name: String) -> String? { items.first(where: { $0.name == name })?.value }
        if let error = value("error") {
            throw error == "access_denied" ? IdentityProviderError.cancelled : IdentityProviderError.failed
        }
        guard value("state") == state, let code = value("code"), !code.isEmpty else {
            throw IdentityProviderError.failed
        }
        return code
    }

    /// Trades the code for tokens at Google's token endpoint and returns the ID token.
    static func exchange(code: String, verifier: String, session: URLSession) async throws -> String {
        guard let tokenURL else { throw IdentityProviderError.failed }
        var request = URLRequest(url: tokenURL, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 20)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        var form = URLComponents()
        form.queryItems = [
            URLQueryItem(name: "grant_type", value: "authorization_code"),
            URLQueryItem(name: "code", value: code),
            URLQueryItem(name: "client_id", value: clientID),
            URLQueryItem(name: "redirect_uri", value: redirectURI),
            URLQueryItem(name: "code_verifier", value: verifier),
        ]
        // URLComponents leaves "+" alone; in a form body it would read as a space.
        let body = (form.percentEncodedQuery ?? "").replacingOccurrences(of: "+", with: "%2B")
        request.httpBody = Data(body.utf8)
        let received: (Data, URLResponse)
        do {
            received = try await session.data(for: request)
        } catch {
            if APIError.isCancellation(error) { throw CancellationError() }
            throw IdentityProviderError.network(APIError.from(transport: error))
        }
        guard let http = received.1 as? HTTPURLResponse, (200..<300).contains(http.statusCode),
              let object = try? JSONSerialization.jsonObject(with: received.0) as? [String: Any],
              let idToken = object["id_token"] as? String, !idToken.isEmpty
        else { throw IdentityProviderError.failed }
        return idToken
    }
}

/// Google sign-in without an SDK: ASWebAuthenticationSession against
/// accounts.google.com, then the code exchange.
@MainActor
final class GoogleOAuth: NSObject, GoogleAuthorizing {
    private var session: ASWebAuthenticationSession?
    private let urlSession: URLSession

    init(urlSession: URLSession = JudgeAPI.makeSession()) {
        self.urlSession = urlSession
    }

    func authorize() async throws -> GoogleIdentity {
        session?.cancel()
        let verifier = AuthCrypto.randomString(byteCount: 48)
        let state = AuthCrypto.randomString(byteCount: 16)
        let nonce = AuthCrypto.randomString()
        guard let url = GoogleOAuthClient.authorizationURL(state: state, nonce: nonce, codeChallenge: AuthCrypto.codeChallenge(for: verifier)) else {
            throw IdentityProviderError.failed
        }
        let callback: URL = try await withCheckedThrowingContinuation { continuation in
            let once = ResumeOnce(continuation)
            let completion: @Sendable (URL?, (any Error)?) -> Void = { url, error in
                if let url {
                    once.resume(.success(url))
                } else if let error = error as? ASWebAuthenticationSessionError, error.code == .canceledLogin {
                    once.resume(.failure(IdentityProviderError.cancelled))
                } else {
                    once.resume(.failure(IdentityProviderError.failed))
                }
            }
            let session: ASWebAuthenticationSession
            if #available(iOS 17.4, *) {
                session = ASWebAuthenticationSession(url: url, callback: .customScheme(GoogleOAuthClient.scheme), completionHandler: completion)
            } else {
                session = ASWebAuthenticationSession(url: url, callbackURLScheme: GoogleOAuthClient.scheme, completionHandler: completion)
            }
            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = false
            self.session = session
            if !session.start() {
                self.session = nil
                once.resume(.failure(IdentityProviderError.failed))
            }
        }
        session = nil
        let code = try GoogleOAuthClient.code(fromCallback: callback, state: state)
        let idToken = try await GoogleOAuthClient.exchange(code: code, verifier: verifier, session: urlSession)
        return GoogleIdentity(idToken: idToken, rawNonce: nonce)
    }
}

extension GoogleOAuth: ASWebAuthenticationPresentationContextProviding {
    nonisolated func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        MainActor.assumeIsolated { PresentationAnchor.current() }
    }
}

/// Resumes a continuation at most once, whichever callback comes first.
final class ResumeOnce<Value: Sendable>: Sendable {
    private let continuation: OSAllocatedUnfairLock<CheckedContinuation<Value, any Error>?>

    init(_ continuation: CheckedContinuation<Value, any Error>) {
        self.continuation = OSAllocatedUnfairLock(initialState: continuation)
    }

    func resume(_ outcome: Result<Value, any Error>) {
        let pending = continuation.withLock { state in
            let current = state
            state = nil
            return current
        }
        pending?.resume(with: outcome)
    }
}
