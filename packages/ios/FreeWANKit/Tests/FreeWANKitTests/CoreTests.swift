import Foundation
import Testing
@testable import FreeWANKit

@Suite struct ServerAddressTests {
    @Test(arguments: [
        ("media.tail1234.ts.net", "https://media.tail1234.ts.net"),
        ("  Media.Tail1234.ts.net/  ", "https://media.tail1234.ts.net"),
        ("http://192.168.1.10:8080", "http://192.168.1.10:8080"),
        ("https://media.ts.net/library?x=1", "https://media.ts.net"),
        ("https://media.ts.net:443", "https://media.ts.net"),
        ("HTTP://host:80/", "http://host"),
    ])
    func normalizes(input: String, expected: String) {
        #expect(ServerAddress.normalize(input)?.absoluteString == expected)
    }

    @Test(arguments: ["", "   ", "https://", "not a host"])
    func rejects(input: String) {
        #expect(ServerAddress.normalize(input) == nil)
    }
}

@Suite struct APIClientTests {
    @Test func sendsBearerToken() async throws {
        let stub = StubTransport(json: #"{"id":"1","username":"admin","role":"admin","canRunCommands":true,"mustChangePassword":false}"#)
        let client = APIClient(baseURL: server, transport: stub, token: { "abc" })
        let me: Me = try await client.get("/api/auth/me")
        #expect(me.username == "admin")
        #expect(stub.requests.first?.value(forHTTPHeaderField: "Authorization") == "Bearer abc")
        #expect(stub.requests.first?.url?.absoluteString == "https://media.example.ts.net/api/auth/me")
    }

    @Test func readsErrorEnvelope() async {
        let stub = StubTransport(status: 422, json: #"{"error":{"code":"validation_error","message":"Bad input"}}"#)
        let client = APIClient(baseURL: server, transport: stub)
        await #expect(throws: APIError(status: 422, code: "validation_error", message: "Bad input")) {
            let _: NoContent = try await client.send("POST", "/api/x")
        }
    }

    @Test func survivesHTMLErrorBody() async {
        let stub = StubTransport(status: 502, json: "<html>Bad Gateway</html>")
        let client = APIClient(baseURL: server, transport: stub)
        do {
            let _: NoContent = try await client.get("/api/x")
            Issue.record("expected an error")
        } catch let error as APIError {
            #expect(error.status == 502)
            #expect(error.code == "internal")
        } catch {
            Issue.record("unexpected \(error)")
        }
    }

    @Test func unauthorizedSignsOut() async {
        let stub = StubTransport(status: 401, json: #"{"error":{"code":"unauthorized","message":"Authentication required"}}"#)
        let flag = MemoryStore()
        let client = APIClient(baseURL: server, transport: stub, onUnauthorized: { flag.set("hit", "1") })
        _ = try? await client.get("/api/auth/me", as: NoContent.self)
        #expect(flag.get("hit") == "1")
    }

    @Test func acceptsEmptyBody() async throws {
        let stub = StubTransport(status: 204, json: "")
        let client = APIClient(baseURL: server, transport: stub)
        let _: NoContent = try await client.send("DELETE", "/api/x")
    }
}

@Suite struct AuthTests {
    @Test func loginAsksForNativeToken() async throws {
        let stub = StubTransport(json: #"{"user":{"id":"1","username":"admin","role":"admin","canRunCommands":true,"mustChangePassword":true},"token":"tok"}"#)
        let result = try await Auth.login(server: server, username: "admin", password: "pw", transport: stub)
        #expect(result.token == "tok")
        #expect(result.user.mustChangePassword)
        let sent = try JSONSerialization.jsonObject(with: stub.requests[0].httpBody!) as! [String: String]
        #expect(sent == ["username": "admin", "password": "pw", "client": "native"])
    }

    @Test func loginWithoutTokenFails() async {
        let stub = StubTransport(json: #"{"user":{"id":"1","username":"a","role":"user","canRunCommands":false,"mustChangePassword":false}}"#)
        await #expect(throws: APIError.self) {
            _ = try await Auth.login(server: server, username: "a", password: "b", transport: stub)
        }
    }
}

@Suite struct MeTests {
    @Test func readsTheWrappedUser() async throws {
        let stub = StubTransport(json: #"{"user":{"id":"u","username":"dawson","role":"admin","canRunCommands":true,"mustChangePassword":false}}"#)
        let me = try await Auth.me(APIClient(baseURL: server, transport: stub))
        #expect(me.username == "dawson" && me.role == "admin")
        #expect(stub.requests[0].url?.path == "/api/auth/me")
    }
}

@Suite struct SessionTests {
    let other = URL(string: "https://other.example.ts.net")!

    @Test func signingOutKeepsTheAddressForTheForm() {
        let session = Session(store: MemoryStore())
        let account = session.save(server: server, username: "me", token: "t")
        #expect(session.token == "t")
        session.remove(account.id)
        #expect(session.token == nil)
        #expect(session.active == nil)
        #expect(session.recentServer == server)
    }

    @Test func keepsATokenPerServerAndSwitches() {
        let store = MemoryStore()
        let session = Session(store: store)
        let a = session.save(server: server, username: "me", token: "ta")
        let b = session.save(server: other, username: "me", token: "tb")
        #expect(session.server == other && session.token == "tb")
        session.activate(a.id)
        #expect(session.token == "ta")
        // Signing in again to the same server and user renews it rather than adding another.
        session.save(server: server, username: "me", token: "ta2")
        #expect(session.accounts.count == 2 && session.token == "ta2")
        // The list and choice survive a relaunch.
        let reopened = Session(store: store)
        #expect(reopened.accounts.map(\.id) == [a.id, b.id] && reopened.active?.id == a.id)
    }

    @Test func opensTheLastNonPrivateServer() {
        let session = Session(store: MemoryStore())
        let a = session.save(server: server, token: "ta")
        let b = session.save(server: other, token: "tb")
        #expect(session.openingAccount?.id == b.id)
        session.activate(a.id)
        #expect(session.openingAccount?.id == a.id)
        session.setPrivate(a.id, true)
        #expect(session.openingAccount?.id == b.id) // a private server is never opened on its own
        session.setPrivate(b.id, true)
        #expect(session.openingAccount == nil)
    }

    @Test func movesASingleServerSignInAcross() {
        let store = MemoryStore()
        store.set("server", server.absoluteString)
        store.set("token", "old")
        let session = Session(store: store)
        #expect(session.server == server && session.token == "old")
        #expect(store.get("server") == nil && store.get("token") == nil)

        let signedOut = MemoryStore()
        signedOut.set("server", server.absoluteString)
        let empty = Session(store: signedOut)
        #expect(empty.accounts.isEmpty && empty.recentServer == server)
    }
}

@Suite struct PasswordChangeTests {
    @Test func validation() {
        #expect(PasswordChange.problem(current: "", new: "", confirm: "") == nil)
        #expect(PasswordChange.problem(current: "a", new: "short", confirm: "") == "At least 8 characters.")
        #expect(PasswordChange.problem(current: "a", new: "longenough", confirm: "longenougX") == "These do not match.")
        #expect(PasswordChange.canSubmit(current: "a", new: "longenough", confirm: "longenough"))
        #expect(!PasswordChange.canSubmit(current: "", new: "longenough", confirm: "longenough"))
        #expect(!PasswordChange.canSubmit(current: "a", new: "short", confirm: "short"))
    }

    @Test func wrongCurrentPasswordKeepsSession() async {
        let stub = StubTransport(status: 401, json: #"{"error":{"code":"unauthorized","message":"Current password is incorrect"}}"#)
        let flag = MemoryStore()
        let client = APIClient(baseURL: server, transport: stub, token: { "t" }, onUnauthorized: { flag.set("hit", "1") })
        await #expect(throws: APIError(status: 401, code: "unauthorized", message: "Current password is incorrect")) {
            try await PasswordChange.submit(client: client, current: "bad", new: "longenough")
        }
        #expect(flag.get("hit") == nil)
        let sent = try? JSONSerialization.jsonObject(with: stub.requests[0].httpBody!) as? [String: String]
        #expect(sent == ["currentPassword": "bad", "newPassword": "longenough"])
    }
}
