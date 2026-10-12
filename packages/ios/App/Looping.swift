import AVFoundation
import CryptoKit
import FreeWANKit
import UniformTypeIdentifiers

/// What to play a video from, and whether the file plays as it is (a download, a cached copy or
/// the server's direct stream) rather than as a converted stream.
struct Playable {
    let asset: AVURLAsset
    let direct: Bool
    /// A copy on its way to the phone, for playing from next time round.
    let copy: Task<URL?, Never>?
}

/// A video's media, best first: a download, a cached copy, else the server. A short video that
/// plays as it is starts a copy for next time too. Nil when none can be had.
@MainActor
func playableAsset(_ card: MediaCard, client: APIClient, keepCopy: Bool = false) async -> Playable? {
    #if os(iOS)
    let downloads = DownloadManager.shared
    if let local = downloads.index[card.id].map(downloads.fileURL) {
        return Playable(asset: AVURLAsset(url: local), direct: true, copy: nil)
    }
    #endif
    if let cached = LoopCache.shared.file(for: card, server: client.baseURL) {
        return Playable(asset: AVURLAsset(url: cached), direct: true, copy: nil)
    }
    guard let descriptor = try? await MediaAPI.playback(client, id: card.id),
          let url = try? client.url(descriptor.url) else { return nil }
    let direct = descriptor.mode == "direct"
    let copy = keepCopy && direct && (card.durationS ?? .infinity) <= LoopCache.maxDuration
        ? LoopCache.shared.fetch(card, from: url, client: client) : nil
    return Playable(asset: AVURLAsset(url: url, options: ["AVURLAssetHTTPHeaderFieldsKey": client.authHeaders]),
                    direct: direct, copy: copy)
}

/// One video set to repeat. A file that plays as it is repeats with no gap: the looper queues
/// the next time round before this one ends. A converted stream seeks back to the start.
@MainActor
final class Loop {
    let player = AVQueuePlayer()
    private var looper: AVPlayerLooper?
    private var loops: NSKeyValueObservation?
    private var ended: NSObjectProtocol?
    private var localCopy: URL?

    init(_ playable: Playable, muted: Bool) {
        player.isMuted = muted
        // A short loop should start on its first frames rather than wait for a deep buffer.
        player.automaticallyWaitsToMinimizeStalling = false
        if playable.direct {
            loop(playable.asset)
        } else {
            let item = AVPlayerItem(asset: playable.asset)
            player.insert(item, after: nil)
            ended = NotificationCenter.default.addObserver(
                forName: AVPlayerItem.didPlayToEndTimeNotification, object: item, queue: .main
            ) { [weak self] _ in
                MainActor.assumeIsolated {
                    self?.player.seek(to: .zero)
                    self?.player.play()
                }
            }
        }
        if let copy = playable.copy {
            Task { [weak self] in
                if let url = await copy.value { self?.localCopy = url }
            }
        }
    }

    deinit {
        if let ended { NotificationCenter.default.removeObserver(ended) }
    }

    private func loop(_ asset: AVAsset) {
        looper = AVPlayerLooper(player: player, templateItem: AVPlayerItem(asset: asset))
        // Each time round, move to the copy on the phone once it has arrived.
        loops = looper?.observe(\.loopCount) { [weak self] _, _ in
            Task { @MainActor in self?.switchToLocalCopy() }
        }
    }

    private func switchToLocalCopy() {
        guard let url = localCopy else { return }
        localCopy = nil
        looper?.disableLooping()
        player.removeAllItems()
        loop(AVURLAsset(url: url))
        player.play()
    }
}

/// Copies of short videos kept on the phone, so a loop, or a second look, plays from the phone
/// instead of streaming the whole file again. Made alongside the first play, a few at a time,
/// and capped in size: the least recently played go first.
@MainActor
final class LoopCache {
    static let shared = LoopCache()
    /// Longer than this, a copy costs more than streaming saves.
    static let maxDuration: Double = 300
    private static let capBytes: Int64 = 2 * 1024 * 1024 * 1024
    private static let parallel = 3

    private let folder: URL
    private var files: [String: URL] = [:]
    private var fetching: [String: Task<URL?, Never>] = [:]
    private var running = 0

    private init() {
        folder = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Loops", isDirectory: true)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        for url in (try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)) ?? [] {
            files[url.deletingPathExtension().lastPathComponent] = url
        }
    }

    /// Per server, since ids are only unique on one.
    private func key(_ card: MediaCard, _ server: URL) -> String {
        SHA256.hash(data: Data((server.absoluteString + "|" + card.id).utf8))
            .prefix(16).map { String(format: "%02x", $0) }.joined()
    }

    /// The copy already on the phone, marked as just used.
    func file(for card: MediaCard, server: URL) -> URL? {
        guard let url = files[key(card, server)], FileManager.default.fileExists(atPath: url.path) else { return nil }
        try? FileManager.default.setAttributes([.modificationDate: Date()], ofItemAtPath: url.path)
        return url
    }

    /// Downloads a copy, once per video however often asked.
    func fetch(_ card: MediaCard, from url: URL, client: APIClient) -> Task<URL?, Never> {
        let key = key(card, client.baseURL)
        if let running = fetching[key] { return running }
        let task = Task<URL?, Never> {
            while running >= Self.parallel { try? await Task.sleep(for: .milliseconds(200)) }
            running += 1
            defer {
                running -= 1
                fetching[key] = nil
            }
            var request = URLRequest(url: url)
            for (name, value) in client.authHeaders { request.setValue(value, forHTTPHeaderField: name) }
            guard let (temp, response) = try? await URLSession.shared.download(for: request),
                  (response as? HTTPURLResponse)?.statusCode == 200 else { return nil }
            // AVPlayer tells a file's format by its extension.
            let ext = response.mimeType.flatMap { UTType(mimeType: $0)?.preferredFilenameExtension } ?? "mp4"
            let target = folder.appendingPathComponent(key).appendingPathExtension(ext)
            try? FileManager.default.removeItem(at: target)
            guard (try? FileManager.default.moveItem(at: temp, to: target)) != nil else { return nil }
            files[key] = target
            trim()
            return target
        }
        fetching[key] = task
        return task
    }

    /// Deletes the least recently played copies until the rest fit the cap.
    private func trim() {
        let keys: Set<URLResourceKey> = [.fileSizeKey, .contentModificationDateKey]
        let entries = ((try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: Array(keys))) ?? [])
            .compactMap { url -> (URL, Int64, Date)? in
                guard let values = try? url.resourceValues(forKeys: keys) else { return nil }
                return (url, Int64(values.fileSize ?? 0), values.contentModificationDate ?? .distantPast)
            }
            .sorted { $0.2 < $1.2 }
        var total = entries.reduce(0) { $0 + $1.1 }
        for (url, size, _) in entries where total > Self.capBytes {
            try? FileManager.default.removeItem(at: url)
            files[url.deletingPathExtension().lastPathComponent] = nil
            total -= size
        }
    }
}
