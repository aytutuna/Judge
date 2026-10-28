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
        for raw in ["", "home", "home:xx", "verdict/:en", "verdict:en", "nope:en", "home:en:extra"] {
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
    func testVerdictStateOpensTheSavedVerdictWithoutNetwork() throws {
        let state = try XCTUnwrap(ScreenshotState.parse("verdict/win_b_named:en"))
        let container = HistoryContainer.inMemory()
        try withExtendedLifetime(container) {
            let app = state.makeModel(container: container)
            XCTAssertEqual(app.home.path, [.saved(id: "winB000001")])
            XCTAssertNotNil(try app.history.find(id: "winB000001")?.session())
            XCTAssertEqual(app.config.apiBaseURL.host, "127.0.0.1")
            XCTAssertFalse(app.persistsDraft)
            XCTAssertEqual(app.lang, .en)
        }
    }

    func testParsesTheThreadScreens() {
        XCTAssertEqual(ScreenshotState.parse("home-example:en")?.screen, .homeExample)
        XCTAssertEqual(ScreenshotState.parse("verdict-thread:tr")?.screen, .verdictThread)
        XCTAssertEqual(ScreenshotState.parse("verdict-thread:en")?.tab, .new)
    }

    @MainActor
    func testThreadStatesNeedNoNetwork() throws {
        let container = HistoryContainer.inMemory()
        try withExtendedLifetime(container) {
            let example = try XCTUnwrap(ScreenshotState.parse("home-example:tr")).makeModel(container: container)
            XCTAssertEqual(example.home.argument, ExampleCase.all[0].mine(.tr))
            XCTAssertEqual(example.home.otherSide, ExampleCase.all[0].theirs(.tr))
            XCTAssertEqual(example.home.otherName, ExampleCase.all[0].theirName(.tr))

            let thread = try XCTUnwrap(ScreenshotState.parse("verdict-thread:tr")).makeModel(container: container)
            XCTAssertEqual(thread.home.path, [.verdict(id: "abc123DEF0")])
            XCTAssertNotNil(thread.home.session("abc123DEF0"))

            let judging = try XCTUnwrap(ScreenshotState.parse("judging:en")).makeModel(container: container)
            XCTAssertTrue(judging.home.isJudging)
            let sent = ExampleArgument.all[0].text(.en).trimmingCharacters(in: .whitespacesAndNewlines)
            XCTAssertEqual(judging.home.judgedSides.map(\.text), [sent], "the cover shows what was sent")
        }
    }

    func testParsesTheAddContextScreens() {
        XCTAssertEqual(ScreenshotState.parse("verdict-context:en")?.screen, .verdictContext(blockedBy: nil))
        XCTAssertEqual(ScreenshotState.parse("verdict-context-locked:tr")?.screen, .verdictContext(blockedBy: "premium_required"))
        XCTAssertEqual(ScreenshotState.parse("verdict-context-limit:en")?.screen, .verdictContext(blockedBy: "appeal_limit"))
        XCTAssertEqual(ScreenshotState.parse("verdict-context:tr")?.tab, .new)
    }

    @MainActor
    func testAddContextStatesNeedNoNetwork() throws {
        let container = HistoryContainer.inMemory()
        try withExtendedLifetime(container) {
            let form = try XCTUnwrap(ScreenshotState.parse("verdict-context:en")).makeModel(container: container)
            XCTAssertEqual(form.home.path, [.saved(id: "abc123DEF0")])
            XCTAssertTrue(form.account.isSignedIn)
            XCTAssertFalse(form.usesNetwork)
            XCTAssertEqual(form.appealSeed?.gate, CaseAppealGate(allowed: true))
            XCTAssertEqual(form.appealSeed?.text.isEmpty, false, "the form shows typed context")

            let locked = try XCTUnwrap(ScreenshotState.parse("verdict-context-locked:tr")).makeModel(container: container)
            XCTAssertEqual(locked.appealSeed?.gate.blockedBy, "premium_required")
            XCTAssertEqual(locked.account.entitlement?.canUsePremium, false, "a free account")

            let limit = try XCTUnwrap(ScreenshotState.parse("verdict-context-limit:en")).makeModel(container: container)
            let seed = try XCTUnwrap(limit.appealSeed)
            let session = try XCTUnwrap(try limit.history.find(id: "abc123DEF0")?.session())
            let appeal = VerdictAppealModel(id: session.id, api: limit.api, account: limit.account, shown: { session }) { _ in }
            appeal.showForScreenshot(gate: seed.gate, text: seed.text)
            XCTAssertEqual(appeal.area, .limit)
            XCTAssertTrue(appeal.panel, "the note shows without a tap")
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
            let listed = try app.history.cached(user: try XCTUnwrap(app.historyUser))
            XCTAssertEqual(listed.count, 6, "signed in: every row is the account's, none phone-only")
        }
    }

    func testParsesThePremiumScreens() {
        XCTAssertEqual(ScreenshotState.parse("balance/welcome:en")?.screen, .balanceWelcome)
        XCTAssertEqual(ScreenshotState.parse("balance/none:tr")?.screen, .balanceNone)
        XCTAssertEqual(ScreenshotState.parse("balance/none:tr")?.tab, .new)
        XCTAssertEqual(ScreenshotState.parse("pricing:en")?.screen, .pricing)
        XCTAssertEqual(ScreenshotState.parse("clarify:en")?.screen, .clarify)
        XCTAssertEqual(ScreenshotState.parse("evidence:tr")?.screen, .evidence)
        XCTAssertEqual(ScreenshotState.parse("pricing:en")?.tab, .new)
        XCTAssertEqual(ScreenshotState.parse("pricing-store:tr")?.screen, .pricingStore)
        XCTAssertEqual(ScreenshotState.parse("pricing-store:en")?.tab, .new)
        XCTAssertEqual(ScreenshotState.parse("pricing-buy:tr")?.screen, .pricingBuy)
        XCTAssertEqual(ScreenshotState.parse("pricing-buy:en")?.tab, .new)
        XCTAssertNil(ScreenshotState.parse("tier/locked:en"), "the tier switch is gone")
        XCTAssertNil(ScreenshotState.parse("judging-premium:en"))
    }

    @MainActor
    func testPricingStoreStateShowsStorePricesWithoutNetwork() throws {
        let container = HistoryContainer.inMemory()
        try withExtendedLifetime(container) {
            let app = try XCTUnwrap(ScreenshotState.parse("pricing-store:en")).makeModel(container: container)
            let pricing = app.account.pricing
            XCTAssertEqual(app.home.path, [.pricing])
            XCTAssertTrue(pricing.purchasesEnabled)
            XCTAssertTrue(app.purchases.isConfigured)
            XCTAssertTrue(app.purchases.canPurchase(pricing))
            let pack = app.purchases.labels(planId: "pack_10", usd: 7.5, credits: 10, pricing: pricing, lang: .en)
            XCTAssertEqual(pack.button, "$7.49")
            XCTAssertTrue(pack.purchasable)
            XCTAssertNil(app.api.tokenStore.token(), "screenshots never hold a real token")

            let tr = try XCTUnwrap(ScreenshotState.parse("pricing-store:tr")).makeModel(container: container)
            XCTAssertEqual(tr.purchases.labels(planId: "monthly", usd: 15, credits: nil, pricing: tr.account.pricing, lang: .tr).price, "₺649,99")

            let buy = try XCTUnwrap(ScreenshotState.parse("pricing-buy:en")).makeModel(container: container)
            XCTAssertEqual(buy.home.path, [.pricing])
            XCTAssertTrue(buy.purchases.isConfigured)
            XCTAssertEqual(buy.pricingScroll, PricingView.packsAnchor)
            XCTAssertNil(app.pricingScroll, "the plain store state opens at the top")

            let plain = try XCTUnwrap(ScreenshotState.parse("pricing:en")).makeModel(container: container)
            XCTAssertFalse(plain.purchases.isConfigured, "the plain pricing state keeps Coming soon")
        }
    }

    @MainActor
    func testPremiumStatesNeedNoNetwork() throws {
        let container = HistoryContainer.inMemory()
        try withExtendedLifetime(container) {
            let none = try XCTUnwrap(ScreenshotState.parse("balance/none:en")).makeModel(container: container)
            XCTAssertEqual(none.account.entitlement?.blockedReason, "fair_use")
            XCTAssertEqual(none.account.entitlement.map(Balance.init), .empty)
            XCTAssertEqual(none.home.initialScroll, HomeModel.submitAnchor)
            XCTAssertNil(none.api.tokenStore.token(), "screenshots never hold a real token")

            let welcome = try XCTUnwrap(ScreenshotState.parse("balance/welcome:en")).makeModel(container: container)
            XCTAssertEqual(welcome.account.entitlement.map(Balance.init), .credits(1))
            XCTAssertTrue(welcome.evidenceOn)
            XCTAssertTrue(welcome.casesOn)

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

        }
    }

    func testParsesTheCaseScreens() {
        XCTAssertEqual(ScreenshotState.parse("case/awaiting:en")?.screen, .caseDetail(view: "waiting_for_respondent"))
        XCTAssertEqual(ScreenshotState.parse("case/appeal:tr")?.screen, .caseDetail(view: "appeal_overturned"))
        XCTAssertEqual(ScreenshotState.parse("case/judged:en")?.screen, .caseDetail(view: "judged"))
        XCTAssertEqual(ScreenshotState.parse("case/judged:en")?.tab, .new)
        XCTAssertEqual(ScreenshotState.parse("history-cases:en")?.tab, .history)
        XCTAssertEqual(ScreenshotState.parse("history-select:tr")?.screen, .historySelect)
        XCTAssertEqual(ScreenshotState.parse("history-select:tr")?.tab, .history)
        XCTAssertEqual(ScreenshotState.parse("mode-both:en")?.screen, .modeBoth)
        XCTAssertNil(ScreenshotState.parse("case/:en"))
    }

    @MainActor
    func testCaseStatesNeedNoNetwork() throws {
        let container = HistoryContainer.inMemory()
        try withExtendedLifetime(container) {
            for name in ["awaiting", "judging", "judged", "failed", "expired", "removed", "appeal", "one-sided"] {
                let app = try XCTUnwrap(ScreenshotState.parse("case/\(name):en")).makeModel(container: container)
                XCTAssertEqual(app.home.path, [.caseDetail(id: "case0000001")], name)
                let page = app.makeCaseModel(id: "case0000001")
                XCTAssertNotNil(page.view, name)
                XCTAssertFalse(page.usesNetwork, name)
            }
            let tr = try XCTUnwrap(ScreenshotState.parse("case/judged:tr")).makeModel(container: container)
            XCTAssertEqual(tr.makeCaseModel(id: "case0000001").view?.lang, .tr, "Turkish takes the Turkish view")

            let list = try XCTUnwrap(ScreenshotState.parse("history-cases:en")).makeModel(container: container)
            let user = try XCTUnwrap(list.historyUser)
            XCTAssertEqual(try list.history.cached(user: user).count, 7, "the fixture page is listed")
            XCTAssertNotNil(list.historyList.next, "with Show more under it")
            XCTAssertFalse(list.historyList.usesNetwork)
            let phone = try XCTUnwrap(try list.history.find(id: "winB000001"), "and one verdict only on this phone")
            XCTAssertNil(phone.ownerUserID)

            let select = try XCTUnwrap(ScreenshotState.parse("history-select:en")).makeModel(container: container)
            XCTAssertEqual(select.historySelectionSeed, ["c:case0000010", "v:verdict0021"])
            let rows = try select.history.cached(user: try XCTUnwrap(select.historyUser))
            XCTAssertTrue(rows.filter { ["c:case0000010", "v:verdict0021"].contains($0.key) }.allSatisfy(\.removable), "the picked rows can be removed")

            let both = try XCTUnwrap(ScreenshotState.parse("mode-both:en")).makeModel(container: container)
            XCTAssertTrue(both.home.isTwoSided(both))
        }
    }
}
#endif
