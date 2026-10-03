import Foundation

/// What a download is of. Travels with the transfer (as the task description), so a transfer
/// that finishes after a relaunch still knows what it was.
public struct DownloadJob: Codable, Equatable, Sendable {
    public let id: String
    public let title: String
    public let type: MediaType
    public let durationS: Double?
    /// The file's extension, when known up front from the item's details.
    public let ext: String?
    /// The server it comes from, so each server's downloads show only while it is in use.
    public let server: String?

    public init(id: String, title: String, type: MediaType, durationS: Double?, ext: String?, server: String? = nil) {
        self.id = id
        self.title = title
        self.type = type
        self.durationS = durationS
        self.ext = ext
        self.server = server
    }

    /// The same job, from `server`.
    public func from(_ server: String) -> DownloadJob {
        DownloadJob(id: id, title: title, type: type, durationS: durationS, ext: ext, server: server)
    }

    public var encoded: String {
        String(decoding: (try? JSONEncoder().encode(self)) ?? Data(), as: UTF8.self)
    }

    public init?(encoded: String?) {
        guard let encoded, let job = try? JSONDecoder().decode(DownloadJob.self, from: Data(encoded.utf8)) else { return nil }
        self = job
    }

    public var rawPath: String { "/api/media/\(Query.escape(id))/raw" }
    public var posterPath: String { "/api/media/\(Query.escape(id))/poster" }
}

/// A finished download, playable with no connection to the server.
public struct DownloadRecord: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let title: String
    public let type: MediaType
    public let durationS: Double?
    /// Relative to the downloads folder, which moves between app installs and updates.
    public let fileName: String
    public let posterFileName: String?
    public let bytes: Int64
    public let completedAt: Date
    /// Nil only for a download made before servers were recorded, until one claims it.
    public internal(set) var server: String?

    public init(job: DownloadJob, fileName: String, posterFileName: String?, bytes: Int64, completedAt: Date) {
        server = job.server
        id = job.id
        title = job.title
        type = job.type
        durationS = job.durationS
        self.fileName = fileName
        self.posterFileName = posterFileName
        self.bytes = bytes
        self.completedAt = completedAt
    }
}

public enum DownloadState: Equatable, Sendable {
    case none
    /// 0...1, or 0 while the server has not said how big the file is.
    case downloading(Double)
    case failed(String)
    case done(DownloadRecord)
}

/// The finished downloads, saved as JSON beside the files.
public struct DownloadIndex: Codable, Equatable, Sendable {
    public private(set) var records: [String: DownloadRecord] = [:]

    public init() {}

    public subscript(id: String) -> DownloadRecord? { records[id] }

    /// Newest first, the order the Downloads tab lists them.
    public var sorted: [DownloadRecord] { records.values.sorted { $0.completedAt > $1.completedAt } }

    public var totalBytes: Int64 { records.values.reduce(0) { $0 + $1.bytes } }

    /// One server's downloads, newest first.
    public func sorted(from server: String?) -> [DownloadRecord] { sorted.filter { $0.server == server } }

    public func totalBytes(from server: String?) -> Int64 {
        records.values.filter { $0.server == server }.reduce(0) { $0 + $1.bytes }
    }

    /// Gives downloads made before servers were recorded to `server`: the one in use when there
    /// was only one. True when any changed.
    @discardableResult
    public mutating func claimUnowned(for server: String) -> Bool {
        let unowned = records.filter { $0.value.server == nil }.keys
        for id in unowned { records[id]?.server = server }
        return !unowned.isEmpty
    }

    public mutating func add(_ record: DownloadRecord) { records[record.id] = record }

    @discardableResult
    public mutating func remove(_ id: String) -> DownloadRecord? { records.removeValue(forKey: id) }

    /// Drops records whose file is no longer on disk, such as after the system cleared space.
    public mutating func prune(keeping files: Set<String>) {
        records = records.filter { files.contains($0.value.fileName) }
    }

    /// Files in the folder that no record points at: leftovers of an interrupted transfer.
    public func orphans(in files: Set<String>) -> Set<String> {
        let used = Set(records.values.flatMap { [$0.fileName, $0.posterFileName].compactMap { $0 } })
        return files.subtracting(used).subtracting([DownloadFiles.indexName])
    }
}

public enum DownloadFiles {
    public static let indexName = "index.json"

    /// A safe file name for an item: the id with anything unusual replaced, plus an extension
    /// AVPlayer can recognise the format by.
    public static func fileName(id: String, ext: String?) -> String {
        let safeID = String(id.map { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-" || $0 == "_") ? $0 : "_" })
        let cleanExt = (ext ?? "").lowercased().filter { $0.isASCII && ($0.isLetter || $0.isNumber) }
        return cleanExt.isEmpty || cleanExt.count > 8 ? safeID : "\(safeID).\(cleanExt)"
    }

    public static func posterName(id: String) -> String {
        fileName(id: id, ext: nil) + ".poster.jpg"
    }

    public static func progress(written: Int64, expected: Int64) -> Double {
        expected > 0 ? min(1, max(0, Double(written) / Double(expected))) : 0
    }
}

extension Format {
    /// Shown when the server cannot be reached, so downloads are not forgotten.
    public static func offlineHint(downloads: Int) -> String? {
        guard downloads > 0 else { return nil }
        return downloads == 1
            ? "1 download is still playable from the Downloads tab."
            : "\(downloads) downloads are still playable from the Downloads tab."
    }
}
