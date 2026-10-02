import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
@testable import FreeWANKit

/// Answers every request with one canned response and records what was sent.
final class StubTransport: HTTPTransport, @unchecked Sendable {
    var status: Int
    var body: Data
    private(set) var requests: [URLRequest] = []

    init(status: Int = 200, json: String = "{}") {
        self.status = status
        self.body = Data(json.utf8)
    }

    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        requests.append(request)
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!
        return (body, response)
    }
}

let server = URL(string: "https://media.example.ts.net")!
