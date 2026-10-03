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
    /// Who the token belongs to; the server wraps it as `{ user }`.
    public static func me(_ client: APIClient) async throws -> Me {
        struct Response: Decodable { let user: Me }
        let response: Response = try await client.get("/api/auth/me")
        return response.user
    }

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

public enum PasswordChange {
    /// Mirrors `passwordSchema` in packages/shared/src/auth.ts.
    public static let minLength = 8
    public static let maxLength = 200

    /// Why the form cannot be submitted yet, or nil when it can. Only complains about a field
    /// once something has been typed into it.
    public static func problem(current: String, new: String, confirm: String) -> String? {
        if !new.isEmpty && new.count < minLength { return "At least \(minLength) characters." }
        if new.count > maxLength { return "At most \(maxLength) characters." }
        if !confirm.isEmpty && new != confirm { return "These do not match." }
        return nil
    }

    public static func canSubmit(current: String, new: String, confirm: String) -> Bool {
        !current.isEmpty && new.count >= minLength && new == confirm
            && problem(current: current, new: new, confirm: confirm) == nil
    }

    /// The server answers a wrong current password with 401, which must not end the session.
    public static func submit(client: APIClient, current: String, new: String) async throws {
        struct Body: Encodable { let currentPassword: String; let newPassword: String }
        let _: NoContent = try await client.send(
            "POST", "/api/auth/password", body: Body(currentPassword: current, newPassword: new),
            signOutOn401: false)
    }
}
