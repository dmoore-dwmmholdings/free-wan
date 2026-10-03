import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
@testable import FreeWANKit

/// Answers every request with one canned response, or each in turn from a list, and records
/// what was sent.
final class StubTransport: HTTPTransport, @unchecked Sendable {
    var status: Int
    var body: Data
    private var queued: [(Int, String)] = []
    private(set) var requests: [URLRequest] = []

    init(status: Int = 200, json: String = "{}") {
        self.status = status
        self.body = Data(json.utf8)
    }

    init(responses: [(Int, String)]) {
        self.status = 200
        self.body = Data()
        self.queued = responses
    }

    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        requests.append(request)
        if !queued.isEmpty {
            let (code, json) = queued.removeFirst()
            status = code
            body = Data(json.utf8)
        }
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!
        return (body, response)
    }
}

let server = URL(string: "https://media.example.ts.net")!
