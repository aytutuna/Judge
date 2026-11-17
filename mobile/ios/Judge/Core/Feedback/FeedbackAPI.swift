import Foundation

/// GET /api/v1/me/consent: whether the person lets Judge use their
/// anonymized verdicts and ratings to train AI.
enum ConsentState: String, Sendable, Equatable {
    case notAsked = "not_asked"
    case on
    case off
}

enum Rating: String, Sendable, Equatable {
    case up
    case down
}

/// GET /api/v1/me/consent. `ask` is the server's call on showing the card.
struct ConsentStatus: Sendable, Equatable {
    var state: ConsentState
    var ask: Bool
    var sensitiveAgreed: Bool
}

extension JudgeAPI {
    enum ConsentSource: String { case card, switchRow = "switch" }

    func consent() async throws -> ConsentStatus {
        let request = makeRequest(url: endpoint("me").appending(path: "consent"), method: "GET", timeout: Timeout.get)
        let data = try await send(request)
        let object = try? WireDecoding.topLevelObject(data)
        return ConsentStatus(
            state: try consentState(from: data),
            ask: object?["ask"] as? Bool ?? false,
            sensitiveAgreed: object?["sensitiveAgreed"] as? Bool ?? false
        )
    }

    /// POST /api/v1/me/agreement: the one-time private details tick.
    func agreeToSensitive(lang: AppLang) async throws {
        var request = makeRequest(url: endpoint("me").appending(path: "agreement"), method: "POST", timeout: Timeout.get)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["lang": lang.rawValue, "platform": "ios"])
        let data = try await send(request)
        guard (try? WireDecoding.topLevelObject(data))?["agreed"] as? Bool == true else { throw APIError.malformed }
    }

    /// GET /api/v1/me/export, saved as a .json file in the temporary folder.
    func exportData() async throws -> URL {
        let request = makeRequest(url: endpoint("me").appending(path: "export"), method: "GET", timeout: 60)
        let (data, response) = try await exchange(request)
        let disposition = response.value(forHTTPHeaderField: "Content-Disposition") ?? ""
        var name = "judge-data.json"
        if let found = disposition.firstMatch(of: /filename="([\w.-]+)"/) { name = String(found.1) }
        let folder = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let file = folder.appending(path: name)
        try data.write(to: file)
        return file
    }

    func setConsent(on: Bool, source: ConsentSource, wordingKey: String, lang: AppLang) async throws -> ConsentState {
        var request = makeRequest(url: endpoint("me").appending(path: "consent"), method: "POST", timeout: Timeout.get)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "choice": on ? "on" : "off",
            "source": source.rawValue,
            "wordingKey": wordingKey,
            "lang": lang.rawValue,
            "platform": "ios",
        ])
        return try consentState(from: try await send(request))
    }

    /// The signed-in viewer's own rating of a verdict.
    func rating(id: String) async throws -> Rating? {
        let request = makeRequest(url: endpoint("verdicts").appending(component: id), method: "GET", timeout: Timeout.get)
        let object = try? WireDecoding.topLevelObject(try await send(request))
        return (object?["rating"] as? String).flatMap(Rating.init)
    }

    /// Nil clears the rating.
    func setRating(id: String, _ rating: Rating?) async throws {
        let url = endpoint("verdicts").appending(component: id).appending(path: "rating")
        var request = makeRequest(url: url, method: "PUT", timeout: Timeout.get)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let value: Any = rating.map { $0.rawValue as Any } ?? NSNull()
        request.httpBody = try JSONSerialization.data(withJSONObject: ["rating": value])
        _ = try await send(request)
    }

    private func consentState(from data: Data) throws -> ConsentState {
        guard let object = try? WireDecoding.topLevelObject(data),
              let state = (object["state"] as? String).flatMap(ConsentState.init)
        else { throw APIError.malformed }
        return state
    }
}
