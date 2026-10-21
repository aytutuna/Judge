import Foundation
import os
import Security

/// The session token in the Keychain (a generic password readable after the
/// first unlock, never synced or restored to another device). Reads are
/// cached in memory, since every request asks for the token; a read the
/// Keychain could not answer (locked before first unlock, for example) is
/// not cached, so the next request asks again. Failures log the status
/// code only, never the token.
final class KeychainTokenStore: TokenStore {
    private static let log = Logger(subsystem: "com.okjudge.judge", category: "keychain")

    private enum Cache: Sendable {
        case unknown
        case known(String?)
    }

    let service: String
    let account: String
    private let cache = OSAllocatedUnfairLock<Cache>(initialState: .unknown)

    init(service: String = "com.okjudge.judge.session", account: String = "bearer") {
        self.service = service
        self.account = account
    }

    func token() -> String? {
        cache.withLock { cache in
            if case .known(let value) = cache { return value }
            let (status, value) = lookup()
            if status == errSecSuccess || status == errSecItemNotFound {
                cache = .known(value)
            } else {
                Self.log.error("token read failed: \(status, privacy: .public)")
            }
            return value
        }
    }

    func setToken(_ token: String) {
        cache.withLock { cache in
            let status = write(token)
            if status != errSecSuccess {
                Self.log.error("token write failed: \(status, privacy: .public)")
            }
            // Kept in memory either way, so this launch stays signed in.
            cache = .known(token)
        }
    }

    func clear() {
        cache.withLock { cache in
            delete()
            cache = .known(nil)
        }
    }

    private var query: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }

    /// The stored token straight from the Keychain (no cache).
    func read() -> String? {
        lookup().value
    }

    private func lookup() -> (status: OSStatus, value: String?) {
        var request = query
        request[kSecReturnData as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        let status = SecItemCopyMatching(request as CFDictionary, &item)
        guard status == errSecSuccess,
              let data = item as? Data,
              let text = String(data: data, encoding: .utf8), !text.isEmpty
        else { return (status, nil) }
        return (status, text)
    }

    /// Stores the token: updates the item, or adds it when there is none.
    /// Returns the Keychain status.
    @discardableResult
    func write(_ token: String) -> OSStatus {
        let data = Data(token.utf8)
        let changes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        let updated = SecItemUpdate(query as CFDictionary, changes as CFDictionary)
        guard updated == errSecItemNotFound else { return updated }
        var item = query
        item[kSecValueData as String] = data
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        return SecItemAdd(item as CFDictionary, nil)
    }

    @discardableResult
    func delete() -> OSStatus {
        SecItemDelete(query as CFDictionary)
    }
}

/// A token held in memory only: screenshot states and tests.
final class MemoryTokenStore: TokenStore {
    private let state: OSAllocatedUnfairLock<String?>

    init(token: String? = nil) {
        state = OSAllocatedUnfairLock(initialState: token)
    }

    func token() -> String? { state.withLock { $0 } }
    func setToken(_ token: String) { state.withLock { $0 = token } }
    func clear() { state.withLock { $0 = nil } }
}
