import CoreTransferable
import FreeWANKit
import Photos
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

/// The upload flow on Browse: pick, choose a library if there is more than one, upload one file
/// at a time with progress, then offer to delete what uploaded from the phone.
@MainActor
@Observable
final class Uploader {
    private(set) var running = false
    private(set) var current = 0
    private(set) var count = 0
    private(set) var progress = 0.0
    var summary: (title: String, body: String)?
    /// Photo library ids of the items that uploaded, which can now be deleted from the phone.
    var uploadedIDs: [String] = []
    var picking = false
    var picked: [PhotosPickerItem] = []
    var choosingTarget = false
    var problem: String?
    var deleteProblem: String?
    private(set) var targets: [UploadTarget] = []
    @ObservationIgnored private var task: Task<Void, Never>?

    /// Checks there is somewhere to upload to before opening the picker.
    func prepare(_ client: APIClient) async {
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

    /// Picked items go straight up when there is one library, otherwise after choosing one.
    func pickingEnded(_ client: APIClient?, done: @escaping () -> Void) {
        guard !picked.isEmpty else { return }
        if targets.count == 1, let client { start(targets[0], client: client, done: done) } else { choosingTarget = true }
    }

    func start(_ target: UploadTarget, client: APIClient, done: @escaping () -> Void) {
        let items = picked
        picked = []
        run(items, to: target, client: client, done: done)
    }

    func run(_ items: [PhotosPickerItem], to target: UploadTarget, client: APIClient, done: @escaping () -> Void) {
        guard !running else { return }
        running = true
        count = items.count
        current = 0
        uploadedIDs = []
        task = Task {
            var results: [UploadOutcome] = []
            var uploaded: [String] = []
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
                    let outcome = try await upload(picked, name: name, to: target, client: client)
                    results.append(outcome)
                    if outcome.ok, let id = item.itemIdentifier { uploaded.append(id) }
                } catch is CancellationError {
                    break
                } catch let error as URLError where error.code == .cancelled {
                    break
                } catch {
                    results.append(UploadOutcome(name: "Item \(index + 1)", ok: false, reason: error.localizedDescription))
                }
            }
            uploadedIDs = uploaded
            summary = Uploads.summary(results, stopped: Task.isCancelled)
            running = false
            done()
        }
    }

    func stop() { task?.cancel() }

    /// Deletes the uploaded items from the photo library. iOS asks to confirm, and keeps them in
    /// Recently Deleted for 30 days.
    func deleteUploaded() async {
        let ids = uploadedIDs
        uploadedIDs = []
        let access = await PHPhotoLibrary.requestAuthorization(for: .readWrite)
        guard access == .authorized || access == .limited else {
            deleteProblem = "FreeWAN needs access to your photos to delete them. Allow it in Settings, FreeWAN, Photos."
            return
        }
        // With limited access only the photos shared with the app can be found.
        let assets = PHAsset.fetchAssets(withLocalIdentifiers: ids, options: nil)
        let hidden = ids.count - assets.count
        if assets.count > 0 {
            do {
                try await PHPhotoLibrary.shared().performChanges { PHAssetChangeRequest.deleteAssets(assets) }
            } catch let error as PHPhotosError where error.code == .userCancelled {
                return
            } catch {
                deleteProblem = "They could not be deleted. \(error.localizedDescription)"
                return
            }
        }
        if hidden > 0 {
            deleteProblem = "\(hidden) could not be deleted because FreeWAN can only see the photos you have "
                + "shared with it. Allow Full Access in Settings, FreeWAN, Photos, or delete them in Photos."
        }
    }

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

/// The toolbar button on Browse. What it opens is presented by `uploadFlow` on the screen, not
/// from the toolbar, which is rebuilt when the upload ends and would take an alert with it.
struct UploadButton: View {
    @Environment(AppModel.self) private var model
    let uploader: Uploader

    var body: some View {
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
            Button {
                guard let client = model.client else { return }
                Task { await uploader.prepare(client) }
            } label: {
                Image(systemName: "square.and.arrow.up")
            }
            .accessibilityLabel("Upload from your photo library")
        }
    }
}

extension View {
    /// The picker, library choice and results of the upload `UploadButton` starts.
    func uploadFlow(_ uploader: Uploader, onUploaded: @escaping () -> Void) -> some View {
        modifier(UploadFlow(uploader: uploader, onUploaded: onUploaded))
    }
}

private struct UploadFlow: ViewModifier {
    @Environment(AppModel.self) private var model
    @Bindable var uploader: Uploader
    let onUploaded: () -> Void

    func body(content: Content) -> some View {
        let device = UIDevice.current.model
        content
            // The shared library gives each picked item an id, which deleting it later needs.
            .photosPicker(isPresented: $uploader.picking, selection: $uploader.picked,
                          maxSelectionCount: Uploads.maxFilesPerBatch, matching: .any(of: [.images, .videos]),
                          photoLibrary: .shared())
            .onChange(of: uploader.picked) { uploader.pickingEnded(model.client, done: onUploaded) }
            .confirmationDialog("Upload to which library?", isPresented: $uploader.choosingTarget,
                                titleVisibility: .visible) {
                ForEach(uploader.targets) { target in
                    Button(target.name) {
                        guard let client = model.client else { return }
                        uploader.start(target, client: client, done: onUploaded)
                    }
                }
                Button("Cancel", role: .cancel) { uploader.picked = [] }
            }
            .alert(uploader.summary?.title ?? "", isPresented: Binding(
                get: { uploader.summary != nil }, set: { if !$0 { uploader.summary = nil } }
            )) {
                if uploader.uploadedIDs.isEmpty {
                    Button("OK", role: .cancel) {}
                } else {
                    Button("Delete \(uploader.uploadedIDs.count) from \(device)", role: .destructive) {
                        Task { await uploader.deleteUploaded() }
                    }
                    Button("Keep on \(device)", role: .cancel) { uploader.uploadedIDs = [] }
                }
            } message: {
                let freeUp = "\n\nDeleting what uploaded frees space on this \(device). iOS keeps deleted items in "
                    + "Recently Deleted for 30 days first."
                Text((uploader.summary?.body ?? "") + (uploader.uploadedIDs.isEmpty ? "" : freeUp))
            }
            .alert("Cannot upload", isPresented: Binding(
                get: { uploader.problem != nil }, set: { if !$0 { uploader.problem = nil } }
            )) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(uploader.problem ?? "")
            }
            .alert("Not deleted", isPresented: Binding(
                get: { uploader.deleteProblem != nil }, set: { if !$0 { uploader.deleteProblem = nil } }
            )) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(uploader.deleteProblem ?? "")
            }
    }
}
