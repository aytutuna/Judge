import Foundation

/// Account calls: `/api/v1/config`, `/api/v1/me` and the Better Auth
/// endpoints under `/api/auth`. Better Auth error bodies are
/// `{ message, code }`; `APIError.code` carries their code
/// (`INVALID_OTP`, `OTP_EXPIRED`, `TOO_MANY_ATTEMPTS`, ...).
extension JudgeAPI {
    enum AuthTimeout {
        static let call: TimeInterval = 20
    }

    func authEndpoint(_ path: String) -> URL {
        baseURL.appending(path: "api/auth").appending(path: path)
    }

    /// GET /api/v1/config.
    func serverConfig() async throws -> ServerConfig {
        let request = makeRequest(url: endpoint("config"), method: "GET", timeout: AuthTimeout.call)
        let data = try await send(request)
        do {
            return try JSONDecoder().decode(ServerConfig.self, from: data)
        } catch {
            throw APIError.malformed
        }
    }

    /// GET /api/v1/me. An unknown or expired token answers 200 with nulls.
    func me() async throws -> AccountInfo {
        let request = makeRequest(url: endpoint("me"), method: "GET", timeout: AuthTimeout.call)
        let data = try await send(request)
        do {
            return try JSONDecoder().decode(AccountInfo.self, from: data)
        } catch {
            throw APIError.malformed
        }
    }

    /// POST /api/auth/sign-in/social with a provider ID token (native flow).
    func signInWithIDToken(provider: SocialProvider, idToken: String, nonce: String? = nil, apple: AppleIdentity? = nil) async throws -> AuthSession {
        var token: [String: Any] = ["token": idToken]
        if let nonce { token["nonce"] = nonce }
        if let apple {
            var user: [String: Any] = [:]
            var name: [String: String] = [:]
            if let first = apple.firstName, !first.isEmpty { name["firstName"] = first }
            if let last = apple.lastName, !last.isEmpty { name["lastName"] = last }
            if !name.isEmpty { user["name"] = name }
            if let email = apple.email, !email.isEmpty { user["email"] = email }
            if !user.isEmpty { token["user"] = user }
        }
        return try await authPost("sign-in/social", body: ["provider": provider.rawValue, "idToken": token])
    }

    /// POST /api/v1/auth/apple/code: hands the server Apple's one-time
    /// authorization code under the new session's token. Sent on the raw
    /// session so an answer never clears the token; callers ignore failures.
    func storeAppleAuthorizationCode(_ code: String, token: String) async throws {
        var request = makeRequest(url: endpoint("auth/apple/code"), method: "POST", timeout: AuthTimeout.call)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["code": code])
        _ = try await session.data(for: request)
    }

    /// POST /api/auth/email-otp/send-verification-otp?lang=… : emails a
    /// six-digit sign-in code in the app's language.
    func sendSignInCode(email: String, lang: AppLang) async throws {
        let url = authEndpoint("email-otp/send-verification-otp")
            .appending(queryItems: [URLQueryItem(name: "lang", value: lang.rawValue)])
        var request = makeRequest(url: url, method: "POST", timeout: AuthTimeout.call)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["email": email, "type": "sign-in"])
        _ = try await send(request)
    }

    /// POST /api/auth/sign-in/email-otp.
    func signInWithCode(email: String, code: String) async throws -> AuthSession {
        try await authPost("sign-in/email-otp", body: ["email": email, "otp": code])
    }

    /// POST /api/auth/sign-out: ends the session on the server.
    func signOut() async throws {
        var request = makeRequest(url: authEndpoint("sign-out"), method: "POST", timeout: AuthTimeout.call)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = Data("{}".utf8)
        _ = try await send(request)
    }

    /// DELETE /api/v1/me { confirm: "delete" }.
    func deleteAccount() async throws {
        var request = makeRequest(url: endpoint("me"), method: "DELETE", timeout: AuthTimeout.call)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["confirm": "delete"])
        let data = try await send(request)
        let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        guard object?["deleted"] as? Bool == true else { throw APIError.malformed }
    }

    /// A sign-in POST answered `{ token, user }`. The `set-auth-token`
    /// header (the signed form of the same token) is the fallback.
    private func authPost(_ path: String, body: [String: Any]) async throws -> AuthSession {
        var request = makeRequest(url: authEndpoint(path), method: "POST", timeout: AuthTimeout.call)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, response) = try await exchange(request)
        return try Self.session(from: data, header: response.value(forHTTPHeaderField: "set-auth-token"))
    }

    static func session(from data: Data, header: String?) throws -> AuthSession {
        struct Body: Decodable {
            var token: String?
            var user: Viewer?

            private enum CodingKeys: String, CodingKey { case token, user }

            init(from decoder: any Decoder) throws {
                let c = try decoder.container(keyedBy: CodingKeys.self)
                token = try? c.decodeIfPresent(String.self, forKey: .token)
                user = try? c.decodeIfPresent(Viewer.self, forKey: .user)
            }
        }
        let body = try? JSONDecoder().decode(Body.self, from: data)
        let token = body?.token?.trimmingCharacters(in: .whitespacesAndNewlines)
        let fallback = header?.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let value = [token, fallback].compactMap({ $0 }).first(where: { !$0.isEmpty }) else {
            throw APIError.malformed
        }
        return AuthSession(token: value, user: body?.user)
    }
}
