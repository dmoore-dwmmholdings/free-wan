import Foundation
import Testing
@testable import FreeWANKit

@Suite struct PlaybackTests {
    @Test func decodesDescriptor() async throws {
        let stub = StubTransport(json: #"{"mode":"hls","url":"/api/media/m/hls/master.m3u8","captions":[{"id":"s","label":"English","language":"en","url":"/api/media/m/captions/s.vtt","default":true}],"resumeAt":42.5,"duration":600}"#)
        let d = try await MediaAPI.playback(APIClient(baseURL: server, transport: stub), id: "m")
        #expect(d.mode == "hls")
        #expect(d.resumeAt == 42.5)
        #expect(d.captions.first?.default == true)
        #expect(stub.requests[0].url?.path == "/api/media/m/playback")
    }

    @Test func reportsProgress() async throws {
        let stub = StubTransport(status: 204, json: "")
        let client = APIClient(baseURL: server, transport: stub)
        try await MediaAPI.reportProgress(client, id: "m", position: 12.5, duration: 600)
        try await MediaAPI.reportProgress(client, id: "m", position: 13, duration: nil)
        let first = try JSONSerialization.jsonObject(with: stub.requests[0].httpBody!) as! [String: Double]
        #expect(first == ["positionS": 12.5, "durationS": 600])
        let second = try JSONSerialization.jsonObject(with: stub.requests[1].httpBody!) as! [String: Double]
        #expect(second == ["positionS": 13], "a missing duration is left out, not sent as null")
    }

    @Test func reportPolicy() {
        var p = ProgressPolicy()
        let results = [3, .nan, 10, 10.5, 11.2, 8].map { p.shouldReport($0) }
        // Opening seconds and NaN are skipped, a barely moved position too; seeking back counts.
        #expect(results == [false, false, true, false, true, true])
    }

    @Test func resume() {
        #expect(ProgressPolicy.resumePosition(resumeAt: 120, playedTo: 0) == 120)
        #expect(ProgressPolicy.resumePosition(resumeAt: 120, playedTo: 30) == nil)
        #expect(ProgressPolicy.resumePosition(resumeAt: nil, playedTo: 0) == nil)
        #expect(ProgressPolicy.resumePosition(resumeAt: 0, playedTo: 0) == nil)
    }
}
