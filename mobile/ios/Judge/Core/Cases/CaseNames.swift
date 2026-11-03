import Foundation
import os
import Security

/// The real names behind a case's labels, as this phone received them
/// (lib/case-names-store.ts). The server keeps the owner's map encrypted
/// and sends it back as `case.names`; this store is the fallback for cases
/// created before that, or on a server without an originals key. Each
/// submission's `name_map` is merged in (the side, then the added context).
protocol CaseNamesStore: Sendable {
    func names(caseID: String) -> [NameMapping]
    func save(caseID: String, _ map: [NameMapping])
    func forget(caseID: String)
    /// Every case's names (signing out or deleting the account).
    func forgetAll()
}

enum CaseNames {
    /// MAX_NAME_ENTRIES (lib/originals-types.ts).
    static let maxEntries = 60

    /// mergeNameMaps: `previous` then `next`, without duplicates or empty
    /// originals, at most 60 entries.
    static func merge(_ previous: [NameMapping], _ next: [NameMapping]) -> [NameMapping] {
        var seen = Set<NameMapping>()
        var out: [NameMapping] = []
        for mapping in previous + next where !mapping.original.isEmpty {
            guard seen.insert(mapping).inserted else { continue }
            out.append(mapping)
            if out.count >= maxEntries { break }
        }
        return out
    }
}

/// Names in the Keychain, one item per case (this device only, never
/// synced): they are real names, so they get the same care as the session.
final class KeychainCaseNamesStore: CaseNamesStore {
    private static let log = Logger(subsystem: "com.okjudge.judge", category: "keychain")
    let service: String
    private let lock = OSAllocatedUnfairLock<Void>()

    init(service: String = "com.okjudge.judge.caseNames") {
        self.service = service
    }

    func names(caseID: String) -> [NameMapping] {
        lock.withLock { read(caseID) }
    }

    func save(caseID: String, _ map: [NameMapping]) {
        guard !map.isEmpty else { return }
        lock.withLock {
            let merged = CaseNames.merge(read(caseID), map)
            let data = Data(WireDecoding.json(of: merged).utf8)
            let query = query(caseID)
            let changes: [String: Any] = [
                kSecValueData as String: data,
                kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
            ]
            var status = SecItemUpdate(query as CFDictionary, changes as CFDictionary)
            if status == errSecItemNotFound {
                var item = query
                item[kSecValueData as String] = data
                item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
                status = SecItemAdd(item as CFDictionary, nil)
            }
            if status != errSecSuccess {
                Self.log.error("case names write failed: \(status, privacy: .public)")
            }
        }
    }

    func forget(caseID: String) {
        lock.withLock {
            _ = SecItemDelete(query(caseID) as CFDictionary)
        }
    }

    func forgetAll() {
        lock.withLock {
            let all: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: service,
            ]
            _ = SecItemDelete(all as CFDictionary)
        }
    }

    private func query(_ caseID: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: caseID,
        ]
    }

    private func read(_ caseID: String) -> [NameMapping] {
        var request = query(caseID)
        request[kSecReturnData as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(request as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data
        else { return [] }
        return CaseNames.merge([], WireDecoding.nameMap(fromJSON: String(decoding: data, as: UTF8.self)))
    }
}

/// Names held in memory only: screenshot states and tests.
final class MemoryCaseNamesStore: CaseNamesStore {
    private let state = OSAllocatedUnfairLock<[String: [NameMapping]]>(initialState: [:])

    func names(caseID: String) -> [NameMapping] {
        state.withLock { $0[caseID] ?? [] }
    }

    func save(caseID: String, _ map: [NameMapping]) {
        guard !map.isEmpty else { return }
        state.withLock { $0[caseID] = CaseNames.merge($0[caseID] ?? [], map) }
    }

    func forget(caseID: String) {
        state.withLock { $0[caseID] = nil }
    }

    func forgetAll() {
        state.withLock { $0 = [:] }
    }
}
