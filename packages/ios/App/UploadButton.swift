import CoreTransferable
import FreeWANKit
import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

/// A photo or video from the picker, copied into the app's temporary folder.
struct PickedFile: Transferable {
    let url: URL
    let isVideo: Bool

    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(importedContentType: .movie) { received in
            PickedFile(url: try copy(received.file), isVideo: true)
        }
        FileRepresentation(importedContentType: .image) { received in
            PickedFile(url: try copy(received.file), isVideo: false)
        }
    }

    /// The picker's file is only valid inside the import closure.
    private static func copy(_ file: URL) throws -> URL {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let target = folder.appendingPathComponent(file.lastPathComponent)
        try FileManager.default.copyItem(at: file, to: target)
        return target
    }
}

/// Uploads one file at a time, with progress, and can be stopped.
@MainActor
@Observable
final class Uploader {
    private(set) var running = false
    private(set) var current = 0
    private(set) var count = 0
    private(set) var progress = 0.0
    var summary: (title: String, body: String)?
    @ObservationIgnored private var task: Task<Void, Never>?

    func run(_ items: [PhotosPickerItem], to target: UploadTarget, client: APIClient, done: @escaping () -> Void) {
        guard !running else { return }
        running = true
        count = items.count
        current = 0
        task = Task {
            var results: [UploadOutcome] = []
            for (index, item) in items.enumerated() {
                if Task.isCancelled { break }
                current = index + 1
                progress = 0
                do {
                    guard let picked = try await item.loadTransferable(type: PickedFile.self) else {
                        results.append(UploadOutcome(name: "Item \(index + 1)", ok: false, reason: "could not be read from the library"))
                        continue
                    }
                    defer { try? FileManager.default.removeItem(at: picked.url.deletingLastPathComponent()) }
                    let name = Uploads.fileName(given: picked.url.lastPathComponent, index: index, isVideo: picked.isVideo)
                    results.append(try await upload(picked, name: name, to: target, client: client))
                } catch is CancellationError {
                    break
                } catch let error as URLError where error.code == .cancelled {
                    break
                } catch {
                    results.append(UploadOutcome(name: "Item \(index + 1)", ok: false, reason: error.localizedDescription))
                }
            }
            summary = Uploads.summary(results, stopped: Task.isCancelled)
            running = false
            done()
        }
    }

    func stop() { task?.cancel() }

    private func upload(_ file: PickedFile, name: String, to target: UploadTarget, client: APIClient) async throws -> UploadOutcome {
        let boundary = Multipart.boundary()
        let body = file.url.deletingLastPathComponent().appendingPathComponent("body")
        let mime = UTType(filenameExtension: file.url.pathExtension)?.preferredMIMEType
            ?? (file.isVideo ? "video/mp4" : "image/jpeg")
        try Multipart.write(file: file.url, to: body, boundary: boundary, fileName: name, mimeType: mime)

        var request = URLRequest(url: try client.url(Uploads.path(repository: target.id)))
        request.httpMethod = "POST"
        // A large video on a phone uplink takes far longer than an ordinary request.
        request.timeoutInterval = 600
        request.setValue(Multipart.contentType(boundary: boundary), forHTTPHeaderField: "Content-Type")
        for (header, value) in client.authHeaders {
            request.setValue(value, forHTTPHeaderField: header)
        }
        let delegate = UploadProgress { [weak self] fraction in
            Task { @MainActor in self?.progress = fraction }
        }
        let (data, response) = try await URLSession.shared.upload(for: request, fromFile: body, delegate: delegate)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        return try Uploads.outcome(name: name, status: status, body: data)
    }
}

final class UploadProgress: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    let onProgress: (Double) -> Void

    init(_ onProgress: @escaping (Double) -> Void) {
        self.onProgress = onProgress
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didSendBodyData bytesSent: Int64,
                    totalBytesSent: Int64, totalBytesExpectedToSend: Int64) {
        onProgress(DownloadFiles.progress(written: totalBytesSent, expected: totalBytesExpectedToSend))
    }
}

/// The toolbar button on Browse: pick, choose a library if there is more than one, upload.
struct UploadButton: View {
    @Environment(AppModel.self) private var model
    var onUploaded: () -> Void = {}

    @State private var uploader = Uploader()
    @State private var picking = false
    @State private var picked: [PhotosPickerItem] = []
    @State private var targets: [UploadTarget] = []
    @State private var choosingTarget = false
    @State private var problem: String?

    var body: some View {
        Group {
            if uploader.running {
                Button { uploader.stop() } label: {
                    HStack(spacing: 6) {
                        ProgressView(value: uploader.progress).frame(width: 40)
                        Text("\(uploader.current) of \(uploader.count)").font(.caption.monospacedDigit())
                        Image(systemName: "xmark.circle.fill")
                    }
                }
                .accessibilityLabel("Uploading \(uploader.current) of \(uploader.count). Stop")
            } else {
                Button { Task { await prepare() } } label: {
                    Image(systemName: "square.and.arrow.up")
                }
                .accessibilityLabel("Upload from your photo library")
            }
        }
        .photosPicker(isPresented: $picking, selection: $picked, maxSelectionCount: Uploads.maxFilesPerBatch,
                      matching: .any(of: [.images, .videos]))
        .onChange(of: picked) { _, items in
            guard !items.isEmpty else { return }
            if targets.count == 1 { start(items, targets[0]) } else { choosingTarget = true }
        }
        .confirmationDialog("Upload to which library?", isPresented: $choosingTarget, titleVisibility: .visible) {
            ForEach(targets) { target in
                Button(target.name) { start(picked, target) }
            }
            Button("Cancel", role: .cancel) { picked = [] }
        }
        .alert(uploader.summary?.title ?? "", isPresented: Binding(
            get: { uploader.summary != nil }, set: { if !$0 { uploader.summary = nil } }
        )) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(uploader.summary?.body ?? "")
        }
        .alert("Cannot upload", isPresented: Binding(
            get: { problem != nil }, set: { if !$0 { problem = nil } }
        )) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(problem ?? "")
        }
    }

    /// Checks there is somewhere to upload to before opening the picker.
    private func prepare() async {
        guard let client = model.client else { return }
        do {
            targets = try await Uploads.targets(client)
            if targets.isEmpty {
                problem = "No library on your server takes uploads. An admin can make one writable on the web app."
            } else {
                picking = true
            }
        } catch {
            problem = "Your server could not be reached. \(error.localizedDescription)"
        }
    }

    private func start(_ items: [PhotosPickerItem], _ target: UploadTarget) {
        guard let client = model.client else { return }
        picked = []
        uploader.run(items, to: target, client: client, done: onUploaded)
    }
}
