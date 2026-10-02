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

    public init(id: String, title: String, type: MediaType, durationS: Double?, ext: String?) {
        self.id = id
        self.title = title
        self.type = type
        self.durationS = durationS
        self.ext = ext
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

    public init(job: DownloadJob, fileName: String, posterFileName: String?, bytes: Int64, completedAt: Date) {
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
