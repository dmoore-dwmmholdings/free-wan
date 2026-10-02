import Foundation

/// `GET /api/health`: the server's version, for Settings.
public struct Health: Codable, Equatable, Sendable {
    public let status: String
    public let version: String

    public static func fetch(_ client: APIClient) async throws -> Health {
        try await client.get("/api/health")
    }
}

extension Format {
    /// "admin" to "Admin". Roles are lowercase identifiers on the server.
    public static func role(_ role: String) -> String {
        role.prefix(1).uppercased() + role.dropFirst()
    }

    /// "0.1.0 (12)" from the bundle's short version and build number.
    public static func appVersion(short: String?, build: String?) -> String {
        switch (short, build) {
        case let (short?, build?) where short != build: return "\(short) (\(build))"
        case let (short?, _): return short
        default: return "Unknown"
        }
    }
}
