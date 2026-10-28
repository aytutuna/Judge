import XCTest
@testable import Judge

final class DecodingTests: XCTestCase {
    func testEverySampleDecodes() throws {
        let names = try Fixtures.sampleNames()
        XCTAssertGreaterThanOrEqual(names.count, 9)
        for name in names {
            let payload = try Fixtures.sample(name)
            XCTAssertFalse(payload.id.isEmpty, name)
            XCTAssertNotEqual(payload.result.result.verdict, .unknown, name)
            XCTAssertNotEqual(payload.result.result.disputeType, .unknown, name)
            // The raw JSON decodes back to the same value.
            XCTAssertEqual(try WireDecoding.result(fromJSON: payload.result.json), payload.result.result, name)
        }
    }

    func testSelfWinSample() throws {
        let payload = try Fixtures.sample("win_a_self")
        let result = payload.result.result
        XCTAssertEqual(payload.id, "abc123DEF0")
        XCTAssertEqual(result.verdict, .sideA)
        XCTAssertEqual(result.runs, [.sideA, .sideA, .sideB])
        XCTAssertEqual(result.lang, .en)
        XCTAssertEqual(result.lean, .absent)
        XCTAssertEqual(result.cruxTrial?.outcome, .survived)
        XCTAssertEqual(payload.nameMap, [
            NameMapping(original: "I", replacement: "Party A"),
            NameMapping(original: "Sam", replacement: "Party B"),
        ])
    }

    func testWhyIsOptional() throws {
        let withWhy = try Fixtures.sample("win_a_self").result.result
        XCTAssertEqual(withWhy.why?.hasPrefix("Party B's case rests on shape alone."), true)
        XCTAssertEqual(VerdictDisplay.why(withWhy), withWhy.why)

        let older = try Fixtures.sample("win_b_named").result.result
        XCTAssertNil(older.why)
        XCTAssertNil(VerdictDisplay.why(older))

        let translated = try XCTUnwrap(Fixtures.verdicts()["translateResponse"])
        let tr = try WireDecoding.translatePayload(from: JSONSerialization.data(withJSONObject: translated)).result.result
        XCTAssertEqual(tr.why?.hasPrefix("Taraf B'nin dayanağı sadece şekil."), true)
    }

    func testWhyIsHiddenOnRefusalsAndBlankText() throws {
        var result = try Fixtures.sample("win_a_self").result.result
        result.why = "  "
        XCTAssertNil(VerdictDisplay.why(result))
        result.why = "Menus list them apart."
        result.modelRefused = true
        XCTAssertNil(VerdictDisplay.why(result))
    }

    func testLeanAbsentNullAndObjectStayDistinct() throws {
        XCTAssertEqual(try Fixtures.sample("lean_tie").result.result.lean, .tie)
        let escalated = try Fixtures.sample("lean_b_majority_escalated").result.result
        XCTAssertEqual(escalated.lean.value?.party, .b)
        XCTAssertTrue(escalated.escalated)
        XCTAssertEqual(try Fixtures.sample("win_b_named").result.result.lean, .absent)
    }

    func testPremiumSampleCarriesFactCheckAndPanel() throws {
        let result = try Fixtures.sample("premium_factcheck").result.result
        XCTAssertTrue(result.isPremium)
        XCTAssertEqual(result.factCheck?.status, .checked)
        XCTAssertFalse(result.panel?.models.isEmpty ?? true)
    }

    func testUnknownValuesFromANewerServerDoNotFail() throws {
        let json = """
        {"id":"x1","name_map":[],"result":{"verdict":"brand_new","dispute_type":"cosmic","headline":"h","crux":"c",
        "split_points":null,"conditional":null,
        "argument_map":{"side_a":[{"claim":"a","kind":"vibe"}],"side_b":[],"bedrock_a":"","bedrock_b":""},
        "facts_relied_on":[],"losing_side_best_point":"","confidence":4,"runs":["side_a","abstain"],"demo":false,
        "lang":"de","future_field":{"nested":true}}}
        """
        let payload = try WireDecoding.verdictPayload(from: Data(json.utf8))
        let result = payload.result.result
        XCTAssertEqual(result.verdict, .unknown)
        XCTAssertEqual(result.disputeType, .unknown)
        XCTAssertEqual(result.argumentMap.sideA.first?.kind, .unknown)
        XCTAssertEqual(result.runs, [.sideA, .unknown])
        XCTAssertNil(result.lang)
        XCTAssertTrue(payload.result.json.contains("future_field"), "unknown fields survive in the raw JSON")
        // An unknown verdict reads like too_close and leaves the beam level.
        let parties = Names.partyNames([], lang: .en, selfLang: .en)
        XCTAssertEqual(VerdictDisplay.label(result.verdict, parties: parties, lang: .en), L10n.verdictTooClose(.en))
        XCTAssertEqual(VerdictDisplay.tugFinal(result), 50)
    }

    func testMissingIdOrResultIsAnError() {
        XCTAssertThrowsError(try WireDecoding.verdictPayload(from: Data(#"{"result":{}}"#.utf8)))
        XCTAssertThrowsError(try WireDecoding.verdictPayload(from: Data(#"{"id":"x"}"#.utf8)))
        XCTAssertThrowsError(try WireDecoding.verdictPayload(from: Data("<html>".utf8)))
    }

    func testTranslateResponse() throws {
        let body = try XCTUnwrap(Fixtures.verdicts()["translateResponse"])
        let payload = try WireDecoding.translatePayload(from: JSONSerialization.data(withJSONObject: body))
        XCTAssertEqual(payload.lang, .tr)
        XCTAssertEqual(payload.source, .en)
        XCTAssertTrue(payload.translated)
        XCTAssertTrue(payload.looksValid)
        XCTAssertEqual(payload.result.result.headline, "Taraf B kelimenin anlamını zorluyor, Taraf A'nın menü testi kazanıyor")
    }

    func testStoredResponse() throws {
        let body = try XCTUnwrap(Fixtures.verdicts()["storedVerdictResponse"])
        let payload = try WireDecoding.storedPayload(from: JSONSerialization.data(withJSONObject: body))
        XCTAssertEqual(payload.id, "winB000001")
        XCTAssertEqual(payload.createdAt, "2026-10-20T12:00:00.000Z")
        XCTAssertEqual(payload.result.result.verdict, .sideB)
    }

    func testLooksLikeVerdict() throws {
        let body = try XCTUnwrap(Fixtures.verdicts()["translateResponse"] as? [String: Any])
        let good = try XCTUnwrap(body["result"] as? [String: Any])
        XCTAssertTrue(VerdictShape.looksLikeVerdict(good))

        var badConfidence = good
        badConfidence["confidence"] = 9
        XCTAssertFalse(VerdictShape.looksLikeVerdict(badConfidence))

        var missingSplit = good
        missingSplit.removeValue(forKey: "split_points")
        XCTAssertFalse(VerdictShape.looksLikeVerdict(missingSplit), "undefined split_points fails like on the web")

        var boolAsNumber = good
        boolAsNumber["demo"] = 0
        XCTAssertFalse(VerdictShape.looksLikeVerdict(boolAsNumber))

        var noWhy = good
        noWhy.removeValue(forKey: "why")
        XCTAssertTrue(VerdictShape.looksLikeVerdict(noWhy), "older verdicts have no why")

        var whyNotText = good
        whyNotText["why"] = 3
        XCTAssertFalse(VerdictShape.looksLikeVerdict(whyNotText))

        var emptyClaims = good
        let emptyMap: [String: Any] = ["side_a": [Any](), "side_b": [Any](), "bedrock_a": "", "bedrock_b": ""]
        emptyClaims["argument_map"] = emptyMap
        XCTAssertFalse(VerdictShape.looksLikeVerdict(emptyClaims))

        XCTAssertFalse(VerdictShape.looksLikeVerdict(nil))
        XCTAssertFalse(VerdictShape.looksLikeVerdict("text"))
    }

    func testRequestEncodingOmitsUnsetFields() throws {
        let request = VerdictRequest(argument: "My friend Sam says a hot dog is a sandwich.", lang: .tr)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(request)) as? [String: Any])
        XCTAssertEqual(object["lang"] as? String, "tr")
        XCTAssertEqual(object["tier"] as? String, "free")
        XCTAssertNil(object["framework"])
        XCTAssertNil(object["clarifications"])
    }

    func testNameMapAndTranslationsRoundTrip() throws {
        let map = [NameMapping(original: "Deniz'in", replacement: "Taraf B'nin")]
        XCTAssertEqual(WireDecoding.nameMap(fromJSON: WireDecoding.json(of: map)), map)

        let payload = try Fixtures.sample("win_a_self")
        let stored = try XCTUnwrap(WireDecoding.json(of: [.tr: payload.result.json]))
        let restored = WireDecoding.translations(fromJSON: stored)
        XCTAssertEqual(restored[.tr]?.result, payload.result.result)
        XCTAssertTrue(WireDecoding.translations(fromJSON: nil).isEmpty)
        XCTAssertTrue(WireDecoding.translations(fromJSON: "not json").isEmpty)
    }
}
