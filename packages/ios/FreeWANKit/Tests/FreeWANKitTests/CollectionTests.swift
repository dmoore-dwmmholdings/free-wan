import Foundation
import Testing
@testable import FreeWANKit

@Suite struct CollectionTests {
    @Test func decodesList() async throws {
        let stub = StubTransport(json: #"{"data":[{"id":"c1","name":"Trips","description":null,"coverItemId":"m1","coverUrl":"/api/media/m1/poster","itemCount":1,"createdAt":1,"updatedAt":2}]}"#)
        let list = try await MediaAPI.collections(APIClient(baseURL: server, transport: stub))
        #expect(list.first?.name == "Trips")
        #expect(list.first?.coverUrl == "/api/media/m1/poster")
    }

    @Test func queryFiltersByCollection() {
        #expect(MediaAPI.collectionQuery("c 1").path().contains("collection=c%201"))
    }

    @Test func counts() {
        #expect(Format.count(1, "item") == "1 item")
        #expect(Format.count(0, "item") == "0 items")
        #expect(Format.count(2, "child", "children") == "2 children")
    }
}

@Suite struct CollectionPosterTests {
    @Test func asksForTheFirstFourInCollectionOrder() async throws {
        let stub = StubTransport(json: #"{"data":[{"id":"a","type":"video","title":"A","durationS":1,"width":null,"height":null,"posterUrl":"/api/media/a/poster","repositoryId":"r","categoryPath":null,"liked":false,"likeCount":0}],"nextCursor":null,"total":1}"#)
        let posters = try await MediaAPI.collectionPosters(APIClient(baseURL: server, transport: stub), id: "c1")
        #expect(posters == ["/api/media/a/poster"])
        let url = try #require(stub.requests.first?.url?.absoluteString)
        #expect(url.contains("limit=4") && url.contains("collection=c1"))
    }
}

