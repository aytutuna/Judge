import Foundation

/// One clarifying question (POST /api/v1/clarify, lib/types.ts ClarifyResponse).
struct ClarifyQuestion: Decodable, Sendable, Equatable, Identifiable {
    let id: String
    let text: String
}

/// One image's result from POST /api/v1/evidence (lib/case-types.ts
/// EvidenceItemResult). `preview` is the raw transcript, for the uploader only.
struct EvidenceUploadItem: Decodable, Sendable, Equatable {
    var index: Int
    var status: String
    var kind: String?
    var token: String?
    var preview: String?
    var expiresAt: String?

    init(index: Int, status: String, kind: String? = nil, token: String? = nil, preview: String? = nil, expiresAt: String? = nil) {
        self.index = index
        self.status = status
        self.kind = kind
        self.token = token
        self.preview = preview
        self.expiresAt = expiresAt
    }

    private enum CodingKeys: String, CodingKey { case index, status, kind, token, preview, expiresAt }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        index = try c.decode(Int.self, forKey: .index)
        status = (try? c.decodeIfPresent(String.self, forKey: .status)) ?? "failed"
        kind = try? c.decodeIfPresent(String.self, forKey: .kind)
        token = try? c.decodeIfPresent(String.self, forKey: .token)
        preview = try? c.decodeIfPresent(String.self, forKey: .preview)
        expiresAt = try? c.decodeIfPresent(String.self, forKey: .expiresAt)
    }
}

/// One Idempotency-Key per exact request body: a retry of the same request
/// reuses it (the server replays or waits instead of charging again); a
/// different body, or a success, gets a new one.
@MainActor
final class IdempotencyKeys {
    private var held: (body: String, key: String)?

    func key(for body: String) -> String {
        if let held, held.body == body { return held.key }
        let key = UUID().uuidString.lowercased()
        held = (body, key)
        return key
    }

    /// Forgets `key` once its request succeeded.
    func clear(_ key: String) {
        if held?.key == key { held = nil }
    }

    /// The canonical text of a JSON body, for comparing requests.
    static func canonical<Body: Encodable>(_ body: Body) -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        guard let data = try? encoder.encode(body) else { return UUID().uuidString }
        return String(decoding: data, as: UTF8.self)
    }
}

/// Premium calls: the clarifying questions, screenshot evidence and the
/// writer's own view of a verdict.
extension JudgeAPI {
    enum PremiumTimeout {
        static let clarify: TimeInterval = 60
        /// Each image is read by a vision model; three run in parallel.
        static let evidence: TimeInterval = 120
        static let mine: TimeInterval = 10
    }

    /// POST /api/v1/clarify { argument, lang }: up to two questions.
    func clarify(argument: String, lang: AppLang) async throws -> [ClarifyQuestion] {
        struct Body: Encodable {
            let argument: String
            let lang: AppLang
        }
        struct Answer: Decodable {
            var questions: [ClarifyQuestion]
        }
        var request = makeRequest(url: endpoint("clarify"), method: "POST", timeout: PremiumTimeout.clarify)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(Body(argument: argument, lang: lang))
        let data = try await send(request)
        do {
            return Array(try JSONDecoder().decode(Answer.self, from: data).questions.prefix(2))
        } catch {
            throw APIError.malformed
        }
    }

    /// POST /api/v1/evidence as multipart/form-data, one "image" part per
    /// prepared image. The answer has one item per image, by index.
    func uploadEvidence(_ images: [PreparedImage]) async throws -> [EvidenceUploadItem] {
        struct Answer: Decodable {
            var items: [EvidenceUploadItem]
        }
        let boundary = "JudgeEvidence-\(UUID().uuidString)"
        var request = makeRequest(url: endpoint("evidence"), method: "POST", timeout: PremiumTimeout.evidence)
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.httpBody = Self.multipartBody(images, boundary: boundary)
        let data = try await send(request)
        do {
            return try JSONDecoder().decode(Answer.self, from: data).items
        } catch {
            throw APIError.malformed
        }
    }

    static func multipartBody(_ images: [PreparedImage], boundary: String) -> Data {
        var body = Data()
        func line(_ text: String) { body.append(Data((text + "\r\n").utf8)) }
        for (index, image) in images.enumerated() {
            line("--\(boundary)")
            line("Content-Disposition: form-data; name=\"image\"; filename=\"image-\(index + 1).\(image.fileExtension)\"")
            line("Content-Type: \(image.mimeType)")
            line("")
            body.append(image.data)
            line("")
        }
        line("--\(boundary)--")
        return body
    }

    /// GET /api/v1/verdicts/{id}/mine: the writer's name map, for a premium
    /// retry that joined a verdict already judged (its answer has none).
    func mineNameMap(id: String) async throws -> [NameMapping] {
        let url = endpoint("verdicts").appending(component: id).appending(path: "mine")
        let request = makeRequest(url: url, method: "GET", timeout: PremiumTimeout.mine)
        let data = try await send(request)
        guard let object = try? WireDecoding.topLevelObject(data) else { throw APIError.malformed }
        return WireDecoding.nameMapList(object["nameMap"])
    }
}
