import Foundation

/// `collectionDtoSchema`. Read-only here; collections are made and edited on the web.
public struct MediaCollection: Codable, Hashable, Identifiable, Sendable {
    public let id: String
    public let name: String
    public let description: String?
    public let coverUrl: String?
    public let itemCount: Int
    public let updatedAt: Double
}

extension MediaAPI {
    public static func collections(_ client: APIClient) async throws -> [MediaCollection] {
        let list: DataList<MediaCollection> = try await client.get("/api/collections")
        return list.data
    }

    /// The items in a collection, in the order set on the web (the server ignores the sort).
    public static func collectionQuery(_ id: String) -> MediaListQuery {
        var query = MediaListQuery()
        query.collection = id
        return query
    }
}

extension Format {
    /// "1 item", "3 items".
    public static func count(_ n: Int, _ singular: String, _ plural: String? = nil) -> String {
        "\(n) \(n == 1 ? singular : plural ?? singular + "s")"
    }
}
