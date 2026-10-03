import FreeWANKit
import Foundation
import Observation

@MainActor
@Observable
final class AppModel {
    enum State: Equatable {
        case launching
        case signedOut
        /// Every server is private and none is unlocked.
        case locked
        case signedIn(Me)
    }

    private(set) var state: State = .launching
    /// A link opened from outside, held until the app is signed in and past any forced
    /// password change, then opened by the tabs.
    private(set) var pendingLink: DeepLink?
    private(set) var client: APIClient?
    /// The server in use; the tabs start afresh when it changes.
    private(set) var account: ServerAccount?
    private(set) var accounts: [ServerAccount] = []
    let session = Session(store: KeychainStore())

    var server: URL? { session.server }

    /// The servers Settings lists: private ones only while unlocked.
    var visibleAccounts: [ServerAccount] {
        accounts.filter { !$0.isPrivate || PrivacyLock.shared.unlocked }
    }

    /// Opens the last non-private server used. An unreachable server is still opened, so
    /// offline downloads stay usable; only the server saying the token is invalid signs out.
    func restore() async {
        refreshAccounts()
        if let opening = session.openingAccount {
            await open(opening)
        } else {
            use(nil)
            state = accounts.isEmpty ? .signedOut : .locked
        }
    }

    /// Adds a server, or signs in to one again, and opens it.
    func signIn(address: String, username: String, password: String) async throws {
        guard let server = ServerAddress.normalize(address) else {
            throw APIError(status: 0, code: "bad_address", message: "Enter a server address, like media.tailnet.ts.net")
        }
        let (me, token) = try await Auth.login(server: server, username: username, password: password)
        let account = session.save(server: server, username: me.username, token: token)
        prepare(account)
        use(makeClient(account))
        state = .signedIn(me)
    }

    func switchTo(_ account: ServerAccount) async {
        guard account.id != self.account?.id, !account.isPrivate || PrivacyLock.shared.unlocked else { return }
        await open(account)
    }

    func setPrivate(_ account: ServerAccount, _ isPrivate: Bool) {
        session.setPrivate(account.id, isPrivate)
        refreshAccounts()
    }

    /// Leaving the app locks private servers. If one was open, the last non-private server
    /// takes its place, so nothing private shows on coming back.
    func lockPrivate() {
        PrivacyLock.shared.lock()
        guard account?.isPrivate == true else { return }
        PlaybackCenter.shared.stopAll()
        session.deactivate()
        account = nil
        use(nil)
        state = .launching
    }

    func open(_ url: URL) {
        if let link = DeepLink(url: url) { pendingLink = link }
    }

    /// Opens a page from inside the app the way a link would, e.g. back from Picture in Picture.
    func show(_ link: DeepLink) {
        pendingLink = link
    }

    /// The held link, once; nil until the tabs are showing.
    func takePendingLink() -> DeepLink? {
        guard case .signedIn(let me) = state, !me.mustChangePassword else { return nil }
        defer { pendingLink = nil }
        return pendingLink
    }

    /// Clearing `mustChangePassword` is what releases the forced change screen.
    func passwordChanged() {
        guard case .signedIn(let me) = state else { return }
        state = .signedIn(Me(id: me.id, username: me.username, role: me.role,
                             canRunCommands: me.canRunCommands, mustChangePassword: false))
    }

    /// Signs out of a server, the one in use unless another is given.
    func signOut(_ account: ServerAccount? = nil) async {
        guard let account = account ?? self.account else { return }
        let token = session.token(for: account.id)
        let client = account.id == self.account?.id ? self.client
            : APIClient(baseURL: account.server, token: { token })
        _ = try? await client?.send("POST", "/api/auth/logout", as: NoContent.self)
        forget(account.id)
    }

    private func open(_ account: ServerAccount) async {
        prepare(account)
        let client = makeClient(account)
        do {
            let me = try await Auth.me(client)
            guard self.account?.id == account.id else { return }
            use(client)
            state = .signedIn(me)
        } catch let error as APIError where error.status == 401 {
            forget(account.id)
        } catch {
            // Cancelled, as when the screen asking went away, says nothing about the server.
            guard self.account?.id == account.id, !Task.isCancelled else { return }
            use(client)
            state = .signedIn(Me.offline)
        }
    }

    /// Makes `account` the one in use: its branding, display choices, and nothing left
    /// playing from the last.
    private func prepare(_ account: ServerAccount) {
        PlaybackCenter.shared.stopAll()
        session.activate(account.id)
        self.account = account
        refreshAccounts()
        LibraryPrefs.shared.load(for: account.server)
        ThemeStore.shared.applyCached(for: account.server)
        Task {
            let branding = await ThemeStore.shared.refresh(from: account.server) { self.account?.id == account.id }
            if let branding {
                session.rename(account.id, branding.siteName)
                refreshAccounts()
            }
        }
    }

    /// Drops a server whose sign-in ended. If it was the one in use, the next opens.
    private func forget(_ id: String) {
        guard accounts.contains(where: { $0.id == id }) || session.accounts.contains(where: { $0.id == id }) else { return }
        let wasActive = account?.id == id
        session.remove(id)
        refreshAccounts()
        guard wasActive else { return }
        PlaybackCenter.shared.stopAll()
        account = nil
        use(nil)
        state = .launching
    }

    private func refreshAccounts() {
        accounts = session.accounts
        if let id = account?.id { account = accounts.first { $0.id == id } }
    }

    /// The client for requests and for downloads, which run outside any one screen.
    private func use(_ client: APIClient?) {
        self.client = client
        DownloadManager.shared.client = client
    }

    /// A client for one server. A 401 signs out of that server only, even if it arrives after
    /// switching to another.
    private func makeClient(_ account: ServerAccount) -> APIClient {
        let session = self.session
        let id = account.id
        return APIClient(
            baseURL: account.server,
            token: { session.token(for: id) },
            onUnauthorized: { [weak self] in
                Task { @MainActor in self?.forget(id) }
            }
        )
    }
}

extension Me {
    /// Stands in for the user while the server cannot be reached.
    static let offline = Me(id: "", username: "", role: "user", canRunCommands: false, mustChangePassword: false)
}
