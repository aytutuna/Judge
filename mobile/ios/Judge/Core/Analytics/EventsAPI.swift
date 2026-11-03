import Foundation

extension JudgeAPI: AnalyticsTransport {
    /// POST /api/v1/events with a ready `{ context, events }` body, with the
    /// bearer token when signed in. Sent on the raw session: a dead token
    /// here is left for the account's own calls to notice.
    func sendEvents(_ body: Data) async -> AnalyticsDelivery {
        var request = makeRequest(url: endpoint("events"), method: "POST", timeout: AuthTimeout.call)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = body
        guard let received = try? await session.data(for: request), let http = received.1 as? HTTPURLResponse else {
            return .failed
        }
        if (200..<300).contains(http.statusCode) { return .sent }
        return http.statusCode == 400 || http.statusCode == 413 ? .rejected : .failed
    }
}
