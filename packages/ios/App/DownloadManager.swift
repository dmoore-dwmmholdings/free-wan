import FreeWANKit
import Foundation
import Observation
import UIKit
import UniformTypeIdentifiers

/// Offline downloads. Transfers run in a background URLSession, so they carry on while the app
/// is suspended or closed, and finished files and their index live in Application Support.
@MainActor
@Observable
final class DownloadManager {
    static let shared = DownloadManager()
    static let sessionID = "com.freewan.app.downloads"

    private(set) var index = DownloadIndex()
    private(set) var active: [String: Double] = [:]
    private(set) var failed: [String: String] = [:]
    /// What each transfer in flight or failed is of, for listing and retrying.
    private(set) var jobs: [String: DownloadJob] = [:]

    /// The signed-in server, for requests and for the poster fetched after a file lands.
    var client: APIClient?
    /// Given by the system when it relaunches the app for finished background transfers.
    var backgroundCompletion: (() -> Void)?

    let folder: URL
    @ObservationIgnored private var session: URLSession!
    @ObservationIgnored private let delegate: DownloadDelegate

    private init() {
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        var folder = support.appendingPathComponent("Downloads", isDirectory: true)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        // Gigabytes of video do not belong in iCloud backups.
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try? folder.setResourceValues(values)
        self.folder = folder

        delegate = DownloadDelegate(folder: folder)
        let config = URLSessionConfiguration.background(withIdentifier: Self.sessionID)
        config.sessionSendsLaunchEvents = true
        config.isDiscretionary = false
        session = URLSession(configuration: config, delegate: delegate, delegateQueue: nil)
        delegate.manager = self

        loadIndex()
        reconnect()
    }

    // MARK: State

    func state(_ id: String) -> DownloadState {
        if let record = index[id] { return .done(record) }
        if let progress = active[id] { return .downloading(progress) }
        if let message = failed[id] { return .failed(message) }
        return .none
    }

    func fileURL(_ record: DownloadRecord) -> URL { folder.appendingPathComponent(record.fileName) }

    func posterURL(_ record: DownloadRecord) -> URL? {
        record.posterFileName.map { folder.appendingPathComponent($0) }
    }

    // MARK: Actions

    func start(_ job: DownloadJob) {
        guard index[job.id] == nil, active[job.id] == nil, let client else { return }
        guard let url = try? client.url(job.rawPath) else { return }
        var request = URLRequest(url: url)
        for (name, value) in client.authHeaders {
            request.setValue(value, forHTTPHeaderField: name)
        }
        let task = session.downloadTask(with: request)
        task.taskDescription = job.encoded
        jobs[job.id] = job
        failed[job.id] = nil
        active[job.id] = 0
        task.resume()
    }

    func retry(_ id: String) {
        guard let job = jobs[id] else { return }
        failed[id] = nil
        start(job)
    }

    /// Stops a transfer and forgets it. A double tap is harmless.
    func cancel(_ id: String) {
        active[id] = nil
        failed[id] = nil
        jobs[id] = nil
        session.getAllTasks { tasks in
            for task in tasks where DownloadJob(encoded: task.taskDescription)?.id == id {
                task.cancel()
            }
        }
    }

    func dismissFailure(_ id: String) {
        failed[id] = nil
        jobs[id] = nil
    }

    func remove(_ id: String) {
        guard let record = index[id] else { return }
        try? FileManager.default.removeItem(at: fileURL(record))
        if let poster = posterURL(record) { try? FileManager.default.removeItem(at: poster) }
        index.remove(id)
        saveIndex()
    }

    // MARK: Delegate callbacks

    fileprivate func progressed(_ id: String, _ value: Double) {
        guard active[id] != nil else { return }
        active[id] = value
    }

    fileprivate func landed(_ job: DownloadJob, fileName: String, bytes: Int64) async {
        // A transfer cancelled at the last moment can still land; honour the cancel.
        guard active[job.id] != nil else {
            try? FileManager.default.removeItem(at: folder.appendingPathComponent(fileName))
            return
        }
        // The poster keeps the offline list readable; it is best effort.
        var posterName: String?
        if let client, let data = try? await client.data(job.posterPath) {
            let name = DownloadFiles.posterName(id: job.id)
            if (try? data.write(to: folder.appendingPathComponent(name))) != nil { posterName = name }
        }
        index.add(DownloadRecord(job: job, fileName: fileName, posterFileName: posterName,
                                 bytes: bytes, completedAt: Date()))
        saveIndex()
        active[job.id] = nil
        jobs[job.id] = nil
    }

    fileprivate func failedTransfer(_ id: String, _ message: String) {
        guard active[id] != nil else { return }
        active[id] = nil
        failed[id] = message
    }

    fileprivate func finishedBackgroundEvents() {
        backgroundCompletion?()
        backgroundCompletion = nil
    }

    // MARK: Persistence

    private var indexURL: URL { folder.appendingPathComponent(DownloadFiles.indexName) }

    private func loadIndex() {
        if let data = try? Data(contentsOf: indexURL),
           let saved = try? JSONDecoder().decode(DownloadIndex.self, from: data) {
            index = saved
        }
        let files = Set((try? FileManager.default.contentsOfDirectory(atPath: folder.path)) ?? [])
        let before = index
        index.prune(keeping: files)
        for orphan in index.orphans(in: files) {
            try? FileManager.default.removeItem(at: folder.appendingPathComponent(orphan))
        }
        if index != before { saveIndex() }
    }

    private func saveIndex() {
        if let data = try? JSONEncoder().encode(index) {
            try? data.write(to: indexURL, options: .atomic)
        }
    }

    /// Picks up transfers that were running when the app was last closed.
    private func reconnect() {
        session.getAllTasks { [weak self] tasks in
            let running = tasks.compactMap { task -> (DownloadJob, Double)? in
                guard task.state == .running || task.state == .suspended,
                      let job = DownloadJob(encoded: task.taskDescription) else { return nil }
                return (job, DownloadFiles.progress(written: task.countOfBytesReceived,
                                                    expected: task.countOfBytesExpectedToReceive))
            }
            Task { @MainActor in
                for (job, progress) in running {
                    self?.jobs[job.id] = job
                    self?.active[job.id] = progress
                }
            }
        }
    }
}

/// URLSession's callbacks, off the main actor. The finished file has to be moved before
/// `didFinishDownloadingTo` returns, because the system deletes it straight after.
final class DownloadDelegate: NSObject, URLSessionDownloadDelegate, @unchecked Sendable {
    let folder: URL
    weak var manager: DownloadManager?

    init(folder: URL) {
        self.folder = folder
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64,
                    totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        guard let job = DownloadJob(encoded: downloadTask.taskDescription) else { return }
        let value = DownloadFiles.progress(written: totalBytesWritten, expected: totalBytesExpectedToWrite)
        Task { @MainActor [weak manager = self.manager] in manager?.progressed(job.id, value) }
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        guard let job = DownloadJob(encoded: downloadTask.taskDescription) else { return }
        let response = downloadTask.response as? HTTPURLResponse
        guard let response, (200..<300).contains(response.statusCode) else {
            let status = response?.statusCode ?? 0
            let message = status == 401 ? "Sign in again to download." : "The server answered \(status)."
            Task { @MainActor [weak manager = self.manager] in manager?.failedTransfer(job.id, message) }
            return
        }
        let ext = job.ext ?? response.mimeType.flatMap { UTType(mimeType: $0)?.preferredFilenameExtension }
        let name = DownloadFiles.fileName(id: job.id, ext: ext)
        let target = folder.appendingPathComponent(name)
        do {
            try? FileManager.default.removeItem(at: target)
            try FileManager.default.moveItem(at: location, to: target)
            let bytes = (try? FileManager.default.attributesOfItem(atPath: target.path)[.size] as? Int64) ?? 0
            Task { @MainActor [weak manager = self.manager] in await manager?.landed(job, fileName: name, bytes: bytes) }
        } catch {
            let message = "Could not save the file: \(error.localizedDescription)"
            Task { @MainActor [weak manager = self.manager] in manager?.failedTransfer(job.id, message) }
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let error, let job = DownloadJob(encoded: task.taskDescription) else { return }
        // A cancel the user asked for is not a failure.
        if (error as? URLError)?.code == .cancelled { return }
        let message = error.localizedDescription
        Task { @MainActor [weak manager = self.manager] in manager?.failedTransfer(job.id, message) }
    }

    func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        Task { @MainActor [weak manager = self.manager] in manager?.finishedBackgroundEvents() }
    }
}

/// Hands the system's background-transfer wake-up to the download manager.
final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, handleEventsForBackgroundURLSession identifier: String,
                     completionHandler: @escaping () -> Void) {
        guard identifier == DownloadManager.sessionID else { return completionHandler() }
        Task { @MainActor in DownloadManager.shared.backgroundCompletion = completionHandler }
    }
}
