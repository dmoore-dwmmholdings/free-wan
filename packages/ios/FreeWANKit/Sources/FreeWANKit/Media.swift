import Foundation

public enum MediaType: String, Codable, Sendable {
    case video, image
}

/// Mirrors `mediaCardSchema` in packages/shared/src/media.ts.
public struct MediaCard: Codable, Hashable, Identifiable, Sendable {
    public let id: String
    public let type: MediaType
    public let title: String
    public let durationS: Double?
    public let width: Double?
    public let height: Double?
    public let posterUrl: String
    public let repositoryId: String
    public let categoryPath: String?
    public var liked: Bool
    public var likeCount: Int
}

public struct MediaListResponse: Codable, Equatable, Sendable {
    public let data: [MediaCard]
    public let nextCursor: String?
    public let total: Int
}

/// `categoryNodeSchema`. Filtering by category uses its `id`.
public struct CategoryNode: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let name: String
    public let path: String
    public let depth: Int
    public let itemCount: Int
    public let hasChildren: Bool
}

/// `tagSchema`, plus `itemCount` when it comes from `GET /api/tags`.
public struct Tag: Codable, Equatable, Hashable, Identifiable, Sendable {
    public let id: String
    public let name: String
    public let color: String?
    public let itemCount: Int?
}

/// The `{ data: [...] }` envelope most list routes answer with.
public struct DataList<T: Decodable & Sendable>: Decodable, Sendable {
    public let data: [T]
}

public enum MediaSort: String, Codable, Sendable {
    case title, added, created, duration, popularity
}

public enum SortOrder: String, Codable, Sendable {
    case asc, desc
}

/// The orderings the sort sheet offers.
public struct SortChoice: Equatable, Hashable, Identifiable, Sendable {
    public let label: String
    public let sort: MediaSort
    public let order: SortOrder

    public var id: String { "\(sort.rawValue):\(order.rawValue)" }

    public static let all: [SortChoice] = [
        SortChoice(label: "Newest", sort: .added, order: .desc),
        SortChoice(label: "Oldest", sort: .added, order: .asc),
        SortChoice(label: "Title A to Z", sort: .title, order: .asc),
        SortChoice(label: "Title Z to A", sort: .title, order: .desc),
        SortChoice(label: "Longest", sort: .duration, order: .desc),
        SortChoice(label: "Shortest", sort: .duration, order: .asc),
        SortChoice(label: "Most liked", sort: .popularity, order: .desc),
    ]

    public static let `default` = all[0]
}

/// One page request against `GET /api/media` (`mediaQuerySchema`).
public struct MediaListQuery: Equatable, Hashable, Sendable {
    public var search = ""
    public var liked = false
    public var type: MediaType?
    public var category: String?
    public var collection: String?
    public var tags: Set<String> = []
    public var sort = SortChoice.default
    public static let pageSize = 40

    public init() {}

    /// The request path for one page; `cursor` is the previous page's `nextCursor`.
    public func path(cursor: String? = nil) -> String {
        var items: [(String, String)] = [("limit", String(Self.pageSize))]
        let q = search.trimmingCharacters(in: .whitespacesAndNewlines)
        if !q.isEmpty { items.append(("q", q)) }
        if liked { items.append(("liked", "true")) }
        if let type { items.append(("type", type.rawValue)) }
        if let category { items.append(("category", category)) }
        if let collection { items.append(("collection", collection)) }
        items.append(("sort", sort.sort.rawValue))
        items.append(("order", sort.order.rawValue))
        // Tags are AND-combined by the server; sorted so equal filters build equal paths.
        for tag in tags.sorted() { items.append(("tag", tag)) }
        if let cursor { items.append(("cursor", cursor)) }
        return "/api/media?" + Query.encode(items)
    }
}

enum Query {
    /// Unreserved characters only. URLQueryItem leaves `+` alone, which a server reads as a
    /// space, so a search for "c++" would arrive as "c  ".
    static let allowed = CharacterSet(charactersIn:
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")

    static func encode(_ items: [(String, String)]) -> String {
        items.map { "\(escape($0.0))=\(escape($0.1))" }.joined(separator: "&")
    }

    static func escape(_ value: String) -> String {
        value.addingPercentEncoding(withAllowedCharacters: allowed) ?? value
    }
}

public enum MediaAPI {
    public static func list(_ client: APIClient, _ query: MediaListQuery, cursor: String? = nil) async throws -> MediaListResponse {
        try await client.get(query.path(cursor: cursor))
    }

    /// Top-level categories, or the children of `parent` (a category id).
    public static func categories(_ client: APIClient, parent: String? = nil) async throws -> [CategoryNode] {
        let path = parent.map { "/api/categories?parent=" + Query.escape($0) } ?? "/api/categories"
        let list: DataList<CategoryNode> = try await client.get(path)
        return list.data
    }

    public static func tags(_ client: APIClient) async throws -> [Tag] {
        let list: DataList<Tag> = try await client.get("/api/tags")
        return list.data
    }
}

public enum Format {
    /// `1:02:03`, `4:05`, or nil for nothing or under a second.
    public static func duration(_ seconds: Double?) -> String? {
        guard let seconds, seconds >= 1 else { return nil }
        let total = Int(seconds.rounded())
        let (h, m, s) = (total / 3600, (total % 3600) / 60, total % 60)
        return h > 0 ? String(format: "%d:%02d:%02d", h, m, s) : String(format: "%d:%02d", m, s)
    }
}

/// The folders entered so far, root first. The last one filters the list.
public struct CategoryTrail: Equatable, Sendable {
    public struct Crumb: Equatable, Hashable, Sendable {
        public let id: String
        public let name: String
    }

    public private(set) var crumbs: [Crumb] = []

    public init() {}

    public var current: Crumb? { crumbs.last }

    public mutating func enter(_ node: CategoryNode) {
        crumbs.append(Crumb(id: node.id, name: node.name))
    }

    /// Back out to `depth` crumbs; 0 is the top of the library.
    public mutating func exit(to depth: Int) {
        crumbs = Array(crumbs.prefix(max(0, depth)))
    }
}

extension MediaListQuery {
    /// What to say when a query comes back empty, naming the filter most likely responsible.
    public var emptyMessage: String {
        if let type {
            return type == .video
                ? "No videos here. Turn off the video filter to show everything."
                : "No photos here. Turn off the photo filter to show everything."
        }
        if !tags.isEmpty { return "Nothing carries all of the selected tags. Tap one to remove it." }
        if liked { return "Nothing liked yet. Like anything you want to find again." }
        if !search.isEmpty { return "No results for \"\(search)\"." }
        if category != nil { return "This folder has no media directly in it. Try a sub-folder above." }
        return "Your library is empty, or the server is still scanning."
    }
}
