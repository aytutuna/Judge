#if DEBUG
import XCTest
@testable import Judge

/// The debug-only `-JudgeScreenshotState` hook.
final class ScreenshotStateTests: XCTestCase {
    func testParsesEveryScreen() throws {
        XCTAssertEqual(ScreenshotState.parse("home:en")?.screen, .home)
        XCTAssertEqual(ScreenshotState.parse("home:tr")?.lang, .tr)
        XCTAssertEqual(ScreenshotState.parse("home-error:tr")?.screen, .homeError)
        XCTAssertEqual(ScreenshotState.parse("judging:en")?.screen, .judging)
        XCTAssertEqual(ScreenshotState.parse("verdict/win_a_self:tr")?.screen, .verdict(sample: "win_a_self"))
        XCTAssertEqual(ScreenshotState.parse("history:en")?.tab, .history)
        XCTAssertEqual(ScreenshotState.parse("settings:tr")?.tab, .settings)
        XCTAssertEqual(ScreenshotState.parse("verdict/split:en")?.tab, .new)
    }

    func testRejectsMalformedValues() {
        for raw in ["", "home", "home:de", "verdict/:en", "verdict:en", "nope:en", "home:en:extra"] {
            XCTAssertNil(ScreenshotState.parse(raw), raw)
        }
    }

    func testReadsTheLaunchArgument() {
        let state = ScreenshotState.fromLaunchArguments(["Judge", "-JudgeScreenshotState", "settings:tr"])
        XCTAssertEqual(state?.screen, .settings)
        XCTAssertNil(ScreenshotState.fromLaunchArguments(["Judge"]))
        XCTAssertNil(ScreenshotState.fromLaunchArguments(["Judge", "-JudgeScreenshotState"]))
    }

    /// Debug builds bundle verdicts.json into the app (the tests run inside it).
    func testFixturesLoadFromTheAppBundle() throws {
        let session = try XCTUnwrap(ScreenshotFixtures.session("win_a_self"))
        XCTAssertEqual(session.id, "abc123DEF0")
        XCTAssertNotNil(session.translations[.tr], "the fixture translation is attached")
        XCTAssertNotNil(ScreenshotFixtures.session("overturned_tr"))
        XCTAssertNil(ScreenshotFixtures.session("no_such_sample"))
    }

    @MainActor
    func testVerdictStateOpensTheVerdictWithoutNetwork() throws {
        let state = try XCTUnwrap(ScreenshotState.parse("verdict/win_b_named:en"))
        let container = HistoryContainer.inMemory()
        withExtendedLifetime(container) {
            let app = state.makeModel(container: container)
            XCTAssertEqual(app.home.path, [.verdict(id: "winB000001")])
            XCTAssertNotNil(app.home.session("winB000001"))
            XCTAssertEqual(app.config.apiBaseURL.host, "127.0.0.1")
            XCTAssertFalse(app.persistsDraft)
            XCTAssertEqual(app.lang, .en)
        }
    }

    @MainActor
    func testHistoryStateFillsAnInMemoryStore() throws {
        let state = try XCTUnwrap(ScreenshotState.parse("history:tr"))
        // The store's context needs its container alive (as JudgeApp keeps it).
        let container = HistoryContainer.inMemory()
        try withExtendedLifetime(container) {
            let app = state.makeModel(container: container)
            let rows = try app.history.all()
            XCTAssertEqual(rows.map(\.id).first, "abc123DEF0")
            XCTAssertEqual(rows.count, 6)
            XCTAssertEqual(app.lang, .tr)
        }
    }
}
#endif
