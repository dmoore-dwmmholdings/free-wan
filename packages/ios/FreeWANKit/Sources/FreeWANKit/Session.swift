import Foundation
#if canImport(Security)
import Security
#endif

/// Small string storage. The token goes in the Keychain; tests use `MemoryStore`.
public protocol SecretStore: AnyObject, Sendable {
    func get(_ key: String) -> String?
    func set(_ key: String, _ value: String)
    func remove(_ key: String)
}

public final class MemoryStore: SecretStore, @unchecked Sendable {
    private var values: [String: String] = [:]
    private let lock = NSLock()

    public init() {}

    public func get(_ key: String) -> String? { lock.withLock { values[key] } }
    public func set(_ key: String, _ value: String) { lock.withLock { values[key] = value } }
    public func remove(_ key: String) { lock.withLock { _ = values.removeValue(forKey: key) } }
}

#if canImport(Security)
/// Generic-password Keychain items, readable after first unlock so background downloads can
/// authenticate, and never synced or migrated to another device.
public final class KeychainStore: SecretStore, @unchecked Sendable {
    private let service: String

    public init(service: String = "com.freewan.app") {
        self.service = service
    }

    private func query(_ key: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service,
         kSecAttrAccount as String: key]
    }

    public func get(_ key: String) -> String? {
        var q = query(key)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    public func set(_ key: String, _ value: String) {
        remove(key)
        var q = query(key)
        q[kSecValueData as String] = Data(value.utf8)
        q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(q as CFDictionary, nil)
    }

    public func remove(_ key: String) {
        SecItemDelete(query(key) as CFDictionary)
    }
}
#endif

/// The server address and session token. Signing out drops the token but keeps the address,
/// so signing back in does not mean retyping the host.
public final class Session: @unchecked Sendable {
    static let serverKey = "server"
    static let tokenKey = "token"

    private let store: SecretStore

    public init(store: SecretStore) {
        self.store = store
    }

    public var server: URL? { store.get(Self.serverKey).flatMap(URL.init(string:)) }
    public var token: String? { store.get(Self.tokenKey) }

    public func save(server: URL, token: String) {
        store.set(Self.serverKey, server.absoluteString)
        store.set(Self.tokenKey, token)
    }

    public func clear() {
        store.remove(Self.tokenKey)
    }
}
