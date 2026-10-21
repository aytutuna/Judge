import Foundation
import os
import Security

/// The session token in the Keychain (a generic password readable after the
/// first unlock, never synced or restored to another device). Reads are
/// cached in memory, since every request asks for the token.
final class KeychainTokenStore: TokenStore {
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
            let value = read()
            cache = .known(value)
            return value
        }
    }

    func setToken(_ token: String) {
        cache.withLock { cache in
            _ = write(token)
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
        var request = query
        request[kSecReturnData as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(request as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data,
              let text = String(data: data, encoding: .utf8), !text.isEmpty
        else { return nil }
        return text
    }

    /// Replaces the stored token; returns the Keychain status.
    @discardableResult
    func write(_ token: String) -> OSStatus {
        delete()
        var item = query
        item[kSecValueData as String] = Data(token.utf8)
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
