import XCTest
@testable import Judge

final class VenueTests: XCTestCase {
    func testPickMatchesTheGoldenVectors() throws {
        let vectors = try Fixtures.object("venue-vectors")
        let ids = try XCTUnwrap(vectors["ids"] as? [String])
        for entry in try Fixtures.list("cases", in: vectors) {
            let pick = Venues.pick(
                ids: ids,
                last: entry["last"] as? String,
                random: try XCTUnwrap(entry["random"] as? Double)
            )
            XCTAssertEqual(pick, entry["id"] as? String, "\(entry)")
        }

        let single = try XCTUnwrap(vectors["single"] as? [String: Any])
        XCTAssertEqual(
            Venues.pick(
                ids: try XCTUnwrap(single["ids"] as? [String]),
                last: single["last"] as? String,
                random: try XCTUnwrap(single["random"] as? Double)
            ),
            single["id"] as? String
        )
    }

    func testNoVenuesPickTheCourt() {
        XCTAssertEqual(Venues.pick(ids: [], last: nil, random: 0.5), "court")
    }

    func testTheBundledListMatchesTheSharedOne() throws {
        let vectors = try Fixtures.object("venue-vectors")
        XCTAssertEqual(Venues.load(), try XCTUnwrap(vectors["ids"] as? [String]))
    }

    func testAnEmptyBundleHasOnlyTheCourt() {
        XCTAssertEqual(Venues.load(bundle: Bundle(for: Self.self)), ["court"])
    }

    func testThePickIsRememberedAndNeverRepeats() throws {
        let suite = "judge.tests.venue.last"
        UserDefaults().removePersistentDomain(forName: suite)
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        let first = Venues.pickNew(defaults: defaults, random: 0)
        XCTAssertEqual(first, "court")
        XCTAssertEqual(defaults.string(forKey: "judge-venue-last"), "court")
        let second = Venues.pickNew(defaults: defaults, random: 0)
        XCTAssertEqual(second, "beach", "the one just shown is left out")
        XCTAssertEqual(defaults.string(forKey: Venues.lastKey), "beach")
    }

    // MARK: - Requests

    func testTheVerdictRequestCarriesTheVenueOnlyWhenSet() throws {
        func object(_ request: VerdictRequest) throws -> [String: Any] {
            try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(request)) as? [String: Any])
        }
        XCTAssertNil(try object(VerdictRequest(argument: "x", lang: .en))["venue"])
        XCTAssertEqual(try object(VerdictRequest(argument: "x", lang: .en, venue: "farm"))["venue"] as? String, "farm")
    }

    func testTheCaseBodyCarriesTheVenueOnlyWhenSet() {
        XCTAssertNil(JudgeAPI.createCaseBody(text: "t", lang: .en, evidence: [], displayName: nil)["venue"])
        XCTAssertEqual(JudgeAPI.createCaseBody(text: "t", lang: .en, evidence: [], displayName: nil, venue: "ice")["venue"] as? String, "ice")
    }

    // MARK: - Responses

    func testVerdictResponsesDecodeTheVenue() throws {
        XCTAssertEqual(try Fixtures.sample("win_b_named").venue, "beach")
        XCTAssertNil(try Fixtures.sample("win_a_self").venue, "no venue is the court")

        let body = try XCTUnwrap(Fixtures.verdicts()["storedVerdictResponse"])
        let stored = try WireDecoding.storedPayload(from: JSONSerialization.data(withJSONObject: body))
        XCTAssertEqual(stored.venue, "beach")
    }

    func testHistoryRowsDecodeTheVenue() throws {
        let body = try XCTUnwrap(Fixtures.verdicts()["history"])
        let page = try HistoryPage.decode(try JSONSerialization.data(withJSONObject: body))
        XCTAssertEqual(page.items.first { $0.id == "verdict0021" }?.venue, "museum")
        XCTAssertEqual(page.items.first { $0.id == "case0000012" }?.venue, "camp")
        XCTAssertNil(page.items.first?.venue)

        let saved = try JSONDecoder().decode(HistoryItem.self, from: JSONEncoder().encode(try XCTUnwrap(page.items.first { $0.id == "verdict0021" })))
        XCTAssertEqual(saved.venue, "museum", "kept in the cached list")
    }

    func testCasesDecodeTheVenue() throws {
        let cases = try XCTUnwrap(Fixtures.verdicts()["cases"] as? [String: Any])
        let views = try XCTUnwrap(cases["views"] as? [String: Any])
        let judged = try CaseDecoding.view(try XCTUnwrap(views["judged"] as? [String: Any]))
        XCTAssertEqual(judged.venue, "library")
        XCTAssertNil(try CaseDecoding.view(["id": "x"]).venue)

        let list = try CaseDecoding.list(JSONSerialization.data(withJSONObject: try XCTUnwrap(cases["list"])))
        XCTAssertEqual(list[1].venue, "library")
        XCTAssertNil(list[0].venue)
    }
}
