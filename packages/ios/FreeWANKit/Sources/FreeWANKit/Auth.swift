import Foundation

/// Mirrors `meSchema` in packages/shared/src/auth.ts.
public struct Me: Codable, Equatable, Sendable {
    public let id: String
    public let username: String
    public let role: String
    public let canRunCommands: Bool
    public let mustChangePassword: Bool

    public init(id: String, username: String, role: String, canRunCommands: Bool, mustChangePassword: Bool) {
        self.id = id
        self.username = username
        self.role = role
        self.canRunCommands = canRunCommands
        self.mustChangePassword = mustChangePassword
    }
}

struct LoginRequest: Encodable {
    let username: String
    let password: String
    /// Native clients get the session token in the body instead of a cookie, because AVPlayer
    /// and background downloads take headers, not a cookie jar.
    let client = "native"
}

struct LoginResponse: Decodable {
    let user: Me
    let token: String?
}

public enum Auth {
    /// Signs in against an address that has only just been typed, before any session exists.
    public static func login(
        server: URL, username: String, password: String,
        transport: HTTPTransport = URLSessionTransport()
    ) async throws -> (user: Me, token: String) {
        let client = APIClient(baseURL: server, transport: transport)
        let response: LoginResponse = try await client.send(
            "POST", "/api/auth/login", body: LoginRequest(username: username, password: password))
        guard let token = response.token else {
            throw APIError(status: 0, code: "no_token",
                           message: "The server did not return a session token. It may need updating.")
        }
        return (response.user, token)
    }
}
