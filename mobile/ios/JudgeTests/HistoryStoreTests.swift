import SwiftData
import XCTest
@testable import Judge

final class HistoryStoreTests: XCTestCase {
    /// Runs `body` against a fresh in-memory store, keeping its container alive.
    @MainActor
    private func withStore(_ body: (HistoryStore) throws -> Void) throws {
        let container = HistoryContainer.inMemory()
        try withExtendedLifetime(container) {
            try body(HistoryStore(context: container.mainContext))
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
            try store.save(saved, preset: "fairness", now: Date(timeIntervalSince1970: 100))

            let row = try XCTUnwrap(try store.find(id: "abc123DEF0"))
            XCTAssertEqual(row.headline, saved.original.result.headline)
            XCTAssertEqual(row.verdict, "side_a")
            XCTAssertEqual(row.finalVerdict, .sideA)
            XCTAssertEqual(row.lang, "en")
            XCTAssertEqual(row.confidence, 4)
            XCTAssertEqual(row.preset, "fairness")
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
            try store.save(try session("win_a_self"), preset: "balanced", now: Date(timeIntervalSince1970: 100))
            try store.save(try session("win_b_named"), preset: "balanced", now: Date(timeIntervalSince1970: 200))
            try store.save(try session("win_a_self"), preset: "balanced", now: Date(timeIntervalSince1970: 300))

            let all = try store.all()
            XCTAssertEqual(all.map(\.id), ["winB000001", "abc123DEF0"], "no duplicate; the first save keeps its date")
        }
    }

    @MainActor
    func testTranslationCacheSurvivesForOfflineUse() throws {
        try withStore { store in
            try store.save(try session("win_a_self"), preset: "balanced")
            let body = try XCTUnwrap(Fixtures.verdicts()["translateResponse"])
            let translated = try WireDecoding.translatePayload(from: JSONSerialization.data(withJSONObject: body))
            try store.cacheTranslation(id: "abc123DEF0", lang: .tr, json: translated.result.json)

            let restored = try XCTUnwrap(try store.find(id: "abc123DEF0")?.session())
            XCTAssertEqual(restored.translations[.tr]?.result.headline, "Kimse sandviç isteyip sosisli beklemez")
            XCTAssertEqual(restored.original.result.lang, .en, "the original is kept next to the translation")

            // Caching for an unknown id is a no-op.
            XCTAssertNoThrow(try store.cacheTranslation(id: "missing", lang: .tr, json: translated.result.json))
        }
    }

    @MainActor
    func testDeleteOneAndAll() throws {
        try withStore { store in
            try store.save(try session("win_a_self"), preset: "balanced")
            try store.save(try session("split"), preset: "balanced")
            try store.save(try session("refused"), preset: "balanced")

            try store.delete(id: "abc123DEF0")
            XCTAssertNil(try store.find(id: "abc123DEF0"))
            XCTAssertEqual(try store.all().count, 2)

            try store.deleteAll()
            XCTAssertTrue(try store.all().isEmpty)
        }
    }
}
