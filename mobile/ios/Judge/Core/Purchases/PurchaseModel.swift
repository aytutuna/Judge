import Foundation
import Observation

/// In-app purchases on the pricing screen and "Restore purchases" in
/// Settings. The store only sells: credits and the subscription reach the
/// account through the server (the store's webhook), so after a purchase
/// this asks GET /api/v1/me again until the new balance shows.
///
/// Off (no gateway) when no RevenueCat key is configured; the pricing
/// screen then keeps "Coming soon".
@MainActor
@Observable
final class PurchaseModel {
    /// What the pricing screen says after a purchase.
    enum Message: Equatable {
        case success
        /// Bought, but the server has not granted it yet (or the store is
        /// waiting on Ask to Buy).
        case pending
        case failed
    }

    enum RestoreResult: Equatable {
        case done, nothing, failed
    }

    enum LoadState: Equatable {
        case idle, loading, loaded, failed
    }

    /// Store offers by plan id (`pack_1`, `pack_10`, `monthly`).
    private(set) var offers: [String: StoreOffer] = [:]
    private(set) var loadState: LoadState = .idle
    /// The plan being bought while the store sheet is up.
    private(set) var buying: String?
    private(set) var message: Message?
    private(set) var isRestoring = false
    private(set) var restoreResult: RestoreResult?

    let gateway: (any PurchaseGateway)?
    private let account: AccountModel
    /// Waits between the /me checks after a purchase, about 10 s in all.
    @ObservationIgnored var pollDelays: [Duration] = [.seconds(1), .seconds(2), .seconds(3), .seconds(4)]
    @ObservationIgnored var sleep: @Sendable (Duration) async throws -> Void = { try await Task.sleep(for: $0) }
    /// The Judge user id the store was last logged in with.
    @ObservationIgnored private(set) var loggedInUserId: String?
    @ObservationIgnored private var login: (id: String, task: Task<Void, any Error>)?
    /// The last store log-in or log-out; the next one waits for it, so they
    /// reach the store in order.
    @ObservationIgnored private var storeQueue: Task<Void, Never>?
    /// Bumped by every purchase and sign-out, so an older /me poll stops.
    @ObservationIgnored private var generation = 0

    init(gateway: (any PurchaseGateway)?, account: AccountModel) {
        self.gateway = gateway
        self.account = account
    }

    /// A RevenueCat key is configured.
    var isConfigured: Bool { gateway != nil }

    /// The server allows purchases, a key is configured and the store's
    /// offering has loaded.
    func canPurchase(_ pricing: PricingInfo) -> Bool {
        pricing.purchasesEnabled && isConfigured && !offers.isEmpty
    }

    /// Every plan on the pricing screen has a store offer (the note about
    /// payments not being open yet can go).
    func sellsEveryPlan(_ pricing: PricingInfo) -> Bool {
        guard canPurchase(pricing) else { return false }
        let plans = pricing.packs.map { $0.id } + [pricing.monthly.id]
        return plans.allSatisfy { offers[$0] != nil }
    }

    /// The store offer behind a plan's buy button, or nil for "Coming soon".
    func offer(for planId: String, pricing: PricingInfo) -> StoreOffer? {
        canPurchase(pricing) ? offers[planId] : nil
    }

    /// "Restore purchases" in Settings.
    func canRestore(_ pricing: PricingInfo) -> Bool {
        pricing.purchasesEnabled && isConfigured
    }

    /// What one offer on the pricing screen shows.
    struct OfferLabels: Equatable {
        /// The price beside the name.
        var price: String
        /// Packs: the price of one verdict.
        var perVerdict: String?
        /// The buy button's title.
        var button: String
        var purchasable: Bool
    }

    /// Store prices when the store can sell this plan, else the server's
    /// USD prices and "Coming soon".
    func labels(planId: String, usd: Double, credits: Int?, pricing: PricingInfo, lang: AppLang) -> OfferLabels {
        if let store = offer(for: planId, pricing: pricing) {
            return OfferLabels(
                price: store.price,
                perVerdict: credits.flatMap { store.perVerdict(credits: $0, lang: lang) },
                button: buying == planId ? PurchaseStrings.buying(lang) : store.price,
                purchasable: true
            )
        }
        return OfferLabels(
            price: PricingInfo.format(usd, lang: lang),
            perVerdict: credits.map { PricingInfo.format(usd / Double(Swift.max(1, $0)), lang: lang) },
            button: L10n.pricingComingSoon(lang),
            purchasable: false
        )
    }

    // MARK: - Offers

    /// Loads the store's prices once (again after a failure or an empty
    /// offering).
    func loadOffers(pricing: PricingInfo) async {
        guard pricing.purchasesEnabled, let gateway, loadState == .idle || loadState == .failed else { return }
        loadState = .loading
        do {
            let list = try await gateway.offers()
            offers = Dictionary(list.map { ($0.planId, $0) }, uniquingKeysWith: { first, _ in first })
            loadState = offers.isEmpty ? .idle : .loaded
        } catch {
            loadState = .failed
        }
    }

    // MARK: - Buying

    /// Buys a plan: the store sheet, then a short confirmation while /me is
    /// asked again until the grant shows. Cancelling says nothing.
    func buy(_ planId: String) async {
        guard let gateway, buying == nil, account.isSignedIn else { return }
        generation += 1
        let mine = generation
        buying = planId
        message = nil
        restoreResult = nil
        let outcome: PurchaseOutcome
        let before: Entitlement?
        do {
            try await logInCurrentUser(generation: mine)
            // A real balance to compare the grant against.
            if account.entitlement == nil { await account.refresh() }
            before = account.entitlement
            try checkStoreUser(generation: mine)
            outcome = try await gateway.purchase(planId: planId)
        } catch {
            buying = nil
            if mine == generation { message = .failed }
            return
        }
        buying = nil
        guard mine == generation else { return }
        switch outcome {
        case .cancelled:
            return
        case .pending:
            message = .pending
        case .purchased:
            message = .success
            await waitForGrant(since: before, generation: mine)
        }
    }

    /// Asks /me a few times; when nothing changed, says it may take a minute.
    /// Without a balance from before the purchase, the first answer becomes
    /// the baseline.
    private func waitForGrant(since before: Entitlement?, generation mine: Int) async {
        var baseline = before
        for delay in pollDelays {
            do {
                try await self.sleep(delay)
            } catch {
                return
            }
            guard mine == generation else { return }
            await account.refresh()
            guard mine == generation else { return }
            guard let now = account.entitlement else { continue }
            if let baseline {
                if Self.granted(before: baseline, after: now) { return }
            } else {
                baseline = now
            }
        }
        if message == .success { message = .pending }
    }

    /// Whether /me shows something new: another credit balance or another
    /// subscription.
    nonisolated static func granted(before: Entitlement, after: Entitlement) -> Bool {
        after.credits != before.credits || after.subscription != before.subscription
    }

    /// The pricing screen closed: an old confirmation should not greet the
    /// next visit.
    func clearMessage() {
        guard buying == nil else { return }
        message = nil
    }

    /// Settings closed.
    func clearRestoreResult() {
        guard !isRestoring else { return }
        restoreResult = nil
    }

    // MARK: - Restore

    func restore() async {
        guard let gateway, !isRestoring, account.isSignedIn else { return }
        let mine = generation
        isRestoring = true
        restoreResult = nil
        defer { isRestoring = false }
        do {
            try await logInCurrentUser(generation: mine)
            try checkStoreUser(generation: mine)
            let found = try await gateway.restore()
            await account.refresh()
            restoreResult = found ? .done : .nothing
        } catch {
            restoreResult = .failed
        }
    }

    // MARK: - Store identity

    /// The account's user id became known (sign-in, or /me at launch).
    func userSignedIn(_ id: String) {
        guard gateway != nil, loggedInUserId != id else { return }
        Task { try? await logIn(id) }
    }

    /// The session ended: forget the store identity and go anonymous.
    func userSignedOut() {
        generation += 1
        loggedInUserId = nil
        login = nil
        message = nil
        restoreResult = nil
        guard let gateway else { return }
        _ = enqueue { await gateway.logOut() }
    }

    /// Logs the store in as `id` once; concurrent callers share the call.
    func logIn(_ id: String) async throws {
        guard let gateway, loggedInUserId != id else { return }
        if let login, login.id == id {
            try await login.task.value
            return
        }
        let task = enqueue { try await gateway.logIn(userId: id) }
        login = (id: id, task: task)
        do {
            try await task.value
        } catch {
            if login?.id == id { login = nil }
            throw error
        }
        if login?.id == id {
            login = nil
            loggedInUserId = id
        }
    }

    /// Runs store identity work after whatever log-in or log-out came before.
    private func enqueue(_ work: @escaping @MainActor () async throws -> Void) -> Task<Void, any Error> {
        let previous = storeQueue
        let task = Task {
            await previous?.value
            try await work()
        }
        storeQueue = Task { _ = try? await task.value }
        return task
    }

    /// Purchases always go to the signed-in account: the store logs in as
    /// it first (a no-op when it already is).
    private func logInCurrentUser(generation mine: Int) async throws {
        if account.user == nil { await account.refresh() }
        guard mine == generation, let id = account.user?.id else { throw PurchaseGatewayError.signedOut }
        try await logIn(id)
    }

    /// Right before the store sheet: the session is still the one the
    /// purchase started in and the store holds its user id. Anything else
    /// would send the money to another (or an anonymous) store user.
    private func checkStoreUser(generation mine: Int) throws {
        guard mine == generation, account.isSignedIn, let id = account.user?.id,
              loggedInUserId == id, gateway?.isLoggedIn(as: id) == true
        else { throw PurchaseGatewayError.signedOut }
    }
}

#if DEBUG
extension PurchaseModel {
    /// Screenshot fixtures: store prices already loaded.
    func showForScreenshot(offers list: [StoreOffer]) {
        offers = Dictionary(list.map { ($0.planId, $0) }, uniquingKeysWith: { first, _ in first })
        loadState = .loaded
    }
}
#endif
