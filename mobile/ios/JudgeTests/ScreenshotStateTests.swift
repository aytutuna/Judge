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
        XCTAssertEqual(ScreenshotState.parse("signin:en")?.screen, .signIn)
        XCTAssertEqual(ScreenshotState.parse("signin-code:tr")?.screen, .signInCode)
        XCTAssertEqual(ScreenshotState.parse("signin:tr")?.tab, .new)
        XCTAssertEqual(ScreenshotState.parse("account:en")?.screen, .account)
        XCTAssertEqual(ScreenshotState.parse("account:en")?.tab, .settings)
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
    func testSignInStatesOpenTheSheetWithoutNetwork() throws {
        let container = HistoryContainer.inMemory()
        try withExtendedLifetime(container) {
            let signIn = try XCTUnwrap(ScreenshotState.parse("signin:en")).makeModel(container: container)
            XCTAssertTrue(signIn.account.isSignInPresented)
            XCTAssertFalse(signIn.account.isSignedIn)
            XCTAssertFalse(signIn.account.usesNetwork)
            XCTAssertEqual(signIn.account.signInProviders?.apple, true)
            XCTAssertEqual(signIn.account.step, .choose)

            let code = try XCTUnwrap(ScreenshotState.parse("signin-code:tr")).makeModel(container: container)
            XCTAssertTrue(code.account.isSignInPresented)
            XCTAssertEqual(code.account.step, .code(email: "sam@example.com"))
            XCTAssertEqual(code.lang, .tr)
        }
    }

    @MainActor
    func testAccountStateIsSignedInWithoutAToken() throws {
        let container = HistoryContainer.inMemory()
        try withExtendedLifetime(container) {
            let app = try XCTUnwrap(ScreenshotState.parse("account:en")).makeModel(container: container)
            XCTAssertTrue(app.account.isSignedIn)
            XCTAssertEqual(app.account.user?.email, "sam@example.com")
            XCTAssertEqual(app.account.entitlement?.isPremium, false)
            XCTAssertFalse(app.account.isSignInPresented)
            XCTAssertNil(app.api.tokenStore.token(), "screenshots never hold a real token")
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

    func testParsesThePremiumScreens() {
        XCTAssertEqual(ScreenshotState.parse("tier/locked:en")?.screen, .tierLocked)
        XCTAssertEqual(ScreenshotState.parse("tier/premium:tr")?.screen, .tierPremium)
        XCTAssertEqual(ScreenshotState.parse("pricing:en")?.screen, .pricing)
        XCTAssertEqual(ScreenshotState.parse("clarify:en")?.screen, .clarify)
        XCTAssertEqual(ScreenshotState.parse("evidence:tr")?.screen, .evidence)
        XCTAssertEqual(ScreenshotState.parse("judging-premium:en")?.screen, .judgingPremium)
        XCTAssertEqual(ScreenshotState.parse("pricing:en")?.tab, .new)
        XCTAssertNil(ScreenshotState.parse("tier:en"))
    }

    @MainActor
    func testPremiumStatesNeedNoNetwork() throws {
        let container = HistoryContainer.inMemory()
        try withExtendedLifetime(container) {
            let locked = try XCTUnwrap(ScreenshotState.parse("tier/locked:en")).makeModel(container: container)
            XCTAssertEqual(locked.tierAvailability, .locked)
            XCTAssertEqual(locked.tierChoice, .premium)
            XCTAssertEqual(locked.effectiveTier, .free)
            XCTAssertEqual(locked.account.entitlement?.blockedReason, "fair_use")
            XCTAssertNil(locked.api.tokenStore.token(), "screenshots never hold a real token")

            let premium = try XCTUnwrap(ScreenshotState.parse("tier/premium:en")).makeModel(container: container)
            XCTAssertEqual(premium.effectiveTier, .premium)
            XCTAssertTrue(premium.evidenceOn)

            let pricing = try XCTUnwrap(ScreenshotState.parse("pricing:tr")).makeModel(container: container)
            XCTAssertEqual(pricing.home.path, [.pricing])
            XCTAssertEqual(pricing.account.pricing.packs.count, 2)

            let clarify = try XCTUnwrap(ScreenshotState.parse("clarify:en")).makeModel(container: container)
            XCTAssertEqual(clarify.home.clarify?.questions.count, 2)
            let clarifyTr = try XCTUnwrap(ScreenshotState.parse("clarify:tr")).makeModel(container: container)
            XCTAssertEqual(clarifyTr.home.clarify?.questions.count, 2)

            let evidence = try XCTUnwrap(ScreenshotState.parse("evidence:en")).makeModel(container: container)
            XCTAssertEqual(evidence.home.evidence.items.map(\.status), [.ok, .reading, .unreadable])
            XCTAssertNotNil(evidence.home.evidence.items.first?.preview)

            let judging = try XCTUnwrap(ScreenshotState.parse("judging-premium:en")).makeModel(container: container)
            XCTAssertTrue(judging.home.isJudging)
            XCTAssertTrue(judging.home.judgingPremium)
        }
    }
}
#endif
