import XCTest
@testable import Judge

/// The release rules of a dragged side card, as in lib/card-throw.ts.
final class CardThrowTests: XCTestCase {
    func testVelocityUsesTheLastHundredMilliseconds() {
        let v = CardThrow.velocity([
            .init(x: 0, y: 0, t: 0),
            .init(x: 100, y: 0, t: 380),
            .init(x: 120, y: 10, t: 420),
            .init(x: 160, y: 30, t: 500),
        ])
        XCTAssertEqual(v.dx, 0.5, accuracy: 0.001)
        XCTAssertEqual(v.dy, 0.25, accuracy: 0.001)
        XCTAssertEqual(CardThrow.velocity([]), .zero)
    }

    func testThrowOnDistanceOrSpeed() {
        XCTAssertTrue(CardThrow.isThrow(120, 0, .zero))
        XCTAssertFalse(CardThrow.isThrow(60, 60, .zero))
        XCTAssertTrue(CardThrow.isThrow(40, 0, CGVector(dx: 1, dy: 0)))
        XCTAssertFalse(CardThrow.isThrow(40, 0, CGVector(dx: 0.3, dy: 0)))
        XCTAssertFalse(CardThrow.isThrow(5, 0, CGVector(dx: 3, dy: 0)))
    }

    func testTargetFollowsTheVelocityThenTheDrag() {
        let up = CardThrow.target(10, 0, CGVector(dx: 0, dy: -2), reach: 1000)
        XCTAssertEqual(up.width, 10, accuracy: 0.001)
        XCTAssertEqual(up.height, -1000, accuracy: 0.001)
        let still = CardThrow.target(30, 40, .zero, reach: 100)
        XCTAssertEqual(still.width, 90, accuracy: 0.001)
        XCTAssertEqual(still.height, 120, accuracy: 0.001)
    }
}
