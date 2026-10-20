import Foundation
import XCTest
@testable import Judge

/// Loads mobile/shared/fixtures/*.json, bundled into the test target as
/// resources (the SharedFixtures folder in Judge.xcodeproj).
enum Fixtures {
    private final class BundleToken {}

    static func data(_ name: String) throws -> Data {
        let bundle = Bundle(for: BundleToken.self)
        let url = try XCTUnwrap(bundle.url(forResource: name, withExtension: "json"), "missing fixture \(name).json")
        return try Data(contentsOf: url)
    }

    static func object(_ name: String) throws -> [String: Any] {
        try XCTUnwrap(JSONSerialization.jsonObject(with: data(name)) as? [String: Any])
    }

    static func vectors() throws -> [String: Any] { try object("display-vectors") }
    static func verdicts() throws -> [String: Any] { try object("verdicts") }

    static func list(_ key: String, in object: [String: Any]) throws -> [[String: Any]] {
        try XCTUnwrap(object[key] as? [[String: Any]], "missing list \(key)")
    }

    /// One sample response body (verdicts.json → verdictResponses[name]) as JSON data.
    static func sampleData(_ name: String) throws -> Data {
        let responses = try XCTUnwrap(verdicts()["verdictResponses"] as? [String: Any])
        let sample = try XCTUnwrap(responses[name], "missing sample \(name)")
        return try JSONSerialization.data(withJSONObject: sample)
    }

    static func sample(_ name: String) throws -> VerdictPayload {
        try WireDecoding.verdictPayload(from: sampleData(name))
    }

    static func sampleNames() throws -> [String] {
        let responses = try XCTUnwrap(verdicts()["verdictResponses"] as? [String: Any])
        return responses.keys.sorted()
    }

    static func lang(_ value: Any?) throws -> AppLang {
        try XCTUnwrap((value as? String).flatMap(AppLang.init(rawValue:)), "bad lang \(String(describing: value))")
    }

    static func nameMap(_ value: Any?) -> [NameMapping] {
        guard let list = value as? [[String: Any]] else { return [] }
        return list.compactMap { entry in
            guard let original = entry["original"] as? String, let replacement = entry["replacement"] as? String else { return nil }
            return NameMapping(original: original, replacement: replacement)
        }
    }

    /// An ApiErrorBody from a fixture body (nil for JSON null).
    static func errorBody(_ value: Any?) throws -> ApiErrorBody? {
        guard let object = value as? [String: Any] else { return nil }
        return WireDecoding.errorBody(from: try JSONSerialization.data(withJSONObject: object))
    }
}
