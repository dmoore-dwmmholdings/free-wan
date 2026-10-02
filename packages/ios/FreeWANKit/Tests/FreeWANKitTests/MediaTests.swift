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
