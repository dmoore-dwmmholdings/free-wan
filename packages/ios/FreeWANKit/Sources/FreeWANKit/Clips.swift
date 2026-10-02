import Foundation

/// `clipDtoSchema`: a named span of a video, made on the web.
public struct Clip: Codable, Hashable, Identifiable, Sendable {
    public let id: String
    public let name: String
    public let sourceItemId: String?
    public let startS: Double
    public let endS: Double
    public let durationS: Double
    public let loop: Bool
    /// The source video is gone, so the clip cannot play.
    public let orphaned: Bool
    public let posterUrl: String?
}

/// `clipPreviewSchema`: what to play for a clip.
public struct ClipPreview: Codable, Equatable, Sendable {
    public let sourceUrl: String
    public let startS: Double
    public let endS: Double
    public let loop: Bool
    public let orphaned: Bool

    public var playable: Bool { !orphaned && !sourceUrl.isEmpty }
}

extension MediaAPI {
    public static func clips(_ client: APIClient) async throws -> [Clip] {
        let list: DataList<Clip> = try await client.get("/api/clips")
        return list.data
    }

    public static func clipPreview(_ client: APIClient, id: String) async throws -> ClipPreview {
        try await client.get("/api/clips/\(Query.escape(id))/preview")
    }
}

public enum ClipLoop {
    public struct Command: Equatable, Sendable {
        public let seekTo: Double
        public let pause: Bool
    }

    /// What to do on reaching the out point: back to the in point, then keep going if the
    /// clip loops or stop if it does not. Nil while still inside the clip.
    public static func command(at time: Double, startS: Double, endS: Double, loop: Bool) -> Command? {
        guard time >= endS else { return nil }
        return Command(seekTo: startS, pause: !loop)
    }
}
