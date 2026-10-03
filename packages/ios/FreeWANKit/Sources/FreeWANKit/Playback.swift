import Foundation

/// `playbackDescriptorSchema`: where to stream a video from and where to resume it.
public struct PlaybackDescriptor: Codable, Equatable, Sendable {
    public struct Caption: Codable, Equatable, Identifiable, Sendable {
        public let id: String
        public let label: String
        public let language: String?
        public let url: String
        public let `default`: Bool
    }

    /// "direct" streams the file as is; "hls" is a transcoded playlist.
    public let mode: String
    public let url: String
    public let captions: [Caption]
    /// Set by the server only when more than 5 s were watched and the video is not finished.
    public let resumeAt: Double?
    public let duration: Double?
}

extension MediaAPI {
    public static func playback(_ client: APIClient, id: String) async throws -> PlaybackDescriptor {
        try await client.get("/api/media/\(Query.escape(id))/playback")
    }

    /// Saves the watch position. The server marks the video watched past 92%.
    public static func reportProgress(_ client: APIClient, id: String, position: Double, duration: Double?) async throws {
        struct Body: Encodable { let positionS: Double; let durationS: Double? }
        let _: NoContent = try await client.send(
            "POST", "/api/media/\(Query.escape(id))/progress",
            body: Body(positionS: position, durationS: (duration ?? 0) > 0 ? duration : nil))
    }
}

/// When to save the watch position and where to pick up from.
public struct ProgressPolicy: Sendable {
    public static let interval: TimeInterval = 10
    /// Under this, a position is a stray tap rather than watching.
    public static let minimumPosition: Double = 5
    static let minimumChange: Double = 1

    private var lastSent: Double?

    public init() {}

    /// Whether `position` is worth sending, and if so, remembers it as sent.
    public mutating func shouldReport(_ position: Double) -> Bool {
        guard position.isFinite, position >= Self.minimumPosition else { return false }
        if let lastSent, abs(position - lastSent) < Self.minimumChange { return false }
        lastSent = position
        return true
    }

    /// Where to seek once the video is ready: the saved position, unless playback has already
    /// gone past the opening seconds on its own (the user started watching before it loaded).
    public static func resumePosition(resumeAt: Double?, playedTo: Double) -> Double? {
        guard playedTo <= minimumPosition, let resumeAt, resumeAt > 0 else { return nil }
        return resumeAt
    }
}

/// A long-pressed video's preview: short pieces from across it, to tell what it is and where.
public enum PreviewSnippets {
    public static let length: Double = 5
    public static let count = 5

    /// Evenly spaced starts, from the beginning to the last piece's; just the beginning when the
    /// video is too short to cut up.
    public static func starts(duration: Double?) -> [Double] {
        guard let duration, duration.isFinite else { return [0] }
        let pieces = min(count, Int(duration / length))
        guard pieces >= 2 else { return [0] }
        let last = duration - length
        return (0..<pieces).map { last * Double($0) / Double(pieces - 1) }
    }
}
