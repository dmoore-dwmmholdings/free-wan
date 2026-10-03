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

/// A server signed in to, with the user it is signed in as.
public struct ServerAccount: Codable, Equatable, Hashable, Identifiable, Sendable {
    public let id: String
    public let server: URL
    public let username: String
    /// The server's own name once known, otherwise its host.
    public var name: String
    /// Hidden until unlocked, and never opened on launch.
    public var isPrivate: Bool
}

/// The servers signed in to, each with its session token, and which one is in use. Tokens live
/// in the store under their own keys; the list itself is stored there too, so which servers are
/// private is not left in plain preferences.
public final class Session: @unchecked Sendable {
    static let accountsKey = "accounts"
    static let activeKey = "active"
    static let lastPublicKey = "lastPublic"
    static let recentKey = "recentServer"
    static func tokenKey(_ id: String) -> String { "token." + id }
    // A single server and token, from before several servers were possible.
    static let legacyServerKey = "server"
    static let legacyTokenKey = "token"

    private let store: SecretStore
    private let lock = NSLock()
    private var _accounts: [ServerAccount] = []
    private var _activeID: String?

    public init(store: SecretStore) {
        self.store = store
        if let data = store.get(Self.accountsKey)?.data(using: .utf8),
           let saved = try? JSONDecoder().decode([ServerAccount].self, from: data) {
            _accounts = saved
        }
        _activeID = store.get(Self.activeKey)
        migrateSingleServer()
    }

    public var accounts: [ServerAccount] { lock.withLock { _accounts } }
    public var active: ServerAccount? { lock.withLock { _accounts.first { $0.id == _activeID } } }
    public var server: URL? { active?.server }
    public var token: String? { active.flatMap { token(for: $0.id) } }

    public func token(for id: String) -> String? { store.get(Self.tokenKey(id)) }

    /// The address the sign-in form starts with: the current server, else the last one left.
    public var recentServer: URL? { server ?? store.get(Self.recentKey).flatMap(URL.init(string:)) }

    /// The account to open on launch or on coming back to the app: the last non-private one
    /// used, else the first. Nil when there are none, or all are private.
    public var openingAccount: ServerAccount? {
        let open = accounts.filter { !$0.isPrivate }
        let last = store.get(Self.lastPublicKey)
        return open.first { $0.id == last } ?? open.first
    }

    /// Adds a sign-in, or renews it for the same server and user, and makes it the one in use.
    @discardableResult
    public func save(server: URL, username: String = "", token: String) -> ServerAccount {
        let account: ServerAccount = lock.withLock {
            if let i = _accounts.firstIndex(where: { $0.server == server && $0.username == username }) {
                return _accounts[i]
            }
            let fresh = ServerAccount(id: UUID().uuidString, server: server, username: username,
                                      name: server.host ?? server.absoluteString, isPrivate: false)
            _accounts.append(fresh)
            return fresh
        }
        store.set(Self.tokenKey(account.id), token)
        saveAccounts()
        activate(account.id)
        return account
    }

    public func activate(_ id: String) {
        guard let account = accounts.first(where: { $0.id == id }) else { return }
        lock.withLock { _activeID = id }
        store.set(Self.activeKey, id)
        if !account.isPrivate { store.set(Self.lastPublicKey, id) }
    }

    public func setPrivate(_ id: String, _ isPrivate: Bool) {
        change(id) { $0.isPrivate = isPrivate }
        if isPrivate, store.get(Self.lastPublicKey) == id { store.remove(Self.lastPublicKey) }
    }

    public func rename(_ id: String, _ name: String) {
        guard !name.isEmpty else { return }
        change(id) { $0.name = name }
    }

    /// Signs out of an account: forgets it and its token. Removing the one in use leaves none
    /// in use, and its address becomes the sign-in form's starting point.
    public func remove(_ id: String) {
        let removed: ServerAccount? = lock.withLock {
            guard let i = _accounts.firstIndex(where: { $0.id == id }) else { return nil }
            if _activeID == id { _activeID = nil }
            return _accounts.remove(at: i)
        }
        guard let removed else { return }
        store.remove(Self.tokenKey(id))
        store.set(Self.recentKey, removed.server.absoluteString)
        if store.get(Self.activeKey) == id { store.remove(Self.activeKey) }
        if store.get(Self.lastPublicKey) == id { store.remove(Self.lastPublicKey) }
        saveAccounts()
    }

    /// Leaves no account in use, as when private servers lock with nothing else to open.
    public func deactivate() {
        lock.withLock { _activeID = nil }
        store.remove(Self.activeKey)
    }

    private func change(_ id: String, _ edit: (inout ServerAccount) -> Void) {
        lock.withLock {
            if let i = _accounts.firstIndex(where: { $0.id == id }) { edit(&_accounts[i]) }
        }
        saveAccounts()
    }

    private func saveAccounts() {
        if let data = try? JSONEncoder().encode(accounts), let text = String(data: data, encoding: .utf8) {
            store.set(Self.accountsKey, text)
        }
    }

    private func migrateSingleServer() {
        guard let address = store.get(Self.legacyServerKey) else { return }
        if let server = URL(string: address) {
            if let token = store.get(Self.legacyTokenKey) {
                save(server: server, token: token)
            } else {
                store.set(Self.recentKey, address)
            }
        }
        store.remove(Self.legacyServerKey)
        store.remove(Self.legacyTokenKey)
    }
}
