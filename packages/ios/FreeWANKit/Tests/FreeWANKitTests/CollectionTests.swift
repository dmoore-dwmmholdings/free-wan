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
