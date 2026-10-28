import Foundation
import XCTest
@testable import Judge

/// The store, faked: records what the app asked for and answers as told.
@MainActor
final class FakePurchaseGateway: PurchaseGateway {
    var offerList: [StoreOffer] = []
    var offersError: (any Error)?
    var outcome: Result<PurchaseOutcome, any Error> = .success(.purchased)
    var restoreAnswer: Result<Bool, any Error> = .success(true)
    var logInError: (any Error)?
    /// Makes the store report another user than the one logged in.
    var storeUserOverride: String?
    private(set) var logIns: [String] = []
    private(set) var logOuts = 0
    private(set) var offerCalls = 0
    private(set) var bought: [String] = []
    private(set) var restores = 0
    /// The store user at each purchase (nil = anonymous).
    private(set) var userAtPurchase: [String?] = []
    private var currentUser: String?

    func logIn(userId: String) async throws {
        if let logInError { throw logInError }
        logIns.append(userId)
        currentUser = userId
    }

    func logOut() async {
        logOuts += 1
        currentUser = nil
    }

    func isLoggedIn(as userId: String) -> Bool {
        (storeUserOverride ?? currentUser) == userId
    }

    func offers() async throws -> [StoreOffer] {
        offerCalls += 1
        if let offersError { throw offersError }
        return offerList
    }

    func purchase(planId: String) async throws -> PurchaseOutcome {
        bought.append(planId)
        userAtPurchase.append(currentUser)
        return try outcome.get()
    }

    func restore() async throws -> Bool {
        restores += 1
        return try restoreAnswer.get()
    }
}

/// Answers /api/v1/me with the given credit balances in turn (the last one
/// repeats); anything else fails like a dead network.
private final class MeSequence: @unchecked Sendable {
    private let lock = NSLock()
    private var credits: [Int]

    init(_ credits: [Int]) {
        self.credits = credits
    }

    func reply(to request: URLRequest) -> StubURLProtocol.Reply {
        guard request.url?.path == "/api/v1/me" else {
            return StubURLProtocol.Reply(error: URLError(.notConnectedToInternet))
        }
        let value: Int = lock.withLock {
            credits.count > 1 ? credits.removeFirst() : (credits.first ?? 0)
        }
        let body: [String: Any] = [
            "user": ["id": "u1", "email": "ann@example.com", "name": "Ann", "image": NSNull()] as [String: Any],
            "entitlement": [
                "canUsePremium": value > 0, "blockedReason": NSNull(), "credits": value,
                "subscription": NSNull(), "resetsAt": NSNull(),
            ] as [String: Any],
        ]
        let data = (try? JSONSerialization.data(withJSONObject: body)) ?? Data()
        return StubURLProtocol.Reply(status: 200, headers: ["Content-Type": "application/json"], body: data)
    }
}

final class PurchaseTests: XCTestCase {
    override func setUp() {
        super.setUp()
        StubURLProtocol.handler = nil
        StubURLProtocol.requests = []
    }

    override func tearDown() {
        StubURLProtocol.handler = nil
        super.tearDown()
    }

    private static let offers = [
        StoreOffer(planId: "pack_1", productId: "pack_1", price: "$1.00", amount: Decimal(100) / 100, currencyCode: "USD"),
        StoreOffer(planId: "pack_10", productId: "pack_10", price: "$7.50", amount: Decimal(750) / 100, currencyCode: "USD"),
        StoreOffer(planId: "monthly", productId: "monthly", price: "$15.00", amount: Decimal(1500) / 100, currencyCode: "USD"),
    ]

    private static func pricing(enabled: Bool) -> PricingInfo {
        var pricing = PricingInfo.fallback
        pricing.purchasesEnabled = enabled
        return pricing
    }

    private static func info(credits: Int) -> AccountInfo {
        AccountInfo(
            user: Viewer(id: "u1", email: "ann@example.com", name: "Ann"),
            entitlement: Entitlement(canUsePremium: credits > 0, credits: credits)
        )
    }

    private static func api(token: String? = "s3ss10n") -> JudgeAPI {
        JudgeAPI(
            baseURL: AppConfig.production,
            userAgent: "Judge-iOS/test",
            tokenStore: MemoryTokenStore(token: token),
            session: JudgeAPI.makeSession(protocolClasses: [StubURLProtocol.self])
        )
    }

    /// A signed-in account (0 credits) on a server that allows purchases,
    /// with a purchase model whose /me polling does not wait.
    @MainActor
    private func model(_ gateway: FakePurchaseGateway?, me credits: [Int] = [0], balanceKnown: Bool = true) -> (PurchaseModel, AccountModel) {
        let sequence = MeSequence(credits)
        StubURLProtocol.handler = { sequence.reply(to: $0) }
        let account = AccountModel(api: Self.api())
        var info = Self.info(credits: 0)
        if !balanceKnown { info.entitlement = nil }
        account.preload(config: ServerConfig(signIn: SignInProviders(apple: true), premiumEnabled: true, pricing: Self.pricing(enabled: true)), info: info)
        let purchases = PurchaseModel(gateway: gateway, account: account)
        purchases.pollDelays = [.zero, .zero, .zero, .zero]
        purchases.sleep = { _ in }
        return (purchases, account)
    }

    private var meRequests: Int {
        StubURLProtocol.requests.filter { $0.url?.path == "/api/v1/me" }.count
    }

    // MARK: - Offers and labels

    @MainActor
    func testStoreOffersBecomeButtonLabels() async {
        let gateway = FakePurchaseGateway()
        gateway.offerList = Self.offers
        let (purchases, _) = model(gateway)
        let pricing = Self.pricing(enabled: true)

        await purchases.loadOffers(pricing: pricing)
        XCTAssertEqual(purchases.loadState, .loaded)
        XCTAssertTrue(purchases.canPurchase(pricing))

        XCTAssertEqual(
            purchases.labels(planId: "pack_10", usd: 7.5, credits: 10, pricing: pricing, lang: .en),
            PurchaseModel.OfferLabels(price: "$7.50", perVerdict: "$0.75", button: "$7.50", purchasable: true)
        )
        XCTAssertEqual(
            purchases.labels(planId: "monthly", usd: 15, credits: nil, pricing: pricing, lang: .en),
            PurchaseModel.OfferLabels(price: "$15.00", perVerdict: nil, button: "$15.00", purchasable: true)
        )
        XCTAssertNotNil(purchases.labels(planId: "pack_1", usd: 1, credits: 1, pricing: pricing, lang: .tr).perVerdict)

        // The server switching purchases off brings back "Coming soon".
        let off = Self.pricing(enabled: false)
        let comingSoon = purchases.labels(planId: "pack_10", usd: 7.5, credits: 10, pricing: off, lang: .en)
        XCTAssertFalse(comingSoon.purchasable)
        XCTAssertEqual(comingSoon.button, L10n.pricingComingSoon(.en))
        XCTAssertEqual(comingSoon.price, PricingInfo.format(7.5, lang: .en))
    }

    @MainActor
    func testLoadFailureSetsADiagnosticAndSuccessClearsIt() async {
        let gateway = FakePurchaseGateway()
        gateway.offersError = NSError(domain: "Store", code: 7, userInfo: [
            NSLocalizedDescriptionKey: "no products",
            NSUnderlyingErrorKey: NSError(domain: "StoreKit", code: 2, userInfo: [NSLocalizedDescriptionKey: "unavailable"]),
        ])
        let (purchases, _) = model(gateway)
        let pricing = Self.pricing(enabled: true)
        await purchases.loadOffers(pricing: pricing)
        XCTAssertEqual(purchases.diagnostic, "no products (Store 7); underlying: unavailable (StoreKit 2)")

        gateway.offersError = nil
        gateway.offerList = Self.offers
        await purchases.loadOffers(pricing: pricing)
        XCTAssertNil(purchases.diagnostic)
    }

    @MainActor
    func testNoMatchingPlansListsTheProductIds() async {
        let gateway = FakePurchaseGateway()
        gateway.offersError = PurchaseGatewayError.noMatch(seen: ["com.x.one", "com.x.two"])
        let (purchases, _) = model(gateway)
        await purchases.loadOffers(pricing: Self.pricing(enabled: true))
        XCTAssertEqual(purchases.loadState, .failed)
        XCTAssertEqual(purchases.diagnostic, "store returned 2 packages: com.x.one, com.x.two, matched none")
    }

    @MainActor
    func testAPlanMissingFromTheOfferingStaysComingSoon() async {
        let gateway = FakePurchaseGateway()
        gateway.offerList = [Self.offers[1]]
        let (purchases, _) = model(gateway)
        let pricing = Self.pricing(enabled: true)
        await purchases.loadOffers(pricing: pricing)
        XCTAssertTrue(purchases.labels(planId: "pack_10", usd: 7.5, credits: 10, pricing: pricing, lang: .en).purchasable)
        XCTAssertFalse(purchases.labels(planId: "pack_1", usd: 1, credits: 1, pricing: pricing, lang: .en).purchasable)
        XCTAssertFalse(purchases.labels(planId: "monthly", usd: 15, credits: nil, pricing: pricing, lang: .en).purchasable)
    }

    @MainActor
    func testOffersLoadOnlyWhenTheServerAllowsPurchases() async {
        let gateway = FakePurchaseGateway()
        gateway.offerList = Self.offers
        let (purchases, _) = model(gateway)
        await purchases.loadOffers(pricing: Self.pricing(enabled: false))
        XCTAssertEqual(gateway.offerCalls, 0)
        XCTAssertFalse(purchases.canPurchase(Self.pricing(enabled: true)))

        await purchases.loadOffers(pricing: Self.pricing(enabled: true))
        await purchases.loadOffers(pricing: Self.pricing(enabled: true))
        XCTAssertEqual(gateway.offerCalls, 1, "loaded once")
    }

    @MainActor
    func testFailedOrEmptyOfferingsRetryLater() async {
        let gateway = FakePurchaseGateway()
        gateway.offersError = URLError(.notConnectedToInternet)
        let (purchases, _) = model(gateway)
        let pricing = Self.pricing(enabled: true)
        await purchases.loadOffers(pricing: pricing)
        XCTAssertEqual(purchases.loadState, .failed)
        XCTAssertFalse(purchases.canPurchase(pricing))

        gateway.offersError = nil
        await purchases.loadOffers(pricing: pricing)
        XCTAssertEqual(purchases.loadState, .idle, "an empty offering is tried again")
        XCTAssertFalse(purchases.canPurchase(pricing))

        gateway.offerList = Self.offers
        await purchases.loadOffers(pricing: pricing)
        XCTAssertEqual(gateway.offerCalls, 3)
        XCTAssertTrue(purchases.canPurchase(pricing))
    }

    func testCatalogMatchesTheProductsTheServerGrants() {
        let found = StoreCatalog.match([
            .init(packageId: "$rc_monthly", productId: "monthly"),
            .init(packageId: "ten", productId: "pack_10"),
            .init(packageId: "pack_10", productId: "pack_10"),
            .init(packageId: "pack_1", productId: "com.example.unknown"),
            .init(packageId: "thirty", productId: "pack_30"),
            .init(packageId: "old", productId: "verdict_credits_10"),
        ])
        XCTAssertEqual(found["monthly"]?.packageId, "$rc_monthly")
        XCTAssertEqual(found["pack_10"]?.packageId, "pack_10", "the package named after the plan wins")
        XCTAssertNil(found["pack_1"], "a product the server cannot grant is not sold")
        XCTAssertEqual(found.count, 2, "retired product ids are not sold")
        XCTAssertEqual(Set(StoreCatalog.productPlans.values), Set(StoreCatalog.planIds))
    }

    // MARK: - Buying

    @MainActor
    func testPurchasePollsMeUntilTheCreditsArrive() async {
        let gateway = FakePurchaseGateway()
        gateway.offerList = Self.offers
        let (purchases, account) = model(gateway, me: [0, 0, 10])
        await purchases.loadOffers(pricing: Self.pricing(enabled: true))

        await purchases.buy("pack_10")
        XCTAssertEqual(gateway.bought, ["pack_10"])
        XCTAssertEqual(gateway.userAtPurchase, ["u1"], "the store buys as the signed-in Judge user")
        XCTAssertEqual(purchases.message, .success)
        XCTAssertNil(purchases.buying)
        XCTAssertEqual(account.entitlement?.credits, 10, "the balance comes from /me")
        XCTAssertEqual(meRequests, 3, "stops asking once the credits changed")
    }

    @MainActor
    func testPurchaseWithoutAKnownBalanceTakesOneFirst() async {
        let gateway = FakePurchaseGateway()
        gateway.offerList = Self.offers
        let (purchases, account) = model(gateway, me: [7, 7, 17], balanceKnown: false)
        await purchases.loadOffers(pricing: Self.pricing(enabled: true))

        await purchases.buy("pack_10")
        XCTAssertEqual(purchases.message, .success)
        XCTAssertEqual(account.entitlement?.credits, 17)
        XCTAssertEqual(meRequests, 3, "one for the balance before, two polls; the old balance is not taken for the grant")
    }

    @MainActor
    func testNoPurchaseWhenTheStoreHoldsAnotherUser() async {
        let gateway = FakePurchaseGateway()
        gateway.offerList = Self.offers
        gateway.storeUserOverride = "someone-else"
        let (purchases, _) = model(gateway)
        await purchases.loadOffers(pricing: Self.pricing(enabled: true))

        await purchases.buy("pack_10")
        XCTAssertEqual(gateway.bought, [])
        XCTAssertEqual(purchases.message, .failed)

        await purchases.restore()
        XCTAssertEqual(gateway.restores, 0)
        XCTAssertEqual(purchases.restoreResult, .failed)
    }

    @MainActor
    func testOldMessagesAreClearedWhenTheScreenCloses() async {
        let gateway = FakePurchaseGateway()
        gateway.offerList = Self.offers
        gateway.outcome = .failure(URLError(.timedOut))
        let (purchases, _) = model(gateway)
        await purchases.loadOffers(pricing: Self.pricing(enabled: true))
        await purchases.buy("pack_10")
        XCTAssertEqual(purchases.message, .failed)
        purchases.clearMessage()
        XCTAssertNil(purchases.message)

        gateway.restoreAnswer = .success(false)
        await purchases.restore()
        XCTAssertEqual(purchases.restoreResult, .nothing)
        purchases.clearRestoreResult()
        XCTAssertNil(purchases.restoreResult)
    }

    @MainActor
    func testThePaymentNoteGoesOnlyWhenEveryPlanIsSold() async {
        let gateway = FakePurchaseGateway()
        gateway.offerList = Array(Self.offers.prefix(2))
        let (purchases, _) = model(gateway)
        let pricing = Self.pricing(enabled: true)
        await purchases.loadOffers(pricing: pricing)
        XCTAssertTrue(purchases.canPurchase(pricing))
        XCTAssertFalse(purchases.sellsEveryPlan(pricing))
        gateway.offerList = Self.offers
        let (all, _) = model(gateway)
        await all.loadOffers(pricing: pricing)
        XCTAssertTrue(all.sellsEveryPlan(pricing))
    }

    @MainActor
    func testPurchaseWithoutAGrantSaysItMayTakeAMinute() async {
        let gateway = FakePurchaseGateway()
        gateway.offerList = Self.offers
        let (purchases, account) = model(gateway, me: [0])
        await purchases.loadOffers(pricing: Self.pricing(enabled: true))

        await purchases.buy("monthly")
        XCTAssertEqual(purchases.message, .pending)
        XCTAssertEqual(meRequests, 4)
        XCTAssertEqual(account.entitlement?.credits, 0)
    }

    @MainActor
    func testCancelledPurchaseSaysNothing() async {
        let gateway = FakePurchaseGateway()
        gateway.offerList = Self.offers
        gateway.outcome = .success(.cancelled)
        let (purchases, _) = model(gateway)
        await purchases.loadOffers(pricing: Self.pricing(enabled: true))

        await purchases.buy("pack_1")
        XCTAssertNil(purchases.message)
        XCTAssertNil(purchases.buying)
        XCTAssertEqual(meRequests, 0)
    }

    @MainActor
    func testFailedPurchaseShowsTheGenericError() async {
        let gateway = FakePurchaseGateway()
        gateway.offerList = Self.offers
        gateway.outcome = .failure(URLError(.timedOut))
        let (purchases, _) = model(gateway)
        await purchases.loadOffers(pricing: Self.pricing(enabled: true))

        await purchases.buy("pack_10")
        XCTAssertEqual(purchases.message, .failed)
        XCTAssertNil(purchases.buying)
        XCTAssertEqual(meRequests, 0)
        XCTAssertEqual(PurchaseModel.Message.failed.text(.en), PurchaseStrings.failed(.en))
    }

    @MainActor
    func testStoreLoginFailureStopsThePurchase() async {
        let gateway = FakePurchaseGateway()
        gateway.offerList = Self.offers
        gateway.logInError = URLError(.notConnectedToInternet)
        let (purchases, _) = model(gateway)
        await purchases.loadOffers(pricing: Self.pricing(enabled: true))

        await purchases.buy("pack_10")
        XCTAssertEqual(purchases.message, .failed)
        XCTAssertEqual(gateway.bought, [], "never buys as an anonymous store user")
    }

    @MainActor
    func testAskToBuyIsPending() async {
        let gateway = FakePurchaseGateway()
        gateway.offerList = Self.offers
        gateway.outcome = .success(.pending)
        let (purchases, _) = model(gateway)
        await purchases.loadOffers(pricing: Self.pricing(enabled: true))

        await purchases.buy("pack_10")
        XCTAssertEqual(purchases.message, .pending)
        XCTAssertEqual(meRequests, 0)
    }

    func testGrantDetection() {
        let zero = Entitlement(credits: 0)
        XCTAssertFalse(PurchaseModel.granted(before: zero, after: zero))
        XCTAssertTrue(PurchaseModel.granted(before: zero, after: Entitlement(credits: 10)))
        XCTAssertTrue(PurchaseModel.granted(before: Entitlement(credits: 7), after: Entitlement(credits: 6)))
        let subscription = SubscriptionInfo(
            source: "app_store", productId: "monthly", periodStart: "2026-10-01T00:00:00.000Z",
            periodEnd: "2026-10-31T00:00:00.000Z", willRenew: true, used: 0, cap: 35
        )
        XCTAssertTrue(PurchaseModel.granted(before: zero, after: Entitlement(credits: 0, subscription: subscription)))
    }

    // MARK: - Restore

    @MainActor
    func testRestoreReportsWhatCameBack() async {
        let gateway = FakePurchaseGateway()
        let (purchases, _) = model(gateway)

        await purchases.restore()
        XCTAssertEqual(purchases.restoreResult, .done)
        XCTAssertEqual(gateway.logIns, ["u1"])
        XCTAssertEqual(meRequests, 1, "/me shows what the server granted")

        gateway.restoreAnswer = .success(false)
        await purchases.restore()
        XCTAssertEqual(purchases.restoreResult, .nothing)

        gateway.restoreAnswer = .failure(URLError(.notConnectedToInternet))
        await purchases.restore()
        XCTAssertEqual(purchases.restoreResult, .failed)
        XCTAssertEqual(gateway.restores, 3)
        XCTAssertEqual(gateway.logIns, ["u1"], "logged in once")
        XCTAssertFalse(purchases.isRestoring)
    }

    // MARK: - Store identity

    @MainActor
    func testStoreLogsInAndOutWithTheSession() async throws {
        StubURLProtocol.handler = { MeSequence([3]).reply(to: $0) }
        let gateway = FakePurchaseGateway()
        let container = HistoryContainer.inMemory()
        let defaults = try XCTUnwrap(UserDefaults(suiteName: "judge.tests.\(UUID().uuidString)"))
        let config = AppConfig(apiBaseURL: AppConfig.production, shareBaseURL: AppConfig.production, version: "1", build: "1")
        let app = AppModel(
            config: config, container: container, defaults: defaults, persistsDraft: false,
            api: Self.api(), caseNames: MemoryCaseNamesStore(), purchaseGateway: gateway
        )
        XCTAssertTrue(app.purchases.isConfigured)

        await app.account.refresh()
        try await PremiumFixtures.waitUntil("store log-in") { gateway.logIns == ["u1"] }
        XCTAssertEqual(app.purchases.loggedInUserId, "u1")

        await app.account.refresh()
        try await Task.sleep(for: .milliseconds(50))
        XCTAssertEqual(gateway.logIns, ["u1"], "the same user is not logged in twice")

        await app.account.signOut()
        try await PremiumFixtures.waitUntil("store log-out") { gateway.logOuts == 1 }
        XCTAssertNil(app.purchases.loggedInUserId)
        // The history store's context needs its container alive until here.
        withExtendedLifetime(container) {}
    }

    // MARK: - No key

    func testBlankOrUnexpandedKeysMeanNoPurchases() {
        XCTAssertEqual(AppConfig.publicKey("$(REVENUECAT_API_KEY)"), "")
        XCTAssertEqual(AppConfig.publicKey("   "), "")
        XCTAssertEqual(AppConfig.publicKey(" appl_abc123 "), "appl_abc123")
    }

    @MainActor
    func testWithoutAKeyPurchasesStayOff() async throws {
        let container = HistoryContainer.inMemory()
        let defaults = try XCTUnwrap(UserDefaults(suiteName: "judge.tests.\(UUID().uuidString)"))
        let config = AppConfig(apiBaseURL: AppConfig.production, shareBaseURL: AppConfig.production, version: "1", build: "1")
        XCTAssertEqual(config.revenueCatAPIKey, "")
        let app = AppModel(config: config, container: container, defaults: defaults, tokenStore: MemoryTokenStore(), persistsDraft: false)
        let pricing = Self.pricing(enabled: true)
        XCTAssertFalse(app.purchases.isConfigured)
        XCTAssertFalse(app.purchases.canRestore(pricing))
        await app.purchases.loadOffers(pricing: pricing)
        XCTAssertEqual(app.purchases.loadState, .idle)
        XCTAssertFalse(app.purchases.canPurchase(pricing))
        let labels = app.purchases.labels(planId: "pack_10", usd: 7.5, credits: 10, pricing: pricing, lang: .en)
        XCTAssertFalse(labels.purchasable)
        XCTAssertEqual(labels.button, L10n.pricingComingSoon(.en))
        await app.purchases.buy("pack_10")
        XCTAssertNil(app.purchases.message)
        withExtendedLifetime(container) {}
    }
}
