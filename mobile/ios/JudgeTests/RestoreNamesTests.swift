import XCTest
@testable import Judge

/// restoreNames and personalizeResult against outputs computed by the
/// website's own lib/names.ts (display-vectors.json).
final class RestoreNamesTests: XCTestCase {
    private static let personalizedKeys: Set<String> = [
        "headline", "crux", "losing_side_best_point", "side_a", "side_b", "bedrock_a", "bedrock_b",
        "facts_relied_on", "split_points", "conditional_if_value", "conditional_then", "lean_reason",
        "crux_trial_attack", "crux_trial_reasoning", "fact_check_claims", "fact_check_summaries",
    ]

    func testRestoreVectors() throws {
        let cases = try Fixtures.list("restore", in: Fixtures.vectors())
        XCTAssertFalse(cases.isEmpty)
        for vector in cases {
            let text = try XCTUnwrap(vector["text"] as? String)
            let selfLang = try Fixtures.lang(vector["selfLang"])
            let textLang = try Fixtures.lang(vector["textLang"])
            let parties = Names.resolveParties(Fixtures.nameMap(vector["nameMap"]), selfLang: selfLang)
            let restored = Names.restoreNames(text, parties: parties, textLang: textLang)
            XCTAssertEqual(restored, vector["expected"] as? String, "\(text) [\(selfLang.rawValue)/\(textLang.rawValue)]")
        }
    }

    func testPersonalizedVerdictVectors() throws {
        let vectors = try Fixtures.list("verdicts", in: Fixtures.vectors())
        XCTAssertFalse(vectors.isEmpty)
        for vector in vectors {
            let name = try XCTUnwrap(vector["sample"] as? String)
            let lang = try Fixtures.lang(vector["lang"])
            let payload = try Fixtures.sample(name)
            let result = payload.result.result
            let selfLang = ContentLang.verdictLang(result)
            XCTAssertEqual(selfLang, try Fixtures.lang(vector["selfLang"]), name)
            let expected = try XCTUnwrap(vector["personalized"] as? [String: Any], name)
            let personalized = Names.personalizeResult(result, nameMap: payload.nameMap, selfLang: selfLang)
            assertFields(personalized, expected, context: "\(name)/\(lang.rawValue)")
        }
    }

    func testPersonalizedTranslationVectors() throws {
        let vectors = try Fixtures.list("personalizedTranslations", in: Fixtures.vectors())
        XCTAssertFalse(vectors.isEmpty)
        let body = try XCTUnwrap(Fixtures.verdicts()["translateResponse"])
        let translated = try WireDecoding.translatePayload(from: JSONSerialization.data(withJSONObject: body)).result.result
        for vector in vectors {
            let name = try XCTUnwrap(vector["sample"] as? String)
            let selfLang = try Fixtures.lang(vector["selfLang"])
            let original = try Fixtures.sample(name)
            XCTAssertEqual(ContentLang.verdictLang(translated), try Fixtures.lang(vector["lang"]), name)
            XCTAssertEqual(ContentLang.verdictLang(original.result.result), selfLang, name)
            let personalized = Names.personalizeResult(translated, nameMap: original.nameMap, selfLang: selfLang)
            assertFields(personalized, vector, context: "\(name) translated")
        }
    }

    func testNothingToRestoreKeepsTheResult() throws {
        let result = try Fixtures.sample("win_a_self").result.result
        XCTAssertEqual(Names.personalizeResult(result, nameMap: [], selfLang: .en), result)
        let unlabelled = [NameMapping(original: "Sam", replacement: "the bakery")]
        XCTAssertEqual(Names.personalizeResult(result, nameMap: unlabelled, selfLang: .en), result)
        XCTAssertEqual(Names.restoreNames("", parties: ["A": Names.Resolved(name: "Sam", isSelf: false)], textLang: .en), "")
    }

    func testRestoredNamesSkipTheNarrator() {
        let nameMap = [
            NameMapping(original: "Ben", replacement: "Taraf A"),
            NameMapping(original: "Deniz'in", replacement: "Taraf B'nin"),
            NameMapping(original: "Ayşe", replacement: "Kişi C"),
        ]
        XCTAssertEqual(Names.restoredNames(nameMap, selfLang: .tr), ["Deniz", "Ayşe"])
        // "Ben" is only the narrator when the argument was judged in Turkish.
        XCTAssertEqual(Names.restoredNames(nameMap, selfLang: .en), ["Ben", "Deniz", "Ayşe"])
    }

    func testTurkishSuffixes() {
        XCTAssertEqual(Names.trSuffix("Burak", .dat), "a")
        XCTAssertEqual(Names.trSuffix("Kemal", .gen), "in")
        XCTAssertEqual(Names.trSuffix("Derya", .past), "ydı")
        XCTAssertEqual(Names.trSuffix("Umut", .loc), "ta")
        XCTAssertNil(Names.trSuffix("JJ", .gen))
    }

    /// One personalized result against its flattened fields (see
    /// personalizedFields() in mobile/shared/fixtures/export-fixtures.ts).
    private func assertFields(_ r: VerdictResult, _ expected: [String: Any], context: String) {
        let fields = Set(expected.keys).subtracting(["sample", "lang", "selfLang"])
        XCTAssertEqual(fields, Self.personalizedKeys, "personalized fields differ in \(context)")
        XCTAssertEqual(r.headline, expected["headline"] as? String, context)
        XCTAssertEqual(r.crux, expected["crux"] as? String, context)
        XCTAssertEqual(r.losingSideBestPoint, expected["losing_side_best_point"] as? String, context)
        XCTAssertEqual(r.argumentMap.sideA.map(\.claim), expected["side_a"] as? [String], context)
        XCTAssertEqual(r.argumentMap.sideB.map(\.claim), expected["side_b"] as? [String], context)
        XCTAssertEqual(r.argumentMap.bedrockA, expected["bedrock_a"] as? String, context)
        XCTAssertEqual(r.argumentMap.bedrockB, expected["bedrock_b"] as? String, context)
        XCTAssertEqual(r.factsReliedOn, expected["facts_relied_on"] as? [String], context)
        XCTAssertEqual(r.splitPoints?.map(\.point), expected["split_points"] as? [String], context)
        XCTAssertEqual(r.conditional?.map(\.ifValue), expected["conditional_if_value"] as? [String], context)
        XCTAssertEqual(r.conditional?.map(\.then), expected["conditional_then"] as? [String], context)
        XCTAssertEqual(r.lean.value?.reason, expected["lean_reason"] as? String, context)
        XCTAssertEqual(r.cruxTrial?.attack, expected["crux_trial_attack"] as? String, context)
        XCTAssertEqual(r.cruxTrial?.reasoning, expected["crux_trial_reasoning"] as? String, context)
        XCTAssertEqual(r.factCheck?.claims.map(\.claim), expected["fact_check_claims"] as? [String], context)
        XCTAssertEqual(r.factCheck?.claims.map(\.summary), expected["fact_check_summaries"] as? [String], context)
    }
}
