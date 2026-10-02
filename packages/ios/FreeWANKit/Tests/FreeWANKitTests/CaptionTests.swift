import Foundation
import Testing
@testable import FreeWANKit

@Suite struct CaptionTests {
    @Test func timestamps() {
        #expect(Captions.timestamp("00:01.500") == 1.5)
        #expect(Captions.timestamp("01:02:03.004") == 3723.004)
        #expect(Captions.timestamp("00:00:01,5") == 1.5)
        #expect(Captions.timestamp(" 1:05.25 ") == 65.25)
        #expect(Captions.timestamp("00:61.000") == nil)
        #expect(Captions.timestamp("1.5") == nil)
        #expect(Captions.timestamp("aa:bb.ccc") == nil)
    }

    @Test func parsesAndCleans() {
        let vtt = "\u{FEFF}WEBVTT\r\n\r\nNOTE a comment\r\n\r\n1\r\n00:00:02.000 --> 00:00:04.000 align:start\r\n<i>Hello</i> &amp; <b>welcome</b>\r\nline two\r\n\r\n00:00:01.000 --> 00:00:01.500\r\nFirst\r\n\r\n00:00:05.000 --> 00:00:04.000\r\nBackwards\r\n\r\n00:00:06.000 --> 00:00:07.000\r\n\r\nSTYLE\r\n::cue { color: red }\r\n"
        let cues = Captions.parse(vtt)
        #expect(cues == [
            Cue(start: 1, end: 1.5, text: "First"),
            Cue(start: 2, end: 4, text: "Hello & welcome\nline two"),
        ])
    }

    @Test func cueLookup() {
        let cues = [Cue(start: 1, end: 5, text: "a"), Cue(start: 3, end: 4, text: "b"), Cue(start: 6, end: 7, text: "c")]
        #expect(Captions.cue(in: cues, at: 0.5) == nil)
        #expect(Captions.cue(in: cues, at: 2)?.text == "a")
        #expect(Captions.cue(in: cues, at: 3.5)?.text == "b", "the later start wins while both run")
        #expect(Captions.cue(in: cues, at: 4.5)?.text == "a")
        #expect(Captions.cue(in: cues, at: 5.5) == nil)
    }

    @Test func fetchUsesLongTimeout() async throws {
        let stub = StubTransport(json: "WEBVTT\n\n00:00.000 --> 00:01.000\nHi\n")
        let cues = try await Captions.fetch(APIClient(baseURL: server, transport: stub, token: { "t" }), path: "/api/media/m/captions/s.vtt")
        #expect(cues.count == 1)
        #expect(stub.requests[0].timeoutInterval == Captions.fetchTimeout)
        #expect(stub.requests[0].value(forHTTPHeaderField: "Authorization") == "Bearer t")
    }
}
