import Foundation
import Testing
@testable import FreeWANKit

@Suite struct SettingsTests {
    @Test func health() async throws {
        let stub = StubTransport(json: #"{"status":"ok","version":"0.7.0","uptime":12.5,"timestamp":"2026-10-01T00:00:00Z"}"#)
        #expect(try await Health.fetch(APIClient(baseURL: server, transport: stub)).version == "0.7.0")
    }

    @Test func labels() {
        #expect(Format.role("admin") == "Admin")
        #expect(Format.role("") == "")
        #expect(Format.appVersion(short: "0.1.0", build: "12") == "0.1.0 (12)")
        #expect(Format.appVersion(short: "1", build: "1") == "1")
        #expect(Format.appVersion(short: nil, build: "3") == "Unknown")
    }
}
