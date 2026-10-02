import FreeWANKit
import Foundation
import Observation

@MainActor
@Observable
final class AppModel {
    enum State: Equatable {
        case launching
        case signedOut
        case signedIn(Me)
    }

    private(set) var state: State = .launching
    private(set) var client: APIClient?
    let session = Session(store: KeychainStore())

    var server: URL? { session.server }

    /// Reopens the last session. An unreachable server keeps it, so offline downloads stay
    /// usable; only the server saying the token is invalid signs out.
    func restore() async {
        guard let server = session.server, session.token != nil else {
            state = .signedOut
            return
        }
        let client = makeClient(server)
        do {
            let me: Me = try await client.get("/api/auth/me")
            self.client = client
            state = .signedIn(me)
        } catch let error as APIError where error.status == 401 {
            state = .signedOut
        } catch {
            self.client = client
            state = .signedIn(Me.offline)
        }
    }

    func signIn(address: String, username: String, password: String) async throws {
        guard let server = ServerAddress.normalize(address) else {
            throw APIError(status: 0, code: "bad_address", message: "Enter a server address, like media.tailnet.ts.net")
        }
        let (me, token) = try await Auth.login(server: server, username: username, password: password)
        session.save(server: server, token: token)
        client = makeClient(server)
        state = .signedIn(me)
    }

    func signOut() async {
        _ = try? await client?.send("POST", "/api/auth/logout", as: NoContent.self)
        signedOutByServer()
    }

    private func signedOutByServer() {
        session.clear()
        client = nil
        state = .signedOut
    }

    private func makeClient(_ server: URL) -> APIClient {
        let session = self.session
        return APIClient(
            baseURL: server,
            token: { session.token },
            onUnauthorized: { [weak self] in
                Task { @MainActor in self?.signedOutByServer() }
            }
        )
    }
}

extension Me {
    /// Stands in for the user while the server cannot be reached.
    static let offline = Me(id: "", username: "", role: "user", canRunCommands: false, mustChangePassword: false)
}
