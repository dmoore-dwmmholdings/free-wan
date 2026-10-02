import Foundation

/// Which size of a photo to ask the server for (`GET /api/media/:id/raw?w=`).
public enum PhotoSize {
    /// Widths are rounded up to steps, so the server's resize cache sees few distinct sizes.
    static let step = 320.0
    static let maxWidth = 2560.0

    /// The width to request for a view `points` wide at `scale`, or nil to fetch the original:
    /// when the original is no wider than that anyway, or its width is unknown.
    public static func width(points: Double, scale: Double, sourceWidth: Double?) -> Int? {
        guard let sourceWidth, sourceWidth > 0 else { return nil }
        let pixels = max(1, points * scale)
        let bucketed = min(maxWidth, (pixels / step).rounded(.up) * step)
        return bucketed >= sourceWidth ? nil : Int(bucketed)
    }

    public static func path(id: String, width: Int?) -> String {
        let base = "/api/media/\(Query.escape(id))/raw"
        return width.map { "\(base)?w=\($0)" } ?? base
    }
}
