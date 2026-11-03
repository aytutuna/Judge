import Foundation

/// Where a Verdicts row stands from the viewer's side (HistoryState in
/// lib/history-types.ts). A state this build doesn't know decodes as nil
/// and gets no label.
enum HistoryState: String, Sendable {
    case judging, failed, ready, rejudging, waiting, expired, removed
    case rejudgeFailed = "rejudge_failed"
    case removedByOther = "removed_by_other"

    var thinking: Bool { self == .judging || self == .rejudging }
}

/// One row of GET /api/v1/me/history (HistoryRow in lib/history-types.ts).
struct HistoryItem: Codable, Sendable, Equatable {
    var kind: String
    var id: String
    var role = "owner"
    var party = "a"
    /// Sort time, ISO; compared as a plain string like the server does.
    var at: String
    var createdAt = ""
    var state: String
    var yourMove = false
    var verdict: String?
    var contextAdded = false
    var contextBy: String?
    var headline: String?
    var excerpt: String?
    var nameMap: [NameMapping] = []
    var expiresAt: String?
    var removed = false
    var removable = false
    var inviteToken: String?

    init(kind: String, id: String, at: String, state: String) {
        self.kind = kind
        self.id = id
        self.at = at
        self.state = state
    }

    var isCase: Bool { kind == "case" }
    var isRespondent: Bool { role == "respondent" }
    var key: String { HistoryOrder.key(kind: kind, id: id) }
    var historyState: HistoryState? { HistoryState(rawValue: state) }
    var finalVerdict: FinalVerdict? { verdict.flatMap(FinalVerdict.init(rawValue:)) }

    private enum CodingKeys: String, CodingKey {
        case kind, id, role, party, at, createdAt, state, yourMove, verdict, contextAdded, contextBy
        case headline, excerpt, nameMap, expiresAt, removed, removable, inviteToken
    }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        kind = try c.decode(String.self, forKey: .kind)
        id = try c.decode(String.self, forKey: .id)
        at = try c.decode(String.self, forKey: .at)
        guard !id.isEmpty, !at.isEmpty else { throw DecodingError.dataCorruptedError(forKey: .id, in: c, debugDescription: "empty id or time") }
        role = (try? c.decodeIfPresent(String.self, forKey: .role)) ?? "owner"
        party = (try? c.decodeIfPresent(String.self, forKey: .party)) ?? "a"
        createdAt = (try? c.decodeIfPresent(String.self, forKey: .createdAt)) ?? at
        state = (try? c.decodeIfPresent(String.self, forKey: .state)) ?? ""
        yourMove = (try? c.decodeIfPresent(Bool.self, forKey: .yourMove)) == true
        verdict = try? c.decodeIfPresent(String.self, forKey: .verdict)
        contextAdded = (try? c.decodeIfPresent(Bool.self, forKey: .contextAdded)) == true
        contextBy = try? c.decodeIfPresent(String.self, forKey: .contextBy)
        headline = try? c.decodeIfPresent(String.self, forKey: .headline)
        excerpt = try? c.decodeIfPresent(String.self, forKey: .excerpt)
        nameMap = try c.decodeIfPresent([NameMapping].self, forKey: .nameMap) ?? []
        expiresAt = try? c.decodeIfPresent(String.self, forKey: .expiresAt)
        removed = (try? c.decodeIfPresent(Bool.self, forKey: .removed)) == true
        removable = (try? c.decodeIfPresent(Bool.self, forKey: .removable)) == true
        inviteToken = try? c.decodeIfPresent(String.self, forKey: .inviteToken)
    }
}

/// One page of the list; `next` is the cursor of the page after it.
struct HistoryPage: Sendable, Equatable {
    var items: [HistoryItem]
    var next: String?

    /// Rows this build can't read are left out rather than failing the page.
    static func decode(_ data: Data) throws -> HistoryPage {
        struct Lenient: Decodable {
            let item: HistoryItem?
            init(from decoder: any Decoder) throws { item = try? HistoryItem(from: decoder) }
        }
        struct Body: Decodable {
            let items: [Lenient]
            let next: String?
        }
        let body = try JSONDecoder().decode(Body.self, from: data)
        let next = body.next.flatMap { $0.isEmpty ? nil : $0 }
        return HistoryPage(items: body.items.compactMap(\.item), next: next)
    }
}

/// The list's order: newest `at` first, then key, both as plain strings
/// (historyKey and compareHistory in lib/history-types.ts).
enum HistoryOrder {
    static func key(kind: String, id: String) -> String { (kind == "case" ? "c:" : "v:") + id }

    /// Whether (at, key) `x` comes before `y`.
    static func before(_ x: (String, String), _ y: (String, String)) -> Bool {
        x.0 != y.0 ? x.0 > y.0 : x.1 > y.1
    }

    /// Between `lower` (included) and `upper` (excluded); nil bounds are open.
    static func inWindow(_ p: (String, String), lower: HistoryItem?, upper: HistoryItem?) -> Bool {
        if let lower, before((lower.at, lower.key), p) { return false }
        if let upper, !before((upper.at, upper.key), p) { return false }
        return true
    }

    /// ISO time with milliseconds, as the server writes it, so the two compare as strings.
    static func iso(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }
}

/// GET /api/v1/verdicts/{id}/mine, the parts the app keeps.
struct MineVerdict: Sendable, Equatable {
    var result: RawResult?
    var nameMap: [NameMapping]
}

extension JudgeAPI {
    /// GET /api/v1/me/history: the account's verdicts and cases, newest first.
    func history(limit: Int = 20, cursor: String? = nil) async throws -> HistoryPage {
        var query = [URLQueryItem(name: "limit", value: String(limit))]
        if let cursor { query.append(URLQueryItem(name: "cursor", value: cursor)) }
        let url = endpoint("me/history").appending(queryItems: query)
        let data = try await send(makeRequest(url: url, method: "GET", timeout: CaseTimeout.call))
        do {
            return try HistoryPage.decode(data)
        } catch {
            throw APIError.malformed
        }
    }

    private func removal(_ url: URL) async throws {
        var request = makeRequest(url: url, method: "POST", timeout: CaseTimeout.call)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["confirm": "remove"])
        _ = try await send(request)
    }

    /// POST /api/v1/verdicts/{id}/removal: the writer's text and names are
    /// erased and the share link closes (the website's "Remove this verdict").
    func removeVerdict(id: String) async throws {
        try await removal(endpoint("verdicts").appending(component: id).appending(path: "removal"))
    }

    /// POST /api/v1/respond/{token}/removal: the answering side of a case,
    /// for the account it is linked to.
    func removeAnsweredCase(token: String) async throws {
        try await removal(endpoint("respond").appending(component: token).appending(path: "removal"))
    }

    /// GET /api/v1/verdicts/{id}/mine: the writer's verdict and names, to
    /// keep an account verdict on the phone.
    func mineVerdict(id: String) async throws -> MineVerdict {
        let url = endpoint("verdicts").appending(component: id).appending(path: "mine")
        let data = try await send(makeRequest(url: url, method: "GET", timeout: PremiumTimeout.mine))
        guard let object = try? WireDecoding.topLevelObject(data) else { throw APIError.malformed }
        var result: RawResult?
        if object["result"] is [String: Any] { result = try? WireDecoding.rawResult(object["result"]) }
        return MineVerdict(result: result, nameMap: WireDecoding.nameMapList(object["nameMap"]))
    }
}
