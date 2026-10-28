import Foundation
import Observation

/// A row of the Verdicts list: one from the account, or a verdict kept on
/// this phone that the account doesn't have.
enum HistoryEntry: Identifiable {
    case account(HistoryItem)
    case phone(SavedVerdict)

    var id: String {
        switch self {
        case .account(let item): return item.key
        case .phone(let row): return "v:" + row.id
        }
    }

    var at: String {
        switch self {
        case .account(let item): return item.at
        case .phone(let row): return HistoryOrder.iso(row.createdAt)
        }
    }

    /// Select mode can pick it: phone rows, and account rows whose own page
    /// offers Remove (the website's case tools).
    var selectable: Bool {
        switch self {
        case .account(let item): return item.removable
        case .phone: return true
        }
    }

    var isPhone: Bool {
        if case .phone = self { return true }
        return false
    }

    /// The account's rows and the phone's own, newest first. A phone row
    /// older than `cutoff` (the last account row loaded this session) waits
    /// until the account's list is loaded that far: the account may have it.
    static func merge(cached: [HistoryItem], saved: [SavedVerdict], user: String?, cutoff: String? = nil) -> [HistoryEntry] {
        let listed = Set(cached.map(\.key))
        let phone = saved
            .filter { ($0.ownerUserID == nil || $0.ownerUserID == user) && !listed.contains("v:" + $0.id) }
            .map(HistoryEntry.phone)
            .filter { cutoff == nil || $0.at >= cutoff! }
        return (cached.map(HistoryEntry.account) + phone)
            .map { ($0, $0.at) }
            .sorted { HistoryOrder.before(($0.1, $0.0.id), ($1.1, $1.0.id)) }
            .map(\.0)
    }
}

/// Select mode of the Verdicts list, by entry id.
struct HistorySelection: Equatable {
    var isActive = false
    var ids: Set<String> = []

    static func selectable(_ entries: [HistoryEntry]) -> [String] {
        entries.filter(\.selectable).map(\.id)
    }

    mutating func start() {
        isActive = true
        ids = []
    }

    mutating func end() {
        isActive = false
        ids = []
    }

    mutating func toggle(_ id: String) {
        if ids.contains(id) { ids.remove(id) } else { ids.insert(id) }
    }

    func allOf(_ selectable: [String]) -> Bool {
        !selectable.isEmpty && ids.isSuperset(of: selectable)
    }

    mutating func toggleAll(_ selectable: [String]) {
        ids = allOf(selectable) ? [] : Set(selectable)
    }
}

/// The account's Verdicts list: GET /api/v1/me/history a page at a time,
/// cached in the history store (shown at once and offline; the server wins
/// on refresh), plus removing rows the way their pages do.
@MainActor
@Observable
final class HistoryListModel {
    enum Notice: Equatable {
        case offline, removeFailed(Int), openFailed
    }

    static let limit = 20
    static let refreshEvery: TimeInterval = 60
    static let pollEvery: Duration = .seconds(20)

    private(set) var loading = false
    private(set) var failed = false
    /// The cursor of the next page; nil once there is none (or before the first load).
    private(set) var next: String?
    private(set) var loadingMore = false
    /// The last row loaded this session.
    private(set) var last: HistoryItem?
    private(set) var loadedAll = false
    /// When page 1 was last loaded; nil: not this session.
    private(set) var loadedAt: Date?
    var notice: Notice?

    /// Off for screenshot states.
    @ObservationIgnored var usesNetwork = true
    /// The device clock, fixed in screenshot states.
    @ObservationIgnored var now: () -> Date = { Date() }
    @ObservationIgnored private var owner: String?

    private let api: JudgeAPI
    private let store: HistoryStore
    private let account: AccountModel

    init(api: JudgeAPI, store: HistoryStore, account: AccountModel) {
        self.api = api
        self.store = store
        self.account = account
    }

    /// Phone rows older than this wait (see `HistoryEntry.merge`); nil shows them all.
    var cutoff: String? { loadedAt == nil || loadedAll ? nil : last?.at }

    /// Signed out, or another account: nothing of this session's paging stays.
    func reset() {
        loading = false
        failed = false
        next = nil
        loadingMore = false
        last = nil
        loadedAll = false
        loadedAt = nil
        notice = nil
        owner = nil
    }

    private func follow(_ user: String) {
        if owner != user {
            reset()
            owner = user
        }
    }

    /// Page 1 again, at most once a minute unless `force`d.
    func refresh(user: String?, enabled: Bool, force: Bool = false) async {
        guard usesNetwork, enabled, let user else { return }
        follow(user)
        guard !loading else { return }
        if !force, let loadedAt, now().timeIntervalSince(loadedAt) < Self.refreshEvery { return }
        loading = true
        failed = false
        defer { loading = false }
        do {
            let page = try await api.history(limit: Self.limit)
            guard owner == user else { return }
            try store.apply(page, user: user, above: nil)
            afterFirstPage(page)
        } catch is CancellationError {
        } catch let error as APIError {
            if error.code == "signin_required" { account.sessionExpired() }
            failed = true
        } catch {
            failed = true
        }
    }

    /// Page 1 reloaded keeps what Show more loaded below it.
    private func afterFirstPage(_ page: HistoryPage) {
        let pageLast = page.items.last
        var deeper = false
        if loadedAt != nil, page.next != nil {
            if loadedAll {
                deeper = true
            } else if let last, let pageLast {
                deeper = HistoryOrder.before((pageLast.at, pageLast.key), (last.at, last.key))
            }
        }
        loadedAt = now()
        guard !deeper else { return }
        next = page.next
        last = pageLast
        loadedAll = page.next == nil
    }

    func loadMore(user: String?) async {
        guard usesNetwork, let user, owner == user, let cursor = next, !loading, !loadingMore else { return }
        loadingMore = true
        defer { loadingMore = false }
        let above = last
        do {
            let page = try await api.history(limit: Self.limit, cursor: cursor)
            guard owner == user else { return }
            try store.apply(page, user: user, above: above)
            next = page.next
            if let pageLast = page.items.last { last = pageLast }
            loadedAll = page.next == nil
        } catch {}
    }

    /// Removes `picked`: account rows through the server, as each one's page
    /// does; phone rows from the phone. Returns the ids that failed, which
    /// stay picked.
    func remove(_ picked: [HistoryEntry], user: String?, enabled: Bool) async -> Set<String> {
        notice = nil
        for entry in picked {
            if case .phone(let row) = entry { try? store.delete(id: row.id) }
        }
        var failedIDs: Set<String> = []
        var offline = false
        var stale = false
        for entry in picked {
            guard case .account(let item) = entry else { continue }
            guard let user, !offline, usesNetwork else {
                failedIDs.insert(item.key)
                continue
            }
            do {
                try await removeOne(item)
                try? store.updateCached(Self.removed(item), user: user)
                if !item.isCase { try? store.delete(id: item.id) }
            } catch let error as APIError {
                if error == .offline {
                    offline = true
                    failedIDs.insert(item.key)
                } else if let code = error.code, code == "not_found" || code == "removed" {
                    // Removed meanwhile, or not this account's any more: the list catches up.
                    stale = true
                } else {
                    failedIDs.insert(item.key)
                }
            } catch {
                failedIDs.insert(item.key)
            }
        }
        notice = offline ? .offline : failedIDs.isEmpty ? nil : .removeFailed(failedIDs.count)
        if stale { await refresh(user: user, enabled: enabled, force: true) }
        return failedIDs
    }

    private func removeOne(_ item: HistoryItem) async throws {
        if !item.isCase {
            try await api.removeVerdict(id: item.id)
        } else if item.isRespondent {
            guard let token = item.inviteToken else { throw APIError.malformed }
            try await api.removeAnsweredCase(token: token)
        } else {
            _ = try await api.removeCase(id: item.id)
        }
    }

    /// The row as the list shows it once removed, until the server says more.
    static func removed(_ item: HistoryItem) -> HistoryItem {
        var row = item
        row.state = HistoryState.removed.rawValue
        row.removed = true
        row.removable = false
        row.yourMove = false
        row.verdict = nil
        row.contextAdded = false
        row.headline = nil
        row.excerpt = nil
        row.nameMap = []
        row.expiresAt = nil
        return row
    }

    /// An account verdict: true once it is on the phone, read from the
    /// account first when it isn't yet.
    func openVerdict(_ item: HistoryItem, user: String?) async -> Bool {
        notice = nil
        if (try? store.find(id: item.id)) != nil { return true }
        guard usesNetwork, let user else { return false }
        do {
            let mine = try await api.mineVerdict(id: item.id)
            if mine.result != nil {
                try store.keep(item, mine: mine, user: user)
                return true
            }
        } catch {}
        notice = .openFailed
        return false
    }

    #if DEBUG
    /// Screenshot states: the list as if page 1 had just loaded.
    func showForScreenshot(next: String?, last: HistoryItem?, at date: Date) {
        usesNetwork = false
        now = { date }
        self.next = next
        self.last = last
        loadedAll = next == nil
        loadedAt = date
    }
    #endif
}
