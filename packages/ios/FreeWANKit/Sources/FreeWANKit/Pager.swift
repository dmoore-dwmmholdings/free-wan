import Foundation
import Observation

/// One page of a cursor-paged list.
public struct Page<Item: Sendable>: Sendable {
    public let items: [Item]
    public let nextCursor: String?

    public init(items: [Item], nextCursor: String?) {
        self.items = items
        self.nextCursor = nextCursor
    }
}

/// A cursor-paged list: first load, load more, refresh. A reload discards any page still in
/// flight from before it, so changing a filter mid-scroll cannot splice old results in.
@MainActor
@Observable
public final class Pager<Item: Identifiable & Sendable> {
    public private(set) var items: [Item] = []
    public private(set) var loading = false
    public private(set) var loadingMore = false
    public private(set) var error: Error?
    /// True once a first page has arrived (even an empty one).
    public private(set) var loaded = false
    public private(set) var total: Int?

    private var cursor: String?
    private var finished = false
    private var generation = 0
    private let fetch: @Sendable (String?) async throws -> (Page<Item>, Int?)

    /// `fetch` takes the cursor (nil for the first page) and returns the page and, if known,
    /// the total count.
    public init(fetch: @escaping @Sendable (String?) async throws -> (Page<Item>, Int?)) {
        self.fetch = fetch
    }

    public var hasMore: Bool { loaded && !finished }

    /// Starts over from the first page. Keeps the current items on screen until the new ones
    /// arrive, so pull to refresh does not flash an empty grid.
    public func reload() async {
        generation += 1
        let mine = generation
        loading = true
        loadingMore = false
        error = nil
        do {
            let (page, total) = try await fetch(nil)
            guard mine == generation else { return }
            items = page.items
            self.total = total
            cursor = page.nextCursor
            finished = page.nextCursor == nil
            loaded = true
        } catch {
            guard mine == generation else { return }
            self.error = error
        }
        loading = false
    }

    /// Loads the next page if there is one and nothing else is loading.
    public func loadMore() async {
        guard hasMore, !loading, !loadingMore, let cursor else { return }
        let mine = generation
        loadingMore = true
        defer { if mine == generation { loadingMore = false } }
        do {
            let (page, _) = try await fetch(cursor)
            guard mine == generation else { return }
            // A row can move between pages while scrolling; never show it twice.
            let seen = Set(items.map { AnyHashable($0.id) })
            items += page.items.filter { !seen.contains(AnyHashable($0.id)) }
            self.cursor = page.nextCursor
            finished = page.nextCursor == nil
        } catch {
            guard mine == generation else { return }
            self.error = error
        }
    }

    /// Changes one item in place, such as after liking it.
    public func update(_ id: Item.ID, _ change: (inout Item) -> Void) {
        guard let index = items.firstIndex(where: { $0.id == id }) else { return }
        change(&items[index])
    }
}

extension MediaAPI {
    /// A pager over `GET /api/media` for one query.
    @MainActor
    public static func pager(_ client: APIClient, _ query: MediaListQuery) -> Pager<MediaCard> {
        Pager { cursor in
            let response = try await list(client, query, cursor: cursor)
            return (Page(items: response.data, nextCursor: response.nextCursor), response.total)
        }
    }
}
