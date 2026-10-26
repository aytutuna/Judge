import Foundation
import SwiftData

/// One saved verdict ("My verdicts"). Same fields as the Android table.
/// `nameMapJSON` holds the submitter's real names; it never leaves the
/// device and the store is excluded from backups.
@Model
final class SavedVerdict {
    @Attribute(.unique) var id: String
    var createdAt: Date
    /// Original (anonymized) headline, for the list.
    var headline: String
    /// FinalVerdict raw value, for the list's label and seal colour.
    var verdict: String
    /// Content language of the original (verdictLang).
    var lang: String
    var confidence: Int
    var preset: String
    var tier: String
    /// The full original `result` JSON as received.
    var resultJSON: String
    var nameMapJSON: String
    /// `{ "tr": <result JSON> }`: translations fetched so far, for offline use.
    var translationsJSON: String?
    /// The round of added context whose verdict `resultJSON` holds; nil
    /// while it is the first verdict.
    var rulingID: String?

    init(
        id: String,
        createdAt: Date,
        headline: String,
        verdict: String,
        lang: String,
        confidence: Int,
        preset: String,
        tier: String,
        resultJSON: String,
        nameMapJSON: String,
        translationsJSON: String? = nil,
        rulingID: String? = nil
    ) {
        self.id = id
        self.createdAt = createdAt
        self.headline = headline
        self.verdict = verdict
        self.lang = lang
        self.confidence = confidence
        self.preset = preset
        self.tier = tier
        self.resultJSON = resultJSON
        self.nameMapJSON = nameMapJSON
        self.translationsJSON = translationsJSON
        self.rulingID = rulingID
    }
}

extension SavedVerdict {
    var finalVerdict: FinalVerdict { FinalVerdict(rawValue: verdict) ?? .unknown }
    var contentLang: AppLang { AppLang(rawValue: lang) ?? .en }
    var nameMap: [NameMapping] { WireDecoding.nameMap(fromJSON: nameMapJSON) }

    /// The verdict screen's input, or nil when the stored JSON no longer decodes.
    func session() -> VerdictSession? {
        guard let result = try? WireDecoding.result(fromJSON: resultJSON) else { return nil }
        return VerdictSession(
            id: id,
            original: RawResult(result: result, json: resultJSON),
            nameMap: nameMap,
            translations: WireDecoding.translations(fromJSON: translationsJSON),
            rulingID: rulingID
        )
    }
}

/// Main-actor wrapper around the SwiftData context that the list's `@Query`
/// also reads, so saves show up in "My verdicts" immediately.
@MainActor
final class HistoryStore {
    let context: ModelContext

    init(context: ModelContext) {
        self.context = context
    }

    /// Saves (or replaces) a verdict right after it arrives.
    func save(_ session: VerdictSession, preset: String, now: Date = .now) throws {
        let result = session.original.result
        let translations = session.translations.mapValues(\.json)
        if let existing = try find(id: session.id) {
            existing.headline = result.headline
            existing.verdict = result.verdict.rawValue
            existing.lang = session.sourceLang.rawValue
            existing.confidence = result.confidence
            existing.resultJSON = session.original.json
            existing.nameMapJSON = WireDecoding.json(of: session.nameMap)
            existing.translationsJSON = WireDecoding.json(of: translations)
        } else {
            context.insert(SavedVerdict(
                id: session.id,
                createdAt: now,
                headline: result.headline,
                verdict: result.verdict.rawValue,
                lang: session.sourceLang.rawValue,
                confidence: result.confidence,
                preset: preset,
                tier: result.tier ?? "free",
                resultJSON: session.original.json,
                nameMapJSON: WireDecoding.json(of: session.nameMap),
                translationsJSON: WireDecoding.json(of: translations)
            ))
        }
        try context.save()
    }

    /// A later ruling on a saved verdict (context added): the entry keeps
    /// its id, date and preset and shows `session`'s verdict. Translations
    /// of the earlier ruling no longer apply.
    func saveRuling(_ session: VerdictSession) throws {
        guard let row = try find(id: session.id) else { return }
        let result = session.original.result
        row.headline = result.headline
        row.verdict = result.verdict.rawValue
        row.lang = session.sourceLang.rawValue
        row.confidence = result.confidence
        row.tier = result.tier ?? "free"
        row.resultJSON = session.original.json
        row.nameMapJSON = WireDecoding.json(of: session.nameMap)
        row.translationsJSON = nil
        row.rulingID = session.rulingID
        try context.save()
    }

    func find(id: String) throws -> SavedVerdict? {
        var descriptor = FetchDescriptor<SavedVerdict>(predicate: #Predicate<SavedVerdict> { $0.id == id })
        descriptor.fetchLimit = 1
        return try context.fetch(descriptor).first
    }

    /// Newest first.
    func all() throws -> [SavedVerdict] {
        try context.fetch(FetchDescriptor<SavedVerdict>(sortBy: [SortDescriptor(\.createdAt, order: .reverse)]))
    }

    /// Caches a fetched translation so it also works offline.
    func cacheTranslation(id: String, lang: AppLang, json: String) throws {
        guard let row = try find(id: id) else { return }
        var cached = WireDecoding.translations(fromJSON: row.translationsJSON).mapValues(\.json)
        cached[lang] = json
        row.translationsJSON = WireDecoding.json(of: cached)
        try context.save()
    }

    func delete(id: String) throws {
        guard let row = try find(id: id) else { return }
        context.delete(row)
        try context.save()
    }

    func deleteAll() throws {
        try context.delete(model: SavedVerdict.self)
        try context.save()
    }
}

enum HistoryContainer {
    /// The on-device store in Application Support/History, excluded from
    /// backups. Falls back to memory if the disk store cannot open.
    @MainActor
    static func make() -> ModelContainer {
        do {
            let directory = try storeDirectory()
            let configuration = ModelConfiguration(url: directory.appending(path: "History.store"), cloudKitDatabase: .none)
            return try ModelContainer(for: SavedVerdict.self, configurations: configuration)
        } catch {
            return inMemory()
        }
    }

    @MainActor
    static func inMemory() -> ModelContainer {
        do {
            return try ModelContainer(
                for: SavedVerdict.self,
                configurations: ModelConfiguration(isStoredInMemoryOnly: true)
            )
        } catch {
            fatalError("Cannot create an in-memory SwiftData container: \(error)")
        }
    }

    private static func storeDirectory() throws -> URL {
        let support = try FileManager.default.url(
            for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true
        )
        var directory = support.appending(path: "History", directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try directory.setResourceValues(values)
        return directory
    }
}
