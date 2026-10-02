import Foundation

/// A library that takes uploads (`GET /api/upload/targets`).
public struct UploadTarget: Codable, Equatable, Hashable, Identifiable, Sendable {
    public let id: String
    public let name: String
    public let type: String
}

public struct UploadOutcome: Equatable, Sendable {
    public let name: String
    public let ok: Bool
    public let reason: String?
}

public enum Uploads {
    public static let maxFilesPerBatch = 50

    public static func targets(_ client: APIClient) async throws -> [UploadTarget] {
        let list: DataList<UploadTarget> = try await client.get("/api/upload/targets")
        return list.data
    }

    public static func path(repository: String) -> String {
        "/api/repositories/\(Query.escape(repository))/upload"
    }

    /// The picker's own name for the file, or `upload-<n>.<ext>` when it has none.
    public static func fileName(given: String?, index: Int, isVideo: Bool) -> String {
        if let given = given?.trimmingCharacters(in: .whitespaces), !given.isEmpty { return given }
        return "upload-\(index + 1).\(isVideo ? "mp4" : "jpg")"
    }

    /// Reads the server's answer for one file. 202 means saved, 422 means skipped with a
    /// reason, and both carry the same body; anything else is an error.
    public static func outcome(name: String, status: Int, body: Data) throws -> UploadOutcome {
        struct Response: Decodable {
            struct Skip: Decodable { let name: String; let reason: String }
            let files: [String]?
            let skipped: [Skip]?
        }
        guard status == 202 || status == 422 else { throw APIClient.error(status: status, body: body) }
        let response = try? JSONDecoder().decode(Response.self, from: body)
        if let saved = response?.files?.first { return UploadOutcome(name: saved, ok: true, reason: nil) }
        let reason = response?.skipped?.first(where: { $0.name == name })?.reason
        return UploadOutcome(name: name, ok: false, reason: reason ?? "the server rejected it without saying why")
    }

    /// The message after a batch: what was saved, what was not and why.
    public static func summary(_ results: [UploadOutcome], stopped: Bool) -> (title: String, body: String) {
        let ok = results.filter(\.ok)
        let failed = results.filter { !$0.ok }
        if stopped {
            return ("Upload stopped", ok.isEmpty
                ? "Nothing was uploaded."
                : "\(Format.count(ok.count, "file")) had already finished and \(ok.count == 1 ? "is" : "are") in your library.")
        }
        if failed.isEmpty {
            return (ok.count == 1 ? "Uploaded" : "\(ok.count) uploaded",
                    "Your server is indexing them now, so they may take a moment to appear. Pull down to refresh.")
        }
        var detail = failed.prefix(5).map { "\($0.name): \($0.reason ?? "")" }.joined(separator: "\n")
        if failed.count > 5 { detail += "\nand \(failed.count - 5) more" }
        return (ok.isEmpty ? "Nothing was uploaded" : "\(ok.count) uploaded, \(failed.count) skipped", detail)
    }
}

/// A multipart/form-data body with one file, written to disk so a large video is never held
/// in memory.
public enum Multipart {
    public static func boundary() -> String { "FreeWAN-\(UUID().uuidString)" }

    public static func contentType(boundary: String) -> String { "multipart/form-data; boundary=\(boundary)" }

    static func head(boundary: String, field: String, fileName: String, mimeType: String) -> Data {
        // Quotes and line breaks in a file name would break the header.
        let safe = fileName.replacingOccurrences(of: "\"", with: "'").filter { $0 != "\r" && $0 != "\n" }
        return Data(("--\(boundary)\r\n"
            + "Content-Disposition: form-data; name=\"\(field)\"; filename=\"\(safe)\"\r\n"
            + "Content-Type: \(mimeType)\r\n\r\n").utf8)
    }

    static func tail(boundary: String) -> Data { Data("\r\n--\(boundary)--\r\n".utf8) }

    /// Writes the body for `file` to `destination`, copying the file in chunks.
    public static func write(file: URL, to destination: URL, boundary: String,
                             field: String = "file", fileName: String, mimeType: String) throws {
        FileManager.default.createFile(atPath: destination.path, contents: nil)
        let out = try FileHandle(forWritingTo: destination)
        defer { try? out.close() }
        let input = try FileHandle(forReadingFrom: file)
        defer { try? input.close() }
        try out.write(contentsOf: head(boundary: boundary, field: field, fileName: fileName, mimeType: mimeType))
        while let chunk = try input.read(upToCount: 1 << 20), !chunk.isEmpty {
            try out.write(contentsOf: chunk)
        }
        try out.write(contentsOf: tail(boundary: boundary))
    }
}
