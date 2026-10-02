import Foundation

/// `freewan://media/<id>`, `freewan://clip/<id>` or `freewan://collection/<id>`.
public enum DeepLink: Equatable, Sendable {
    case media(String)
    case clip(String)
    case collection(String)

    public static let scheme = "freewan"

    /// Nil for anything else, including a known kind with no id.
    public init?(url: URL) {
        guard url.scheme?.lowercased() == Self.scheme else { return nil }
        // Both freewan://media/x and freewan:///media/x reach here; collect the segments either way.
        var parts = url.pathComponents.filter { $0 != "/" }
        if let host = url.host, !host.isEmpty { parts.insert(host, at: 0) }
        guard parts.count == 2, !parts[1].isEmpty else { return nil }
        let id = parts[1]
        switch parts[0].lowercased() {
        case "media": self = .media(id)
        case "clip": self = .clip(id)
        case "collection": self = .collection(id)
        default: return nil
        }
    }

    public var url: URL {
        switch self {
        case .media(let id): return URL(string: "\(Self.scheme)://media/\(Query.escape(id))")!
        case .clip(let id): return URL(string: "\(Self.scheme)://clip/\(Query.escape(id))")!
        case .collection(let id): return URL(string: "\(Self.scheme)://collection/\(Query.escape(id))")!
        }
    }
}

extension MediaDetail {
    /// The card for this item, for opening it the same way as from a grid.
    public var card: MediaCard {
        MediaCard(id: id, type: type, title: title, durationS: durationS, width: width, height: height,
                  posterUrl: posterUrl, repositoryId: repositoryId, categoryPath: categoryPath,
                  liked: liked, likeCount: likeCount)
    }
}
