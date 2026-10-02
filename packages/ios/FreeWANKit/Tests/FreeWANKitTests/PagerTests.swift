import Foundation
import Testing
@testable import FreeWANKit

struct Row: Identifiable, Sendable, Equatable {
    let id: Int
}

/// Serves pages from a table keyed by cursor, optionally waiting on a gate first.
actor PageSource {
    var pages: [String: Page<Row>] = [:]
    var calls: [String] = []
    var failNext = false

    func set(_ cursor: String, _ ids: [Int], next: String?) {
        pages[cursor] = Page(items: ids.map(Row.init), nextCursor: next)
    }

    func fail() { failNext = true }

    func get(_ cursor: String?) throws -> Page<Row> {
        let key = cursor ?? "first"
        calls.append(key)
        if failNext { failNext = false; throw APIError(status: 500, code: "internal", message: "boom") }
        return pages[key]!
    }
}

@MainActor
@Suite struct PagerTests {
    func pager(_ source: PageSource) -> Pager<Row> {
        Pager { cursor in (try await source.get(cursor), nil) }
    }

    @Test func pagesThroughAndStops() async {
        let source = PageSource()
        await source.set("first", [1, 2], next: "a")
        await source.set("a", [2, 3], next: nil)
        let p = pager(source)
        await p.reload()
        #expect(p.items.map(\.id) == [1, 2])
        #expect(p.hasMore)
        await p.loadMore()
        #expect(p.items.map(\.id) == [1, 2, 3], "duplicates across pages dropped")
        #expect(!p.hasMore)
        await p.loadMore()
        #expect(await source.calls == ["first", "a"])
    }

    @Test func errorKeepsItems() async {
        let source = PageSource()
        await source.set("first", [1], next: "a")
        let p = pager(source)
        await p.reload()
        await source.fail()
        await p.reload()
        #expect(p.items.map(\.id) == [1])
        #expect(p.error != nil)
        #expect(!p.loading)
    }

    @Test func emptyFirstPageIsLoaded() async {
        let source = PageSource()
        await source.set("first", [], next: nil)
        let p = pager(source)
        await p.reload()
        #expect(p.loaded && p.items.isEmpty && !p.hasMore)
    }

    @Test func updateInPlace() async {
        let source = PageSource()
        await source.set("first", [1, 2], next: nil)
        let p = pager(source)
        await p.reload()
        p.update(2) { $0 = Row(id: 2) }
        #expect(p.items.count == 2)
    }
}

@Suite struct RawDataTests {
    @Test func dataSendsAuthAndThrowsOnError() async throws {
        let stub = StubTransport(status: 200, json: "PNG")
        let client = APIClient(baseURL: server, transport: stub, token: { "t" })
        #expect(try await client.data("/api/media/m/poster") == Data("PNG".utf8))
        #expect(stub.requests[0].value(forHTTPHeaderField: "Authorization") == "Bearer t")
        stub.status = 404
        await #expect(throws: APIError.self) { _ = try await client.data("/x") }
    }
}
