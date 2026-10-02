import Foundation
import Testing
@testable import FreeWANKit

@Suite struct MediaQueryTests {
    @Test func defaults() {
        #expect(MediaListQuery().path() == "/api/media?limit=40&sort=added&order=desc")
    }

    @Test func everyFilter() {
        var q = MediaListQuery()
        q.search = "  c++ & more  "
        q.liked = true
        q.type = .video
        q.category = "cat1"
        q.collection = "col1"
        q.tags = ["t2", "t1"]
        q.sort = SortChoice.all[2]
        #expect(q.path(cursor: "abc=") ==
            "/api/media?limit=40&q=c%2B%2B%20%26%20more&liked=true&type=video&category=cat1&collection=col1"
            + "&sort=title&order=asc&tag=t1&tag=t2&cursor=abc%3D")
    }

    @Test func sortChoicesAreUnique() {
        #expect(Set(SortChoice.all.map(\.id)).count == SortChoice.all.count)
        #expect(SortChoice.default.id == "added:desc")
    }

    @Test func listCallsServer() async throws {
        let stub = StubTransport(json: ##"{"data":[{"id":"m1","type":"video","title":"A","durationS":61.5,"width":1920,"height":1080,"posterUrl":"/api/media/m1/poster","repositoryId":"r1","categoryPath":null,"liked":false,"likeCount":0}],"nextCursor":"n","total":1}"##)
        let page = try await MediaAPI.list(APIClient(baseURL: server, transport: stub), MediaListQuery())
        #expect(page.data.first?.title == "A")
        #expect(page.nextCursor == "n")
    }

    @Test func categoriesAndTags() async throws {
        let cats = StubTransport(json: #"{"data":[{"id":"c","name":"Films","path":"Films","depth":0,"itemCount":3,"hasChildren":true}]}"#)
        let found = try await MediaAPI.categories(APIClient(baseURL: server, transport: cats), parent: "p 1")
        #expect(found.first?.name == "Films")
        #expect(cats.requests[0].url?.absoluteString == "https://media.example.ts.net/api/categories?parent=p%201")

        let tags = StubTransport(json: #"{"data":[{"id":"t","name":"Fav","color":null,"itemCount":2}]}"#)
        #expect(try await MediaAPI.tags(APIClient(baseURL: server, transport: tags)).first?.itemCount == 2)
    }
}

@Suite struct FormatTests {
    @Test func durations() {
        #expect(Format.duration(nil) == nil)
        #expect(Format.duration(0.4) == nil)
        #expect(Format.duration(5) == "0:05")
        #expect(Format.duration(245) == "4:05")
        #expect(Format.duration(3723) == "1:02:03")
    }
}

@Suite struct LibraryFilterTests {
    func node(_ id: String) -> CategoryNode {
        CategoryNode(id: id, name: id.uppercased(), path: id, depth: 0, itemCount: 0, hasChildren: true)
    }

    @Test func trail() {
        var t = CategoryTrail()
        #expect(t.current == nil)
        t.enter(node("a")); t.enter(node("b")); t.enter(node("c"))
        #expect(t.current?.id == "c")
        t.exit(to: 1)
        #expect(t.crumbs.map(\.id) == ["a"])
        t.exit(to: 0)
        #expect(t.crumbs.isEmpty)
    }

    @Test func emptyMessageNamesTheFilter() {
        var q = MediaListQuery()
        #expect(q.emptyMessage.hasPrefix("Your library is empty"))
        q.category = "c"
        #expect(q.emptyMessage.hasPrefix("This folder"))
        q.search = "cat"
        #expect(q.emptyMessage == "No results for \"cat\".")
        q.liked = true
        #expect(q.emptyMessage.hasPrefix("Nothing liked"))
        q.tags = ["t"]
        #expect(q.emptyMessage.hasPrefix("Nothing carries"))
        q.type = .image
        #expect(q.emptyMessage.hasPrefix("No photos"))
    }
}

@Suite struct DetailTests {
    static let json = ##"{"id":"m1","type":"video","title":"Film","durationS":5400,"width":1920,"height":1080,"posterUrl":"/api/media/m1/poster","repositoryId":"r","categoryPath":"Films/Old","liked":true,"likeCount":3,"ext":"mkv","sizeBytes":1500000000,"frameRate":23.976,"bitrate":null,"container":"matroska","videoCodec":"h264","audioCodec":"aac","audioTracks":1,"playbackMode":"direct","capturedAt":null,"addedAt":1700000000000,"relPath":"Films/Old/Film.mkv","categories":[{"id":"c","name":"Old","path":"Films/Old"}],"subtitles":[{"id":"s","kind":"sidecar","language":"en","label":null,"format":"srt"}],"tags":[{"id":"t","name":"Fav","color":"#ff0000"}]}"##

    @Test func decodes() async throws {
        let stub = StubTransport(json: Self.json)
        let d = try await MediaAPI.detail(APIClient(baseURL: server, transport: stub), id: "m1")
        #expect(d.resolution == "1920 x 1080")
        #expect(d.tags.first?.itemCount == nil)
        #expect(d.subtitles.count == 1)
        #expect(stub.requests[0].url?.path == "/api/media/m1")
    }

    @Test func likeUsesPutAndDelete() async throws {
        let stub = StubTransport(json: #"{"liked":true,"likeCount":4}"#)
        let client = APIClient(baseURL: server, transport: stub)
        #expect(try await MediaAPI.setLiked(client, id: "m1", liked: true) == LikeResponse(liked: true, likeCount: 4))
        _ = try await MediaAPI.setLiked(client, id: "m1", liked: false)
        #expect(stub.requests.map(\.httpMethod) == ["PUT", "DELETE"])
        #expect(stub.requests[0].url?.path == "/api/media/m1/like")
    }

    @Test func bytes() {
        #expect(Format.bytes(0) == "0 KB")
        #expect(Format.bytes(200) == "1 KB")
        #expect(Format.bytes(12_400) == "12 KB")
        #expect(Format.bytes(340_000_000) == "340 MB")
        #expect(Format.bytes(1_500_000_000) == "1.5 GB")
    }
}
