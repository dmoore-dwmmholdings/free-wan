import Foundation

public enum ServerAddress {
    /// Reduces a typed server address to an origin with no trailing slash. A bare hostname is
    /// assumed to be https, the common case on a tailnet; type http:// for a plain-HTTP LAN server.
    public static func normalize(_ input: String) -> URL? {
        let raw = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !raw.isEmpty else { return nil }
        let lower = raw.lowercased()
        let withScheme = lower.hasPrefix("http://") || lower.hasPrefix("https://") ? raw : "https://" + raw
        guard let parts = URLComponents(string: withScheme),
              let scheme = parts.scheme?.lowercased(),
              let host = parts.host, !host.isEmpty
        else { return nil }

        var origin = URLComponents()
        origin.scheme = scheme
        origin.host = host.lowercased()
        // Drop a default port, as a browser does, so the same server always reads the same.
        if let port = parts.port, !(scheme == "https" && port == 443), !(scheme == "http" && port == 80) {
            origin.port = port
        }
        return origin.url
    }
}
