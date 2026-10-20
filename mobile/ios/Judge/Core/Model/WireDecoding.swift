import Foundation

/// A decoded verdict plus the exact JSON it came from.
struct RawResult: Sendable, Equatable {
    let result: VerdictResult
    /// The `result` object as JSON; stored in history so fields added by a
    /// newer server survive a round trip through the database.
    let json: String
}

/// POST /api/v1/verdict success.
struct VerdictPayload: Sendable, Equatable {
    let id: String
    let result: RawResult
    let nameMap: [NameMapping]
}

/// POST /api/v1/verdicts/{id}/translate success.
struct TranslatePayload: Sendable, Equatable {
    let id: String
    let lang: AppLang?
    let source: AppLang?
    let translated: Bool
    let result: RawResult
    /// Light shape check of the raw result (looksLikeVerdict on the web).
    let looksValid: Bool
}

/// GET /api/v1/verdicts/{id} success.
struct StoredPayload: Sendable, Equatable {
    let id: String
    let result: RawResult
    let createdAt: String
}

enum WireDecodingError: Error, Equatable {
    case notAnObject
    case missing(String)
}

enum WireDecoding {
    static func verdictPayload(from data: Data) throws -> VerdictPayload {
        let object = try topLevelObject(data)
        let id = try string("id", in: object)
        let result = try rawResult(object["result"])
        var nameMap: [NameMapping] = []
        if let list = object["name_map"] as? [Any] {
            for entry in list {
                guard let pair = entry as? [String: Any],
                      let original = pair["original"] as? String,
                      let replacement = pair["replacement"] as? String
                else { continue }
                nameMap.append(NameMapping(original: original, replacement: replacement))
            }
        }
        return VerdictPayload(id: id, result: result, nameMap: nameMap)
    }

    static func translatePayload(from data: Data) throws -> TranslatePayload {
        let object = try topLevelObject(data)
        let raw = object["result"]
        return TranslatePayload(
            id: try string("id", in: object),
            lang: (object["lang"] as? String).flatMap(AppLang.init(rawValue:)),
            source: (object["source"] as? String).flatMap(AppLang.init(rawValue:)),
            translated: (object["translated"] as? Bool) ?? false,
            result: try rawResult(raw),
            looksValid: VerdictShape.looksLikeVerdict(raw)
        )
    }

    static func storedPayload(from data: Data) throws -> StoredPayload {
        let object = try topLevelObject(data)
        return StoredPayload(
            id: try string("id", in: object),
            result: try rawResult(object["result"]),
            createdAt: (object["createdAt"] as? String) ?? ""
        )
    }

    static func errorBody(from data: Data) -> ApiErrorBody? {
        guard let object = try? JSONSerialization.jsonObject(with: data), object is [String: Any] else { return nil }
        return try? JSONDecoder().decode(ApiErrorBody.self, from: data)
    }

    /// Decodes a stored `result` JSON string (history rows, cached translations).
    static func result(fromJSON json: String) throws -> VerdictResult {
        try JSONDecoder().decode(VerdictResult.self, from: Data(json.utf8))
    }

    static func nameMap(fromJSON json: String) -> [NameMapping] {
        (try? JSONDecoder().decode([NameMapping].self, from: Data(json.utf8))) ?? []
    }

    static func json(of nameMap: [NameMapping]) -> String {
        guard let data = try? JSONEncoder().encode(nameMap) else { return "[]" }
        return String(decoding: data, as: UTF8.self)
    }

    /// `{ "tr": <result>, ... }` as stored in a history row, split per language.
    static func translations(fromJSON json: String?) -> [AppLang: RawResult] {
        guard let json, let object = try? JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any] else {
            return [:]
        }
        var out: [AppLang: RawResult] = [:]
        for (key, value) in object {
            guard let lang = AppLang(rawValue: key), let raw = try? rawResult(value) else { continue }
            out[lang] = raw
        }
        return out
    }

    static func json(of translations: [AppLang: String]) -> String? {
        var object: [String: Any] = [:]
        for (lang, json) in translations {
            guard let value = try? JSONSerialization.jsonObject(with: Data(json.utf8)) else { continue }
            object[lang.rawValue] = value
        }
        guard !object.isEmpty, let data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]) else {
            return nil
        }
        return String(decoding: data, as: UTF8.self)
    }

    // MARK: - Helpers

    private static func topLevelObject(_ data: Data) throws -> [String: Any] {
        guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw WireDecodingError.notAnObject
        }
        return object
    }

    private static func string(_ key: String, in object: [String: Any]) throws -> String {
        guard let value = object[key] as? String, !value.isEmpty else { throw WireDecodingError.missing(key) }
        return value
    }

    private static func rawResult(_ value: Any?) throws -> RawResult {
        guard let value, let object = value as? [String: Any], JSONSerialization.isValidJSONObject(object) else {
            throw WireDecodingError.missing("result")
        }
        let data = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys, .withoutEscapingSlashes])
        let result = try JSONDecoder().decode(VerdictResult.self, from: data)
        return RawResult(result: result, json: String(decoding: data, as: UTF8.self))
    }
}

/// Port of `looksLikeVerdict` (lib/use-translation.ts): the fields the card
/// renders, with the types it relies on. A translation that fails it is
/// ignored and the original stays on screen.
enum VerdictShape {
    private static let finalVerdicts: Set<String> = ["side_a", "side_b", "split", "conditional", "dissolved", "too_close"]
    private static let judgeVerdicts: Set<String> = ["side_a", "side_b", "split", "conditional", "dissolved"]
    private static let disputeTypes: Set<String> = ["factual", "logical", "definitional", "values", "mixed"]
    private static let claimKinds: Set<String> = ["fact", "value", "definition", "logic"]

    static func looksLikeVerdict(_ value: Any?) -> Bool {
        guard let x = value as? [String: Any] else { return false }
        guard let verdict = x["verdict"] as? String, finalVerdicts.contains(verdict),
              let dispute = x["dispute_type"] as? String, disputeTypes.contains(dispute),
              x["headline"] is String, x["crux"] is String, x["losing_side_best_point"] is String,
              let confidence = integer(x["confidence"]), (1...5).contains(confidence),
              let runs = x["runs"] as? [Any], runs.allSatisfy({ run in
                  guard let text = run as? String else { return false }
                  return judgeVerdicts.contains(text)
              }),
              let facts = x["facts_relied_on"] as? [Any], facts.allSatisfy({ $0 is String }),
              isNullOrArray(x["split_points"]), isNullOrArray(x["conditional"]),
              isBool(x["demo"]),
              let map = x["argument_map"] as? [String: Any],
              isClaims(map["side_a"]), isClaims(map["side_b"]),
              map["bedrock_a"] is String, map["bedrock_b"] is String
        else { return false }
        return true
    }

    private static func isClaims(_ value: Any?) -> Bool {
        guard let list = value as? [Any], !list.isEmpty else { return false }
        return list.allSatisfy { item in
            guard let claim = item as? [String: Any], claim["claim"] is String,
                  let kind = claim["kind"] as? String else { return false }
            return claimKinds.contains(kind)
        }
    }

    /// JSON `null` arrives as NSNull; a missing key fails like `undefined` on the web.
    private static func isNullOrArray(_ value: Any?) -> Bool {
        value is NSNull || value is [Any]
    }

    private static func isBool(_ value: Any?) -> Bool {
        guard let number = value as? NSNumber else { return false }
        return CFGetTypeID(number) == CFBooleanGetTypeID()
    }

    private static func integer(_ value: Any?) -> Int? {
        guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else { return nil }
        let double = number.doubleValue
        guard double.isFinite, double.rounded() == double else { return nil }
        return Int(double)
    }
}
