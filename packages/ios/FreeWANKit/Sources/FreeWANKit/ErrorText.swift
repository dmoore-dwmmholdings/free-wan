import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// A failure put into words for a person: what happened and what to do about it.
public struct ErrorText: Equatable, Sendable {
    public let title: String
    public let message: String
    /// The server could not be reached at all, so downloads are worth mentioning.
    public let offline: Bool

    static let checkNetwork = "Check that it is running and that this phone is on the same network or tailnet."

    public init(_ error: Error) {
        switch error {
        case let api as APIError:
            self = Self.describe(api)
        case let url as URLError where url.code == .timedOut:
            self = Self.describe(APIError(status: 0, code: "timeout", message: url.localizedDescription))
        case is URLError:
            self = Self.describe(APIError(status: 0, code: "unreachable", message: error.localizedDescription))
        default:
            self = ErrorText(title: "Something went wrong", message: error.localizedDescription, offline: false)
        }
    }

    init(title: String, message: String, offline: Bool) {
        self.title = title
        self.message = message
        self.offline = offline
    }

    private static func describe(_ error: APIError) -> ErrorText {
        switch (error.status, error.code) {
        case (_, "timeout"):
            return ErrorText(title: "Your server is not answering",
                             message: "It did not reply within \(Int(APIClient.requestTimeout)) seconds. " + checkNetwork,
                             offline: true)
        case (0, _):
            return ErrorText(title: "Cannot reach your server", message: checkNetwork, offline: true)
        case (401, _):
            return ErrorText(title: "Signed out", message: "Your session has ended. Sign in again.", offline: false)
        case (403, _):
            return ErrorText(title: "Not allowed", message: error.message, offline: false)
        case (404, _):
            return ErrorText(title: "Not found", message: "It may have been removed from your server.", offline: false)
        case (500..., _):
            return ErrorText(title: "Your server had a problem", message: error.message, offline: false)
        case (_, "bad_response"):
            // Usually something between the phone and the server answering in its place.
            return ErrorText(title: "Unexpected answer", message: error.message, offline: false)
        default:
            return ErrorText(title: "Something went wrong", message: error.message, offline: false)
        }
    }
}
