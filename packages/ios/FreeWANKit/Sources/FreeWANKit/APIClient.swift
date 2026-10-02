import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Any non-2xx response, carrying the server's `{ error: { code, message } }` envelope.
public struct APIError: Error, Equatable, LocalizedError {
    public let status: Int
    public let code: String
    public let message: String

    public init(status: Int, code: String, message: String) {
        self.status = status
        self.code = code
        self.message = message
    }

    public var errorDescription: String? { message }
}

/// The one seam between the client and the network, so tests can answer requests directly.
public protocol HTTPTransport: Sendable {
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse)
}

public struct URLSessionTransport: HTTPTransport {
    private let session: URLSession

    public init(session: URLSession = .shared) {
        self.session = session
    }

    public func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch let error as URLError where error.code == .timedOut {
            throw APIError(status: 0, code: "timeout", message: "The server did not answer in time")
        } catch let error as URLError {
            throw APIError(status: 0, code: "unreachable", message: error.localizedDescription)
        }
        guard let http = response as? HTTPURLResponse else {
            throw APIError(status: 0, code: "bad_response", message: "The server sent a response this app could not read")
        }
        return (data, http)
    }
}

/// Decodes a 204 or an empty body.
public struct NoContent: Decodable, Sendable {
    public init() {}
}

public final class APIClient: @unchecked Sendable {
    /// A phone that drifts off the tailnet mid-request would otherwise wait on the platform's
    /// socket timeout, up to a minute, with nothing to press.
    public static let requestTimeout: TimeInterval = 20

    public let baseURL: URL
    private let transport: HTTPTransport
    private let token: @Sendable () -> String?
    private let onUnauthorized: @Sendable () -> Void

    public init(
        baseURL: URL,
        transport: HTTPTransport = URLSessionTransport(),
        token: @escaping @Sendable () -> String? = { nil },
        onUnauthorized: @escaping @Sendable () -> Void = {}
    ) {
        self.baseURL = baseURL
        self.transport = transport
        self.token = token
        self.onUnauthorized = onUnauthorized
    }

    /// Absolute URL for an API path, which may carry a query string.
    public func url(_ path: String) throws -> URL {
        guard let url = URL(string: baseURL.absoluteString + path) else {
            throw APIError(status: 0, code: "bad_request", message: "Invalid request path")
        }
        return url
    }

    /// For requests made outside this client: AVPlayer, downloads, image loading.
    public var authHeaders: [String: String] {
        guard let token = token() else { return [:] }
        return ["Authorization": "Bearer \(token)"]
    }

    public func get<T: Decodable>(_ path: String, as type: T.Type = T.self) async throws -> T {
        try await send("GET", path, as: type)
    }

    /// `signOutOn401: false` is for requests where a 401 means wrong input, not a dead session,
    /// such as checking the current password.
    public func send<T: Decodable>(
        _ method: String, _ path: String, body: (any Encodable)? = nil, as type: T.Type = T.self,
        signOutOn401: Bool = true
    ) async throws -> T {
        var request = URLRequest(url: try url(path), timeoutInterval: Self.requestTimeout)
        request.httpMethod = method
        for (name, value) in authHeaders {
            request.setValue(value, forHTTPHeaderField: name)
        }
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONEncoder().encode(body)
        }

        let (data, response) = try await transport.send(request)
        guard (200..<300).contains(response.statusCode) else {
            // A revoked or expired session must not leave the app on screens that 401 forever.
            if response.statusCode == 401 && signOutOn401 { onUnauthorized() }
            throw Self.error(status: response.statusCode, body: data)
        }
        if data.isEmpty, let empty = NoContent() as? T { return empty }
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw APIError(status: response.statusCode, code: "bad_response",
                           message: "The server sent a response this app could not read")
        }
    }

    /// An error body is not necessarily JSON: Tailscale Serve, a gateway or a captive portal
    /// answers with HTML, and the status is then all there is.
    static func error(status: Int, body: Data) -> APIError {
        struct Envelope: Decodable {
            struct Inner: Decodable { let code: String?; let message: String? }
            let error: Inner?
        }
        let inner = (try? JSONDecoder().decode(Envelope.self, from: body))?.error
        return APIError(
            status: status,
            code: inner?.code ?? "internal",
            message: inner?.message ?? HTTPURLResponse.localizedString(forStatusCode: status).capitalized
        )
    }
}
