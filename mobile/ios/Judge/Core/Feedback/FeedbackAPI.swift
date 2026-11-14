import Foundation

/// GET /api/v1/me/consent: whether the person lets Judge use their
/// anonymized verdicts to test and train its judges.
enum ConsentState: String, Sendable, Equatable {
    case notAsked = "not_asked"
    case on
    case off
}

enum Rating: String, Sendable, Equatable {
    case up
    case down
}

extension JudgeAPI {
    enum ConsentSource: String { case card, switchRow = "switch" }

    func consent() async throws -> ConsentState {
        let request = makeRequest(url: endpoint("me").appending(path: "consent"), method: "GET", timeout: Timeout.get)
        return try consentState(from: try await send(request))
    }

    func setConsent(on: Bool, source: ConsentSource, wordingKey: String) async throws -> ConsentState {
        var request = makeRequest(url: endpoint("me").appending(path: "consent"), method: "POST", timeout: Timeout.get)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "choice": on ? "on" : "off",
            "source": source.rawValue,
            "wordingKey": wordingKey,
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
