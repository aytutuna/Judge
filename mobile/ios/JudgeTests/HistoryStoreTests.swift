import SwiftData
import XCTest
@testable import Judge

final class HistoryStoreTests: XCTestCase {
    /// Runs `body` against a fresh in-memory store, keeping its container alive.
    @MainActor
    private func withStore(_ body: (HistoryStore) throws -> Void) throws {
        let container = HistoryContainer.inMemory()
        try withExtendedLifetime(container) {
            try body(HistoryStore(container: container))
        }
    }

    private func session(_ sample: String) throws -> VerdictSession {
        let payload = try Fixtures.sample(sample)
        return VerdictSession(id: payload.id, original: payload.result, nameMap: payload.nameMap, translations: [:])
    }

    @MainActor
    func testSaveAndRead() throws {
        try withStore { store in
            let saved = try session("win_a_self")
            try store.save(saved, now: Date(timeIntervalSince1970: 100))

            let row = try XCTUnwrap(try store.find(id: "abc123DEF0"))
            XCTAssertEqual(row.headline, saved.original.result.headline)
            XCTAssertEqual(row.verdict, "side_a")
            XCTAssertEqual(row.finalVerdict, .sideA)
            XCTAssertEqual(row.lang, "en")
            XCTAssertEqual(row.confidence, 4)
            XCTAssertEqual(row.preset, "balanced")
            XCTAssertEqual(row.tier, "free")
            XCTAssertEqual(row.createdAt, Date(timeIntervalSince1970: 100))
            XCTAssertEqual(row.nameMap, saved.nameMap, "names stay on the device for the labels")
            XCTAssertEqual(row.session()?.original.result, saved.original.result)

            // The list label is recomputed from the stored names in either language.
            let parties = Names.partyNames(row.nameMap, lang: .tr, selfLang: row.contentLang)
            XCTAssertEqual(VerdictDisplay.label(row.finalVerdict, parties: parties, lang: .tr), "Sen haklısın")
        }
    }

    @MainActor
    func testSavingAgainReplacesAndListIsNewestFirst() throws {
        try withStore { store in
            try store.save(try session("win_a_self"), now: Date(timeIntervalSince1970: 100))
            try store.save(try session("win_b_named"), now: Date(timeIntervalSince1970: 200))
            try store.save(try session("win_a_self"), now: Date(timeIntervalSince1970: 300))

            let all = try store.all()
            XCTAssertEqual(all.map(\.id), ["winB000001", "abc123DEF0"], "no duplicate; the first save keeps its date")
        }
    }

    @MainActor
    func testTranslationCacheSurvivesForOfflineUse() throws {
        try withStore { store in
            try store.save(try session("win_a_self"))
            let body = try XCTUnwrap(Fixtures.verdicts()["translateResponse"])
            let translated = try WireDecoding.translatePayload(from: JSONSerialization.data(withJSONObject: body))
            try store.cacheTranslation(id: "abc123DEF0", lang: .tr, json: translated.result.json)

            let restored = try XCTUnwrap(try store.find(id: "abc123DEF0")?.session())
            XCTAssertEqual(restored.translations[.tr]?.result.headline, "Taraf B kelimenin anlamını zorluyor, Taraf A'nın menü testi kazanıyor")
            XCTAssertEqual(restored.original.result.lang, .en, "the original is kept next to the translation")

            // Caching for an unknown id is a no-op.
            XCTAssertNoThrow(try store.cacheTranslation(id: "missing", lang: .tr, json: translated.result.json))
        }
    }

    @MainActor
    func testDeleteOneAndAll() throws {
        try withStore { store in
            try store.save(try session("win_a_self"))
            try store.save(try session("split"))
            try store.save(try session("refused"))

            try store.delete(id: "abc123DEF0")
            XCTAssertNil(try store.find(id: "abc123DEF0"))
            XCTAssertEqual(try store.all().count, 2)

            try store.deleteAll()
            XCTAssertTrue(try store.all().isEmpty)
        }
    }

    @MainActor
    func testSelectionTogglesAndPicksAll() {
        var selection = HistorySelection()
        selection.start()
        XCTAssertTrue(selection.isActive)
        selection.toggle("v:a")
        XCTAssertEqual(selection.ids, ["v:a"])
        selection.toggle("v:a")
        XCTAssertTrue(selection.ids.isEmpty)

        let selectable = ["v:a", "c:b"]
        selection.toggle("v:a")
        XCTAssertFalse(selection.allOf(selectable))
        selection.toggleAll(selectable)
        XCTAssertEqual(selection.ids, Set(selectable))
        XCTAssertTrue(selection.allOf(selectable))
        selection.toggleAll(selectable)
        XCTAssertTrue(selection.ids.isEmpty, "Deselect all once everything is picked")
        XCTAssertFalse(HistorySelection().allOf([]), "nothing to pick is never all picked")
        selection.toggle("v:a")
        selection.end()
        XCTAssertFalse(selection.isActive)
        XCTAssertTrue(selection.ids.isEmpty)
    }

    @MainActor
    func testALaterRulingReplacesWhatTheEntryShows() throws {
        try withStore { store in
            let first = try session("win_b_named")
            try store.save(first, now: Date(timeIntervalSince1970: 100))
            try store.cacheTranslation(id: first.id, lang: .tr, json: first.original.json)
            XCTAssertNil(try store.find(id: first.id)?.rulingID, "a fresh entry is its own ruling")

            let later = try Fixtures.sample("win_a_self")
            let names = [first.nameMap[0], NameMapping(original: "Kim", replacement: "Person C")]
            try store.saveRuling(first.withRuling(VerdictPayload(id: "r1", result: later.result, nameMap: names)))

            let row = try XCTUnwrap(try store.find(id: first.id))
            XCTAssertEqual(row.rulingID, "r1")
            XCTAssertEqual(row.createdAt, Date(timeIntervalSince1970: 100))
            XCTAssertEqual(row.preset, "balanced")
            XCTAssertEqual(row.verdict, "side_a")
            XCTAssertEqual(row.headline, later.result.result.headline)
            XCTAssertNil(row.translationsJSON, "the earlier ruling's translations are dropped")
            XCTAssertEqual(row.nameMap, first.nameMap + [NameMapping(original: "Kim", replacement: "Person C")])
            XCTAssertEqual(row.session()?.currentID, "r1")
            XCTAssertEqual(try store.all().map(\.id), [first.id])

            try store.saveRuling(VerdictSession(id: "missing", original: later.result, nameMap: [], translations: [:], rulingID: "r2"))
            XCTAssertNil(try store.find(id: "missing"), "a deleted entry stays deleted")
        }
    }
}
