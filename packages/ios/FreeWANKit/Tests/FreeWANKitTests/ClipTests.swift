import Foundation
import Testing
@testable import FreeWANKit

@Suite struct ClipTests {
    @Test func decodes() async throws {
        let stub = StubTransport(json: #"{"data":[{"id":"k","name":"Goal","sourceItemId":"m","startS":10,"endS":14.5,"durationS":4.5,"loop":true,"orphaned":false,"posterUrl":null,"previewUrl":"/api/clips/k/preview","exportStatus":"none","exportUrl":null,"createdAt":1,"updatedAt":2}]}"#)
        let clips = try await MediaAPI.clips(APIClient(baseURL: server, transport: stub))
        #expect(clips.first?.endS == 14.5)
    }

    @Test func preview() async throws {
        let stub = StubTransport(json: #"{"sourceUrl":"","startS":0,"endS":1,"loop":false,"orphaned":true}"#)
        let p = try await MediaAPI.clipPreview(APIClient(baseURL: server, transport: stub), id: "k")
        #expect(!p.playable)
        #expect(stub.requests[0].url?.path == "/api/clips/k/preview")
    }

    @Test func loopCommand() {
        #expect(ClipLoop.command(at: 12, startS: 10, endS: 14, loop: true) == nil)
        #expect(ClipLoop.command(at: 14, startS: 10, endS: 14, loop: true) == .init(seekTo: 10, pause: false))
        #expect(ClipLoop.command(at: 20, startS: 10, endS: 14, loop: false) == .init(seekTo: 10, pause: true))
    }
}
