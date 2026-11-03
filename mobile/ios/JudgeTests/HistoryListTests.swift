import SwiftData
import XCTest
@testable import Judge

/// The account's Verdicts list: decoding /me/history, the cache and its
/// reconcile rules, labels from the viewer's side, paging and removal.
final class HistoryListTests: XCTestCase {
    @MainActor
    private func withStore(_ body: (HistoryStore) throws -> Void) throws {
        let container = HistoryContainer.inMemory()
        try withExtendedLifetime(container) {
            try body(HistoryStore(container: container))
        }
    }

    private func item(_ id: String, _ at: String, kind: String = "verdict") -> HistoryItem {
        var row = HistoryItem(kind: kind, id: id, at: at, state: "ready")
        row.verdict = "side_a"
        row.headline = "Party A is right"
        row.removable = true
        return row
    }

    private func page(_ items: HistoryItem..., next: String? = "more") -> HistoryPage {
        HistoryPage(items: items, next: next)
    }

    private func session(_ sample: String, id: String? = nil) throws -> VerdictSession {
        let payload = try Fixtures.sample(sample)
        return VerdictSession(id: id ?? payload.id, original: payload.result, nameMap: payload.nameMap, translations: [:])
    }

    private func fixturePage() throws -> HistoryPage {
        let body = try XCTUnwrap(Fixtures.verdicts()["history"])
        return try HistoryPage.decode(try JSONSerialization.data(withJSONObject: body))
    }

    // MARK: - Decoding

    func testDecodesThePage() throws {
        let page = try fixturePage()
        XCTAssertEqual(page.items.count, 7)
        XCTAssertEqual(page.items.first?.key, "c:case0000010")
        XCTAssertEqual(page.items.first?.historyState, .waiting)
        let answered = try XCTUnwrap(page.items.first { $0.isRespondent })
        XCTAssertEqual(answered.party, "b")
        XCTAssertEqual(answered.inviteToken, "case0000013.inviteTokenFixture0001")
        XCTAssertNotNil(page.next)
    }

    func testAPageKeepsTheRowsItCanRead() throws {
        let body = #"""
        {"items":[
          {"kind":"verdict","id":"v1","at":"2026-10-05T00:00:00.000Z","state":"archived"},
          {"kind":"case","id":"c1","at":"2026-10-04T00:00:00.000Z","state":"ready","nameMap":"nope"},
          {"kind":"case","at":"2026-10-03T00:00:00.000Z"}
        ],"next":null}
        """#
        let page = try HistoryPage.decode(Data(body.utf8))
        XCTAssertEqual(page.items.map(\.key), ["v:v1"])
        XCTAssertNil(page.items[0].historyState, "a state this build doesn't know")
        XCTAssertFalse(page.items[0].removable, "missing fields read as off")
        XCTAssertNil(page.next)
    }

    // MARK: - Cache

    @MainActor
    func testFirstPageReplacesWhatItCoversAndKeepsTheRowsBelow() throws {
        try withStore { store in
            try store.apply(page(item("b", "2026-10-05T12:00:00.000Z"), item("a", "2026-10-05T00:00:00.000Z"), item("c", "2026-10-01T00:00:00.000Z")), user: "u1", above: nil)
            try store.apply(page(item("n", "2026-10-06T00:00:00.000Z"), item("a", "2026-10-05T00:00:00.000Z")), user: "u1", above: nil)
            XCTAssertEqual(try store.cached(user: "u1").map(\.key), ["v:n", "v:a", "v:c"], "b went; c is not checked yet")
        }
    }

    @MainActor
    func testTheLastPageDropsEverythingBelowItThatItLacks() throws {
        try withStore { store in
            try store.apply(page(item("a", "2026-10-05T00:00:00.000Z"), item("c", "2026-10-01T00:00:00.000Z")), user: "u1", above: nil)
            try store.apply(page(item("a", "2026-10-05T00:00:00.000Z"), next: nil), user: "u1", above: nil)
            XCTAssertEqual(try store.cached(user: "u1").map(\.key), ["v:a"])
            try store.apply(page(next: nil), user: "u1", above: nil)
            XCTAssertTrue(try store.cached(user: "u1").isEmpty)
        }
    }

    @MainActor
    func testAMiddlePageReconcilesBetweenItsBounds() throws {
        try withStore { store in
            let first = item("a", "2026-10-09T00:00:00.000Z")
            try store.apply(page(first, item("b", "2026-10-08T00:00:00.000Z"), item("c", "2026-10-07T00:00:00.000Z"), item("d", "2026-10-02T00:00:00.000Z"), next: nil), user: "u1", above: nil)
            try store.apply(page(item("c", "2026-10-07T00:00:00.000Z")), user: "u1", above: first)
            XCTAssertEqual(try store.cached(user: "u1").map(\.key), ["v:a", "v:c", "v:d"])
        }
    }

    @MainActor
    func testRowsSharingATimeAreOrderedByKey() throws {
        try withStore { store in
            let at = "2026-10-05T00:00:00.000Z"
            try store.apply(page(item("x", at), item("y", at, kind: "case"), item("z", at), next: nil), user: "u1", above: nil)
            XCTAssertEqual(try store.cached(user: "u1").map(\.key), ["v:z", "v:x", "c:y"])
            try store.apply(page(item("z", at), item("x", at)), user: "u1", above: nil)
            XCTAssertEqual(try store.cached(user: "u1").map(\.key), ["v:z", "v:x", "c:y"], "c:y is below the page")
        }
    }

    @MainActor
    func testListedVerdictsJoinTheAccountAndRemovedOnesLeaveThePhone() throws {
        try withStore { store in
            try store.save(try session("win_a_self"))
            try store.save(try session("lean_tie", id: "gone1"))
            try store.save(try session("split", id: "phone1"))
            var gone = item("gone1", "2026-10-04T00:00:00.000Z")
            gone.state = "removed"
            gone.removed = true
            try store.apply(page(item("abc123DEF0", "2026-10-05T00:00:00.000Z"), gone, next: nil), user: "u1", above: nil)
            XCTAssertEqual(try store.find(id: "abc123DEF0")?.ownerUserID, "u1")
            XCTAssertNil(try store.find(id: "gone1"), "the text and names leave with the account's copy")
            XCTAssertNil(try XCTUnwrap(try store.find(id: "phone1")).ownerUserID)

            // No longer listed: the phone copy stays (it may never have reached the account).
            try store.apply(page(next: nil), user: "u1", above: nil)
            XCTAssertEqual(try store.find(id: "abc123DEF0")?.ownerUserID, "u1")
        }
    }

    @MainActor
    func testAnotherAccountAndSigningOutTakeTheAccountsRowsOff() throws {
        try withStore { store in
            try store.save(try session("win_a_self"))
            try store.save(try session("split", id: "phone1"))
            try store.apply(page(item("abc123DEF0", "2026-10-05T00:00:00.000Z"), next: nil), user: "u1", above: nil)
            XCTAssertEqual(try store.cached(user: "u1").count, 1)
            try store.setAccount("u2")
            XCTAssertTrue(try store.cached(user: "u1").isEmpty)
            XCTAssertNil(try store.find(id: "abc123DEF0"))
            XCTAssertNotNil(try store.find(id: "phone1"))

            try store.apply(page(item("phone1", "2026-10-05T00:00:00.000Z"), next: nil), user: "u2", above: nil)
            try store.forgetAccounts()
            XCTAssertTrue(try store.cached(user: "u2").isEmpty)
            XCTAssertNil(try store.find(id: "phone1"), "it is the account's now, and comes back from it")
        }
    }

    @MainActor
    func testAVerdictSavedSignedInIsListedAtOnce() throws {
        try withStore { store in
            try store.setAccount("u1")
            let first = try session("win_b_named")
            let when = try XCTUnwrap(ErrorText.parseISO("2026-10-20T09:00:00Z"))
            try store.save(first, now: when)
            let listed = try XCTUnwrap(try store.cached(user: "u1").first)
            XCTAssertEqual(listed.key, "v:" + first.id)
            XCTAssertEqual(listed.at, "2026-10-20T09:00:00.000Z")
            XCTAssertEqual(listed.historyState, .ready)
            XCTAssertEqual(try store.find(id: first.id)?.ownerUserID, "u1")

            let later = try Fixtures.sample("win_a_self")
            try store.saveRuling(first.withRuling(VerdictPayload(id: "r1", result: later.result, nameMap: [])))
            let ruled = try XCTUnwrap(try store.cached(user: "u1").first)
            XCTAssertEqual(ruled.verdict, "side_a")
            XCTAssertTrue(ruled.contextAdded)
        }
    }

    @MainActor
    func testAVerdictJudgedSignedInLeavesWithTheAccountBeforeTheListLoads() throws {
        try withStore { store in
            try store.setAccount("u1")
            try store.save(try session("win_a_self"))
            try store.forgetAccounts()
            XCTAssertNil(try store.find(id: "abc123DEF0"))

            try store.setAccount("u1")
            try store.save(try session("win_a_self"))
            try store.setAccount("u2")
            XCTAssertNil(try store.find(id: "abc123DEF0"))
        }
    }

    @MainActor
    func testKeepStoresAnAccountVerdictForOfflineReading() throws {
        try withStore { store in
            let sample = try Fixtures.sample("win_a_self")
            try store.keep(item(sample.id, "2026-10-05T10:00:00.000Z"), mine: MineVerdict(result: sample.result, nameMap: sample.nameMap), user: "u1")
            let kept = try XCTUnwrap(try store.find(id: sample.id))
            XCTAssertEqual(kept.ownerUserID, "u1")
            XCTAssertEqual(kept.createdAt, ErrorText.parseISO("2026-10-05T10:00:00Z"))
            XCTAssertEqual(kept.nameMap, sample.nameMap)
            try store.keep(item("none", "2026-10-05T10:00:00.000Z"), mine: MineVerdict(result: nil, nameMap: []), user: "u1")
            XCTAssertNil(try store.find(id: "none"))
        }
    }

    @MainActor
    func testPhoneRowsWaitForTheAccountsListToReachThem() throws {
        try withStore { store in
            try store.save(try session("win_a_self"), now: try XCTUnwrap(ErrorText.parseISO("2026-09-01T00:00:00Z")))
            try store.save(try session("split", id: "other"), now: try XCTUnwrap(ErrorText.parseISO("2026-10-10T00:00:00Z")))
            let other = try XCTUnwrap(try store.find(id: "other"))
            other.ownerUserID = "u9"
            let cached = [item("a", "2026-10-05T00:00:00.000Z")]
            let all = try store.all()
            XCTAssertEqual(HistoryEntry.merge(cached: cached, saved: all, user: "u1").map(\.id), ["v:a", "v:abc123DEF0"], "another account's copy is not listed")
            XCTAssertEqual(HistoryEntry.merge(cached: cached, saved: all, user: "u1", cutoff: "2026-10-05T00:00:00.000Z").map(\.id), ["v:a"])
            XCTAssertEqual(HistoryEntry.merge(cached: [], saved: all, user: nil).map(\.id), ["v:abc123DEF0"], "signed out: the phone's own")
        }
    }

    @MainActor
    func testAnOlderStoreOpensWithEveryRow() throws {
        let url = FileManager.default.temporaryDirectory.appending(path: "History-\(UUID().uuidString).store")
        defer { try? FileManager.default.removeItem(at: url) }
        do {
            let old = try ModelContainer(for: OldStore.SavedVerdict.self, configurations: ModelConfiguration(url: url))
            for (n, name) in ["win_a_self", "split"].enumerated() {
                let sample = try Fixtures.sample(name)
                old.mainContext.insert(OldStore.SavedVerdict(id: sample.id, createdAt: Date(timeIntervalSince1970: Double(n + 1) * 100), result: sample.result))
            }
            try old.mainContext.save()
        }
        let current = try ModelContainer(for: SavedVerdict.self, HistoryCacheRow.self, configurations: ModelConfiguration(url: url))
        let store = HistoryStore(container: current)
        let rows = try store.all()
        XCTAssertEqual(rows.count, 2)
        XCTAssertTrue(rows.allSatisfy { $0.ownerUserID == nil })
        XCTAssertNotNil(rows[0].session(), "an old row still opens")
        try store.apply(page(item(rows[1].id, "2026-10-05T00:00:00.000Z"), next: nil), user: "u1", above: nil)
        XCTAssertEqual(try store.cached(user: "u1").count, 1)
    }

    // MARK: - Labels

    @MainActor
    func testLabelsFollowTheViewersSide() throws {
        let page = try fixturePage()
        func row(_ id: String) throws -> HistoryItem { try XCTUnwrap(page.items.first { $0.id == id }) }
        let now = try XCTUnwrap(ErrorText.parseISO("2026-10-21T08:00:00Z"))

        let waiting = try row("case0000010")
        XCTAssertEqual(HistoryLabels.status(waiting, lang: .en, now: now), "Waiting for Sam to answer")
        XCTAssertEqual(HistoryLabels.status(waiting, lang: .en, now: try XCTUnwrap(ErrorText.parseISO("2026-10-28T00:00:00Z"))), L10n.historyStateExpired(.en), "an old cache reads the invite as closed")
        var nameless = waiting
        nameless.nameMap = []
        XCTAssertEqual(HistoryLabels.status(nameless, lang: .en, now: now), L10n.historyStateWaitingOther(.en))

        XCTAssertEqual(HistoryLabels.status(try row("verdict0020"), lang: .en, now: now), L10n.historyStateJudging(.en))
        XCTAssertEqual(HistoryLabels.title(try row("verdict0020"), lang: .en), L10n.shellUntitled(.en))
        XCTAssertEqual(HistoryLabels.status(try row("case0000011"), lang: .en, now: now), L10n.historyStateExpired(.en))
        XCTAssertEqual(HistoryLabels.status(try row("verdict0021"), lang: .en, now: now), L10n.verdictWinSelf(.en))
        XCTAssertEqual(HistoryLabels.tone(try row("verdict0021"), now: now), .yours)
        XCTAssertEqual(HistoryLabels.status(try row("case0000012"), lang: .en, now: now), L10n.verdictWin(.en, name: "Sam"))
        XCTAssertEqual(HistoryLabels.tone(try row("case0000012"), now: now), .theirs)
        XCTAssertEqual(HistoryLabels.tags(try row("case0000012"), lang: .en), [L10n.historyContextAdded(.en)])

        let answered = try row("case0000013")
        XCTAssertEqual(HistoryLabels.otherName(answered), "Alex")
        XCTAssertEqual(HistoryLabels.status(answered, lang: .en, now: now), L10n.verdictWinSelf(.en))
        XCTAssertEqual(HistoryLabels.title(answered, lang: .en), "Alex owes half the deposit")
        XCTAssertEqual(HistoryLabels.tags(answered, lang: .en), [L10n.historyAnswered(.en)])
        var lost = answered
        lost.verdict = "side_a"
        XCTAssertEqual(HistoryLabels.status(lost, lang: .en, now: now), "Alex is right")
        XCTAssertTrue(HistoryLabels.openable(answered))
        XCTAssertFalse(HistoryLabels.openable(try row("verdict0020")))

        XCTAssertEqual(HistoryLabels.status(try row("case0000014"), lang: .en, now: now), L10n.historyStateRemovedBy(.en, name: "Sam"))
        XCTAssertTrue(HistoryLabels.muted(try row("case0000014"), now: now))

        let removed = HistoryListModel.removed(try row("verdict0021"))
        XCTAssertEqual(HistoryLabels.title(removed, lang: .en), L10n.historyStateRemoved(.en))
        XCTAssertNil(HistoryLabels.status(removed, lang: .en, now: now), "the title already says it")
        var unknown = waiting
        unknown.state = "archived"
        XCTAssertNil(HistoryLabels.status(unknown, lang: .en, now: now))
    }

    @MainActor
    func testSelectableRowsAndConfirmWording() throws {
        try withStore { store in
            try store.save(try session("win_b_named"))
            let page = try fixturePage()
            let entries = HistoryEntry.merge(cached: page.items, saved: try store.all(), user: "u1")
            let selectable = Set(HistorySelection.selectable(entries))
            XCTAssertEqual(selectable, Set(page.items.filter(\.removable).map(\.key) + ["v:winB000001"]))
            XCTAssertFalse(selectable.contains("v:verdict0020"), "still being judged")
            XCTAssertFalse(selectable.contains("c:case0000014"), "removed by the other side")

            let phone = entries.filter(\.isPhone)
            let account = entries.filter { $0.id == "v:verdict0021" }
            XCTAssertEqual(HistoryLabels.removeConfirm(phone, lang: .en), "Delete this verdict from this phone? Its share link keeps working.")
            XCTAssertEqual(
                HistoryLabels.removeConfirm(account, lang: .en),
                "Remove this verdict from your account? What you wrote and the names are erased and its share link stops working, on every device. This can't be undone."
            )
            XCTAssertEqual(
                HistoryLabels.removeConfirm(account + phone, lang: .en),
                L10n.appHistoryRemoveConfirm(.en, n: 1) + " " + L10n.appHistoryPhoneOnlyAlso(.en, n: 1)
            )
            XCTAssertTrue(L10n.appHistoryRemoveConfirm(.en, n: 2).hasPrefix("Remove 2 verdicts from your account?"))
        }
    }

    // MARK: - Paging and removal

    @MainActor
    private func model(_ container: ModelContainer, router: StubRouter) throws -> (AppModel, HistoryListModel) {
        router.install()
        StubURLProtocol.requests = []
        let app = try PremiumFixtures.app(container: container)
        return (app, app.historyList)
    }

    private func pageBody(_ items: [HistoryItem], next: String?) throws -> [String: Any] {
        let rows = try items.map { try JSONSerialization.jsonObject(with: JSONEncoder().encode($0)) }
        var body: [String: Any] = ["items": rows]
        body["next"] = next.map { $0 as Any } ?? NSNull()
        return body
    }

    @MainActor
    func testRefreshThenShowMoreUntilTheEnd() async throws {
        let container = HistoryContainer.inMemory()
        let router = StubRouter()
        router.on(
            "GET", "/api/v1/me/history",
            try PremiumFixtures.json(200, try pageBody([item("a", "2026-10-05T00:00:00.000Z"), item("b", "2026-10-04T00:00:00.000Z")], next: "cur1")),
            try PremiumFixtures.json(200, try pageBody([item("c", "2026-10-01T00:00:00.000Z")], next: nil))
        )
        let (app, list) = try model(container, router: router)
        await list.refresh(user: "u1", enabled: true)
        XCTAssertEqual(try app.history.cached(user: "u1").map(\.key), ["v:a", "v:b"])
        XCTAssertEqual(list.next, "cur1")
        XCTAssertEqual(list.cutoff, "2026-10-04T00:00:00.000Z")
        XCTAssertEqual(StubURLProtocol.requests.last?.url?.query, "limit=20")

        await list.refresh(user: "u1", enabled: true)
        XCTAssertEqual(router.count("GET", "/api/v1/me/history"), 1, "page 1 is read at most once a minute")

        await list.loadMore(user: "u1")
        XCTAssertEqual(StubURLProtocol.requests.last?.url?.query, "limit=20&cursor=cur1")
        XCTAssertEqual(try app.history.cached(user: "u1").map(\.key), ["v:a", "v:b", "v:c"])
        XCTAssertNil(list.next)
        XCTAssertTrue(list.loadedAll)
        XCTAssertNil(list.cutoff)
        await list.loadMore(user: "u1")
        XCTAssertEqual(router.count("GET", "/api/v1/me/history"), 2)

        await list.refresh(user: "u1", enabled: false, force: true)
        XCTAssertEqual(router.count("GET", "/api/v1/me/history"), 2, "a server without the list is not asked")
        withExtendedLifetime(container) {}
    }

    @MainActor
    func testAShowMoreThatFailsSaysSoAndTheNextTryClearsIt() async throws {
        let container = HistoryContainer.inMemory()
        let router = StubRouter()
        router.on(
            "GET", "/api/v1/me/history",
            try PremiumFixtures.json(200, try pageBody([item("a", "2026-10-05T00:00:00.000Z")], next: "cur1")),
            try PremiumFixtures.json(500, ["error": "Something went wrong."]),
            try PremiumFixtures.json(200, try pageBody([item("b", "2026-10-01T00:00:00.000Z")], next: nil))
        )
        let (app, list) = try model(container, router: router)
        await list.refresh(user: "u1", enabled: true)
        await list.loadMore(user: "u1")
        XCTAssertEqual(list.notice, .loadMoreFailed)
        XCTAssertEqual(list.next, "cur1", "Show more stays, to try again")
        await list.loadMore(user: "u1")
        XCTAssertNil(list.notice)
        XCTAssertEqual(try app.history.cached(user: "u1").map(\.key), ["v:a", "v:b"])
        withExtendedLifetime(container) {}
    }

    @MainActor
    func testRemoveSendsEachRowToItsOwnRemoval() async throws {
        let container = HistoryContainer.inMemory()
        let router = StubRouter()
        let done = try PremiumFixtures.json(200, ["removed": true, "removedAt": "2026-10-21T00:00:00.000Z"])
        router.on("POST", "/api/v1/verdicts/v1/removal", done)
        router.on("POST", "/api/v1/respond/tok2/removal", done)
        router.on("POST", "/api/v1/cases/c3/removal", try PremiumFixtures.json(409, ["error": "Wait for the judges to finish first.", "code": "in_progress"]))
        let (app, list) = try model(container, router: router)
        var answered = item("c2", "2026-10-03T00:00:00.000Z", kind: "case")
        answered.role = "respondent"
        answered.party = "b"
        answered.inviteToken = "tok2"
        let rows = [item("v1", "2026-10-05T00:00:00.000Z"), answered, item("c3", "2026-10-02T00:00:00.000Z", kind: "case")]
        try app.history.apply(HistoryPage(items: rows, next: nil), user: "u1", above: nil)
        try app.history.save(try session("lean_tie", id: "v1"))
        try app.history.save(try session("split", id: "phone1"))
        let entries = HistoryEntry.merge(cached: try app.history.cached(user: "u1"), saved: try app.history.all(), user: "u1")
        XCTAssertEqual(entries.count, 4)

        let failed = await list.remove(entries, user: "u1", enabled: true)
        XCTAssertEqual(failed, ["c:c3"])
        XCTAssertEqual(list.notice, .removeFailed(1))
        let sent = try router.sentBodies("POST", "/api/v1/verdicts/v1/removal").map { try PremiumFixtures.body($0) }
        XCTAssertEqual(sent.first?["confirm"] as? String, "remove")
        XCTAssertEqual(router.count("POST", "/api/v1/respond/tok2/removal"), 1)

        let after = Dictionary(uniqueKeysWithValues: try app.history.cached(user: "u1").map { ($0.key, $0) })
        XCTAssertEqual(after["v:v1"]?.historyState, .removed)
        XCTAssertNil(after["v:v1"]?.headline)
        XCTAssertEqual(after["c:c2"]?.removed, true)
        XCTAssertEqual(after["c:c3"]?.historyState, .ready)
        XCTAssertNil(try app.history.find(id: "v1"), "the phone's copy goes with the account's")
        XCTAssertNil(try app.history.find(id: "phone1"), "phone rows are deleted here")
        withExtendedLifetime(container) {}
    }

    @MainActor
    func testRemovingOfflineSendsNothingMoreButDeletesPhoneRows() async throws {
        let container = HistoryContainer.inMemory()
        let router = StubRouter()
        let (app, list) = try model(container, router: router)
        try app.history.apply(HistoryPage(items: [item("v1", "2026-10-05T00:00:00.000Z"), item("v2", "2026-10-04T00:00:00.000Z")], next: nil), user: "u1", above: nil)
        try app.history.save(try session("split", id: "phone1"))
        let entries = HistoryEntry.merge(cached: try app.history.cached(user: "u1"), saved: try app.history.all(), user: "u1")

        let failed = await list.remove(entries, user: "u1", enabled: true)
        XCTAssertEqual(failed, ["v:v1", "v:v2"])
        XCTAssertEqual(list.notice, .offline)
        XCTAssertEqual(router.count("POST", "/api/v1/verdicts/v1/removal") + router.count("POST", "/api/v1/verdicts/v2/removal"), 1, "the first one found the phone offline")
        XCTAssertNil(try app.history.find(id: "phone1"))
        withExtendedLifetime(container) {}
    }

    @MainActor
    func testOpeningAnAccountVerdictReadsItOnce() async throws {
        let container = HistoryContainer.inMemory()
        let router = StubRouter()
        let sample = try Fixtures.sample("win_a_self")
        let result = try JSONSerialization.jsonObject(with: Data(sample.result.json.utf8))
        let names = sample.nameMap.map { ["original": $0.original, "replacement": $0.replacement] }
        router.on("GET", "/api/v1/verdicts/\(sample.id)/mine", try PremiumFixtures.json(200, ["id": sample.id, "result": result, "nameMap": names, "removed": NSNull()]))
        let (app, list) = try model(container, router: router)
        let row = item(sample.id, "2026-10-05T00:00:00.000Z")

        let opened = await list.openVerdict(row, user: "u1")
        XCTAssertTrue(opened)
        let kept = try XCTUnwrap(try app.history.find(id: sample.id))
        XCTAssertEqual(kept.ownerUserID, "u1")
        XCTAssertEqual(kept.nameMap, sample.nameMap)
        let again = await list.openVerdict(row, user: "u1")
        XCTAssertTrue(again)
        XCTAssertEqual(router.count("GET", "/api/v1/verdicts/\(sample.id)/mine"), 1, "kept on the phone now")
        withExtendedLifetime(container) {}
    }
}

/// SavedVerdict as the build before the account's list stored it: no
/// owner, and no list cache beside it.
enum OldStore {
    @Model
    final class SavedVerdict {
        @Attribute(.unique) var id: String
        var createdAt: Date
        var headline: String
        var verdict: String
        var lang: String
        var confidence: Int
        var preset: String
        var tier: String
        var resultJSON: String
        var nameMapJSON: String
        var translationsJSON: String?
        var rulingID: String?

        init(id: String, createdAt: Date, result: RawResult) {
            self.id = id
            self.createdAt = createdAt
            headline = result.result.headline
            verdict = result.result.verdict.rawValue
            lang = "en"
            confidence = result.result.confidence
            preset = "balanced"
            tier = "free"
            resultJSON = result.json
            nameMapJSON = "[]"
            translationsJSON = nil
            rulingID = nil
        }
    }
}
