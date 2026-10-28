import Foundation
import SwiftData

/// One verdict kept on the phone for offline reading. Same fields as the
/// Android table. `nameMapJSON` holds the submitter's real names (the store
/// is excluded from backups); the account holds them too, encrypted.
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
    /// The judging style there used to be a choice of. Kept so existing
    /// stores open without a migration; new rows write "balanced".
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
    /// The account it was judged in, or whose list later named it; nil rows
    /// were judged signed out or by an older version.
    var ownerUserID: String?

    init(
        id: String,
        createdAt: Date,
        headline: String,
        verdict: String,
        lang: String,
        confidence: Int,
        tier: String,
        resultJSON: String,
        nameMapJSON: String,
        translationsJSON: String? = nil,
        rulingID: String? = nil,
        ownerUserID: String? = nil
    ) {
        self.id = id
        self.createdAt = createdAt
        self.headline = headline
        self.verdict = verdict
        self.lang = lang
        self.confidence = confidence
        preset = "balanced"
        self.tier = tier
        self.resultJSON = resultJSON
        self.nameMapJSON = nameMapJSON
        self.translationsJSON = translationsJSON
        self.rulingID = rulingID
        self.ownerUserID = ownerUserID
    }
}

/// A row of the account's Verdicts list as the server last sent it
/// (`json` is the HistoryItem). Same as the Android history_rows table.
@Model
final class HistoryCacheRow {
    /// "<user> <key>": one row per account and list key.
    @Attribute(.unique) var slot: String
    var userID: String
    var key: String
    var kind: String
    var itemID: String
    var at: String
    var json: String

    init(userID: String, item: HistoryItem, json: String) {
        slot = userID + " " + item.key
        self.userID = userID
        key = item.key
        kind = item.kind
        itemID = item.id
        at = item.at
        self.json = json
    }

    var item: HistoryItem? { try? JSONDecoder().decode(HistoryItem.self, from: Data(json.utf8)) }
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
/// also reads, so saves show up in Verdicts immediately. Holds the verdicts
/// kept for offline reading and the account's list as last loaded (the
/// server's list wins; this is its cache).
@MainActor
final class HistoryStore {
    let context: ModelContext
    /// The signed-in account, once known: a verdict saved now is listed for it at once.
    private(set) var account: String?

    init(context: ModelContext) {
        self.context = context
    }

    /// Saves (or replaces) a verdict right after it arrives.
    func save(_ session: VerdictSession, now: Date = .now) throws {
        try keepVerdict(session, createdAt: now, owner: account)
        // Listed at once; the next load of the list confirms it.
        guard let account, try cachedRow(user: account, key: "v:" + session.id) == nil else { return }
        let result = session.original.result
        var item = HistoryItem(kind: "verdict", id: session.id, at: HistoryOrder.iso(now), state: HistoryState.ready.rawValue)
        item.createdAt = item.at
        item.verdict = result.verdict.rawValue
        item.headline = result.headline
        item.nameMap = session.nameMap
        item.removable = true
        try updateCached(item, user: account)
    }

    /// An existing entry keeps its date and owner; `owner` tags a new one.
    private func keepVerdict(_ session: VerdictSession, createdAt now: Date, owner: String?) throws {
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
            if existing.ownerUserID == nil { existing.ownerUserID = owner }
        } else {
            context.insert(SavedVerdict(
                id: session.id,
                createdAt: now,
                headline: result.headline,
                verdict: result.verdict.rawValue,
                lang: session.sourceLang.rawValue,
                confidence: result.confidence,
                tier: result.tier ?? "free",
                resultJSON: session.original.json,
                nameMapJSON: WireDecoding.json(of: session.nameMap),
                translationsJSON: WireDecoding.json(of: translations),
                ownerUserID: owner
            ))
        }
        try context.save()
    }

    /// A later ruling on a saved verdict (context added): the entry keeps
    /// its id and date and shows `session`'s verdict. Translations
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
        guard let account, var listed = try cachedRow(user: account, key: "v:" + session.id)?.item else { return }
        listed.state = HistoryState.ready.rawValue
        listed.yourMove = false
        listed.verdict = result.verdict.rawValue
        listed.headline = result.headline
        listed.contextAdded = true
        try updateCached(listed, user: account)
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

    // The account's list

    /// The account's rows as last loaded, newest first.
    func cached(user: String) throws -> [HistoryItem] {
        let rows = try context.fetch(FetchDescriptor<HistoryCacheRow>(predicate: #Predicate<HistoryCacheRow> { $0.userID == user }))
        return rows.compactMap(\.item).sorted { HistoryOrder.before(($0.at, $0.key), ($1.at, $1.key)) }
    }

    private func cachedRow(user: String, key: String) throws -> HistoryCacheRow? {
        let slot = user + " " + key
        var descriptor = FetchDescriptor<HistoryCacheRow>(predicate: #Predicate<HistoryCacheRow> { $0.slot == slot })
        descriptor.fetchLimit = 1
        return try context.fetch(descriptor).first
    }

    /// `user` is signed in: other accounts' rows leave the phone. Nil: signed
    /// out, the rows stay (unlisted) for when the same person signs back in.
    func setAccount(_ user: String?) throws {
        account = user
        guard let user else { return }
        let owner: String? = user
        try deleteEach(FetchDescriptor<HistoryCacheRow>(predicate: #Predicate<HistoryCacheRow> { $0.userID != user }))
        try deleteEach(FetchDescriptor<SavedVerdict>(predicate: #Predicate<SavedVerdict> { $0.ownerUserID != nil && $0.ownerUserID != owner }))
        try context.save()
    }

    /// Signed out or deleted by the user: every account's rows leave the
    /// phone (they come back from the account on sign-in); verdicts no
    /// account has stay.
    func forgetAccounts() throws {
        account = nil
        try deleteEach(FetchDescriptor<HistoryCacheRow>())
        try deleteEach(FetchDescriptor<SavedVerdict>(predicate: #Predicate<SavedVerdict> { $0.ownerUserID != nil }))
        try context.save()
    }

    /// Row by row, not a batch delete: the list's `@Query` holds these
    /// objects and only sees deletes made through the context.
    private func deleteEach<Row: PersistentModel>(_ descriptor: FetchDescriptor<Row>) throws {
        for row in try context.fetch(descriptor) { context.delete(row) }
    }

    /// One page of the account's list. Cached rows between `above` (the
    /// previous page's last row; nil for the first page) and this page's
    /// last row that the page lacks are gone on the server; with no page
    /// after this one, so is everything below it. A verdict the server no
    /// longer lists keeps its phone copy: it may never have reached the account.
    func apply(_ page: HistoryPage, user: String, above: HistoryItem?) throws {
        let keys = Set(page.items.map(\.key))
        let lower = page.next == nil ? nil : page.items.last
        let rows = try context.fetch(FetchDescriptor<HistoryCacheRow>(predicate: #Predicate<HistoryCacheRow> { $0.userID == user }))
        for row in rows where !keys.contains(row.key) && HistoryOrder.inWindow((row.at, row.key), lower: lower, upper: above) {
            context.delete(row)
        }
        for item in page.items {
            try updateCached(item, user: user, saving: false)
            guard !item.isCase, let saved = try find(id: item.id) else { continue }
            // Removed from the account: the text and names leave this phone too.
            if item.removed {
                context.delete(saved)
            } else if saved.ownerUserID == nil {
                saved.ownerUserID = user
            }
        }
        try context.save()
    }

    func updateCached(_ item: HistoryItem, user: String) throws {
        try updateCached(item, user: user, saving: true)
    }

    private func updateCached(_ item: HistoryItem, user: String, saving: Bool) throws {
        let json = String(decoding: try JSONEncoder().encode(item), as: UTF8.self)
        if let row = try cachedRow(user: user, key: item.key) {
            row.at = item.at
            row.json = json
        } else {
            context.insert(HistoryCacheRow(userID: user, item: item, json: json))
        }
        if saving { try context.save() }
    }

    /// An account verdict read from the server, kept for offline reading.
    func keep(_ item: HistoryItem, mine: MineVerdict, user: String) throws {
        guard let result = mine.result else { return }
        let session = VerdictSession(id: item.id, original: result, nameMap: mine.nameMap, translations: [:])
        try keepVerdict(session, createdAt: ErrorText.parseISO(item.at) ?? .now, owner: user)
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
            return try ModelContainer(for: SavedVerdict.self, HistoryCacheRow.self, configurations: configuration)
        } catch {
            return inMemory()
        }
    }

    @MainActor
    static func inMemory() -> ModelContainer {
        do {
            return try ModelContainer(
                for: SavedVerdict.self, HistoryCacheRow.self,
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
