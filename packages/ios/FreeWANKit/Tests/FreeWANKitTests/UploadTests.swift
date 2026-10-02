import Foundation
import Testing
@testable import FreeWANKit

@Suite struct UploadTests {
    @Test func names() {
        #expect(Uploads.fileName(given: " IMG_1.HEIC ", index: 0, isVideo: false) == "IMG_1.HEIC")
        #expect(Uploads.fileName(given: nil, index: 2, isVideo: true) == "upload-3.mp4")
        #expect(Uploads.fileName(given: "", index: 0, isVideo: false) == "upload-1.jpg")
    }

    @Test func outcomes() throws {
        let saved = try Uploads.outcome(name: "a.jpg", status: 202, body: Data(#"{"uploaded":1,"files":["a (1).jpg"],"skipped":[]}"#.utf8))
        #expect(saved == UploadOutcome(name: "a (1).jpg", ok: true, reason: nil))
        let skipped = try Uploads.outcome(name: "b.exe", status: 422, body: Data(#"{"uploaded":0,"files":[],"skipped":[{"name":"b.exe","reason":"not a media file"}]}"#.utf8))
        #expect(skipped == UploadOutcome(name: "b.exe", ok: false, reason: "not a media file"))
        #expect(throws: APIError(status: 403, code: "forbidden", message: "Repository is read-only")) {
            try Uploads.outcome(name: "c", status: 403, body: Data(#"{"error":{"code":"forbidden","message":"Repository is read-only"}}"#.utf8))
        }
    }

    @Test func summaries() {
        let ok = UploadOutcome(name: "a", ok: true, reason: nil)
        let bad = UploadOutcome(name: "b", ok: false, reason: "too large")
        #expect(Uploads.summary([ok], stopped: false).title == "Uploaded")
        #expect(Uploads.summary([ok, ok], stopped: false).title == "2 uploaded")
        let mixed = Uploads.summary([ok, bad], stopped: false)
        #expect(mixed.title == "1 uploaded, 1 skipped" && mixed.body == "b: too large")
        #expect(Uploads.summary([bad], stopped: false).title == "Nothing was uploaded")
        #expect(Uploads.summary([], stopped: true).body == "Nothing was uploaded.")
        #expect(Uploads.summary([ok], stopped: true).body == "1 file had already finished and is in your library.")
        let many = Array(repeating: bad, count: 7)
        #expect(Uploads.summary(many, stopped: false).body.hasSuffix("and 2 more"))
    }

    @Test func multipartBodyOnDisk() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        let source = dir.appendingPathComponent("in.bin")
        try Data("PAYLOAD".utf8).write(to: source)
        let body = dir.appendingPathComponent("body")
        try Multipart.write(file: source, to: body, boundary: "B", fileName: "my \"clip\".mov", mimeType: "video/quicktime")
        let text = String(decoding: try Data(contentsOf: body), as: UTF8.self)
        #expect(text == "--B\r\nContent-Disposition: form-data; name=\"file\"; filename=\"my 'clip'.mov\"\r\nContent-Type: video/quicktime\r\n\r\nPAYLOAD\r\n--B--\r\n")
    }

    @Test func targetsAndPath() async throws {
        let stub = StubTransport(json: #"{"data":[{"id":"r1","name":"Phone","type":"mixed"}]}"#)
        #expect(try await Uploads.targets(APIClient(baseURL: server, transport: stub)).first?.name == "Phone")
        #expect(Uploads.path(repository: "r1") == "/api/repositories/r1/upload")
    }
}
