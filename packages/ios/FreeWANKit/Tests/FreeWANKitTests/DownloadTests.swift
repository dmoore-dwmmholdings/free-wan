import Foundation
import Testing
@testable import FreeWANKit

@Suite struct DownloadTests {
    let job = DownloadJob(id: "m1", title: "Film", type: .video, durationS: 90, ext: "mp4")

    func record(_ id: String, at seconds: Double, bytes: Int64 = 10) -> DownloadRecord {
        let j = DownloadJob(id: id, title: id, type: .video, durationS: nil, ext: "mp4")
        return DownloadRecord(job: j, fileName: DownloadFiles.fileName(id: id, ext: "mp4"),
                              posterFileName: DownloadFiles.posterName(id: id), bytes: bytes,
                              completedAt: Date(timeIntervalSince1970: seconds))
    }

    @Test func jobRoundTripsThroughTaskDescription() {
        #expect(DownloadJob(encoded: job.encoded) == job)
        #expect(DownloadJob(encoded: "not json") == nil)
        #expect(DownloadJob(encoded: nil) == nil)
        #expect(job.rawPath == "/api/media/m1/raw")
    }

    @Test func fileNames() {
        #expect(DownloadFiles.fileName(id: "0191-abc", ext: "MKV") == "0191-abc.mkv")
        #expect(DownloadFiles.fileName(id: "../evil/x", ext: "mp4") == "___evil_x.mp4")
        #expect(DownloadFiles.fileName(id: "m1", ext: nil) == "m1")
        #expect(DownloadFiles.fileName(id: "m1", ext: "a.b/c") == "m1.abc")
        #expect(DownloadFiles.posterName(id: "m1") == "m1.poster.jpg")
    }

    @Test func progress() {
        #expect(DownloadFiles.progress(written: 50, expected: 200) == 0.25)
        #expect(DownloadFiles.progress(written: 50, expected: -1) == 0, "size unknown")
        #expect(DownloadFiles.progress(written: 300, expected: 200) == 1)
    }

    @Test func indexOrderPruneAndOrphans() throws {
        var index = DownloadIndex()
        index.add(record("a", at: 1, bytes: 5))
        index.add(record("b", at: 2, bytes: 7))
        #expect(index.sorted.map(\.id) == ["b", "a"])
        #expect(index.totalBytes == 12)

        let files: Set = ["a.mp4", "a.poster.jpg", "half-done.tmp", "index.json"]
        #expect(index.orphans(in: files.union(["b.mp4", "b.poster.jpg"])) == ["half-done.tmp"])
        index.prune(keeping: files)
        #expect(index.records.keys.sorted() == ["a"], "b's file is gone")

        let data = try JSONEncoder().encode(index)
        #expect(try JSONDecoder().decode(DownloadIndex.self, from: data) == index)
        #expect(index.remove("a")?.id == "a")
        #expect(index.sorted.isEmpty)
    }
}

@Suite struct OfflineHintTests {
    @Test func hint() {
        #expect(Format.offlineHint(downloads: 0) == nil)
        #expect(Format.offlineHint(downloads: 1) == "1 download is still playable from the Downloads tab.")
        #expect(Format.offlineHint(downloads: 3)?.hasPrefix("3 downloads are") == true)
    }
}
