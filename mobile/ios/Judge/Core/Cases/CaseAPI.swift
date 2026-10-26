import Foundation

/// Two-sided case calls for the case owner (lib/cases/http.ts). Every one
/// needs a signed-in account; creating a case and adding context carry an
/// Idempotency-Key, like premium verdicts. A case is free or premium; only a
/// premium one spends a credit and may carry evidence.
extension JudgeAPI {
    enum CaseTimeout {
        /// The owner's side is anonymized inside the request (route limit 150 s).
        static let create: TimeInterval = 150
        /// Anonymizing the added context happens in the request too.
        static let appeal: TimeInterval = 150
        /// Judging starts in the background; the answer comes once it has.
        static let judge: TimeInterval = 90
        static let call: TimeInterval = 20
    }

    private func caseURL(_ id: String, _ action: String? = nil) -> URL {
        let url = endpoint("cases").appending(component: id)
        guard let action else { return url }
        return url.appending(path: action)
    }

    private func jsonRequest(_ url: URL, method: String, timeout: TimeInterval, body: [String: Any]?, idempotencyKey: String? = nil) throws -> URLRequest {
        var request = makeRequest(url: url, method: method, timeout: timeout)
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        if let idempotencyKey {
            request.setValue(idempotencyKey, forHTTPHeaderField: "Idempotency-Key")
        }
        return request
    }

    /// The JSON body of POST /api/v1/cases, also the Idempotency-Key's input.
    static func createCaseBody(text: String, preset: String, lang: AppLang, tier: Tier, evidence: [String], displayName: String?) -> [String: Any] {
        var body: [String: Any] = [
            "text": text,
            "framework": ["preset": preset],
            "lang": lang.rawValue,
            "tier": tier.rawValue,
        ]
        if tier == .premium, !evidence.isEmpty { body["evidence"] = evidence }
        if let displayName, !displayName.isEmpty { body["displayName"] = displayName }
        return body
    }

    /// Canonical text of a JSON body, for comparing requests.
    static func canonical(_ body: [String: Any]) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: body, options: [.sortedKeys]) else { return UUID().uuidString }
        return String(decoding: data, as: UTF8.self)
    }

    /// POST /api/v1/cases: the owner's side; a premium case holds one premium verdict.
    func createCase(text: String, preset: String, lang: AppLang, tier: Tier, evidence: [String], displayName: String?, idempotencyKey: String) async throws -> CaseSubmission {
        let body = Self.createCaseBody(text: text, preset: preset, lang: lang, tier: tier, evidence: evidence, displayName: displayName)
        let request = try jsonRequest(endpoint("cases"), method: "POST", timeout: CaseTimeout.create, body: body, idempotencyKey: idempotencyKey)
        let data = try await send(request)
        do {
            return try CaseDecoding.submission(data)
        } catch {
            throw APIError.malformed
        }
    }

    /// GET /api/v1/cases/{id}.
    func fetchCase(id: String) async throws -> CaseView {
        let request = makeRequest(url: caseURL(id), method: "GET", timeout: CaseTimeout.call)
        return try await caseAnswer(request)
    }

    /// GET /api/v1/cases?limit=N: the owner's cases, newest first.
    func listCases(limit: Int = 20) async throws -> [CaseSummary] {
        let url = endpoint("cases").appending(queryItems: [URLQueryItem(name: "limit", value: String(limit))])
        let data = try await send(makeRequest(url: url, method: "GET", timeout: CaseTimeout.call))
        do {
            return try CaseDecoding.list(data)
        } catch {
            throw APIError.malformed
        }
    }

    /// POST /api/v1/cases/{id}/judge: `{ "mode": "only_mine" }` judges the
    /// owner's side alone (the invite closes); `{}` retries a failed case.
    func judgeCase(id: String, onlyMine: Bool) async throws -> CaseView {
        let body: [String: Any] = onlyMine ? ["mode": "only_mine"] : [:]
        return try await caseAnswer(try jsonRequest(caseURL(id, "judge"), method: "POST", timeout: CaseTimeout.judge, body: body))
    }

    /// POST /api/v1/cases/{id}/invite: a new link; the old one stops working.
    func rotateInvite(id: String) async throws -> String {
        let data = try await send(makeRequest(url: caseURL(id, "invite"), method: "POST", timeout: CaseTimeout.call))
        guard let object = try? WireDecoding.topLevelObject(data),
              let url = object["inviteUrl"] as? String, !url.isEmpty
        else { throw APIError.malformed }
        return url
    }

    /// POST /api/v1/cases/{id}/removal { confirm: "remove" }: the owner's
    /// side is blanked and every link of the case closes.
    func removeCase(id: String) async throws -> CaseView {
        try await caseAnswer(try jsonRequest(caseURL(id, "removal"), method: "POST", timeout: CaseTimeout.call, body: ["confirm": "remove"]))
    }

    /// PATCH /api/v1/cases/{id}/display: the owner's name on the share pages
    /// (empty clears it) and/or the names switch.
    func updateCaseDisplay(id: String, displayName: String? = nil, clearName: Bool = false, namesVisible: Bool? = nil) async throws -> CaseView {
        var body: [String: Any] = [:]
        if let displayName { body["displayName"] = displayName } else if clearName { body["displayName"] = NSNull() }
        if let namesVisible { body["namesVisible"] = namesVisible }
        return try await caseAnswer(try jsonRequest(caseURL(id, "display"), method: "PATCH", timeout: CaseTimeout.call, body: body))
    }

    /// The JSON body of POST /api/v1/cases/{id}/appeals and
    /// /api/v1/verdicts/{id}/appeals.
    static func appealBody(text: String, evidence: [String]) -> [String: Any] {
        var body: [String: Any] = ["text": text]
        if !evidence.isEmpty { body["evidence"] = evidence }
        return body
    }

    /// POST /api/v1/cases/{id}/appeals: the owner adds context (202, the
    /// case is re-judging).
    func appealCase(id: String, text: String, evidence: [String], idempotencyKey: String) async throws -> CaseSubmission {
        let body = Self.appealBody(text: text, evidence: evidence)
        let request = try jsonRequest(caseURL(id, "appeals"), method: "POST", timeout: CaseTimeout.appeal, body: body, idempotencyKey: idempotencyKey)
        let data = try await send(request)
        do {
            return try CaseDecoding.submission(data)
        } catch {
            throw APIError.malformed
        }
    }

    /// GET /api/v1/verdicts/{id} read for its rounds of added context and,
    /// for the signed-in writer, whether another may be added.
    func verdictRounds(id: String) async throws -> VerdictRounds {
        let url = endpoint("verdicts").appending(component: id)
        let data = try await send(makeRequest(url: url, method: "GET", timeout: CaseTimeout.call))
        do {
            return try CaseDecoding.rounds(data)
        } catch {
            throw APIError.malformed
        }
    }

    /// POST /api/v1/verdicts/{id}/appeals: the writer adds context to a
    /// one-sided verdict (202 with the round to poll).
    func appealVerdict(id: String, text: String, evidence: [String], idempotencyKey: String) async throws -> VerdictAppealSubmission {
        let body = Self.appealBody(text: text, evidence: evidence)
        let url = endpoint("verdicts").appending(component: id).appending(path: "appeals")
        let request = try jsonRequest(url, method: "POST", timeout: CaseTimeout.appeal, body: body, idempotencyKey: idempotencyKey)
        let data = try await send(request)
        do {
            return try CaseDecoding.verdictAppeal(data)
        } catch {
            throw APIError.malformed
        }
    }

    private func caseAnswer(_ request: URLRequest) async throws -> CaseView {
        let data = try await send(request)
        do {
            return try CaseDecoding.envelope(data)
        } catch {
            throw APIError.malformed
        }
    }
}
