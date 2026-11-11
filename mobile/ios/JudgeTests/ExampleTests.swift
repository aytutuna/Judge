import XCTest
@testable import Judge

final class ExampleTests: XCTestCase {
    func testPickMatchesTheGoldenVectors() throws {
        let vectors = try Fixtures.object("example-vectors")
        let ids = try XCTUnwrap(vectors["ids"] as? [String])
        for entry in try Fixtures.list("cases", in: vectors) {
            let pick = try XCTUnwrap(Examples.next(
                ids: ids,
                seen: try XCTUnwrap(entry["seen"] as? [String]),
                random: try XCTUnwrap(entry["random"] as? Double)
            ))
            XCTAssertEqual(pick.id, entry["id"] as? String, "\(entry)")
            XCTAssertEqual(pick.seen, entry["seenAfter"] as? [String], "\(entry)")
        }

        let single = try XCTUnwrap(vectors["single"] as? [String: Any])
        let pick = try XCTUnwrap(Examples.next(
            ids: try XCTUnwrap(single["ids"] as? [String]),
            seen: try XCTUnwrap(single["seen"] as? [String]),
            random: try XCTUnwrap(single["random"] as? Double)
        ))
        XCTAssertEqual(pick.id, single["id"] as? String)
        XCTAssertEqual(pick.seen, single["seenAfter"] as? [String])
    }

    func testNoExamplesPickNothing() {
        XCTAssertNil(Examples.next(ids: [], seen: [], random: 0.5))
    }

    func testSeenIdsSurviveInTheDefaults() throws {
        let suite = "judge.tests.examples.seen"
        UserDefaults().removePersistentDomain(forName: suite)
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        XCTAssertEqual(Examples.loadSeen(defaults), [])
        Examples.saveSeen(["b", "a"], defaults)
        XCTAssertEqual(Examples.loadSeen(defaults), ["b", "a"])
    }
}
