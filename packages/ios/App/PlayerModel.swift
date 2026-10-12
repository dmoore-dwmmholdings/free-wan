import AVFoundation
import FreeWANKit
import Observation
import SwiftUI
import UIKit

/// Plays one video from the server, resumes it, and saves the position as it goes.
@MainActor
@Observable
final class PlayerModel {
    enum State: Equatable {
        case idle, loading, playing, failed(String)
    }

    private(set) var state: State = .idle
    let player = AVPlayer()
    /// The system player's own full screen covers the screen it was opened from, which SwiftUI
    /// reports as that screen disappearing; playback has to carry on through it.
    @ObservationIgnored var isFullScreen = false

    /// Tracks the server offers for this video, known once playback starts.
    private(set) var captionTracks: [PlaybackDescriptor.Caption] = []
    /// Off by default, as on the web.
    private(set) var selectedCaption: String?
    private(set) var captionText: String?
    private(set) var captionError: String?
    private var cues: [Cue] = []
    private var captionObserver: Any?

    private var client: APIClient?
    private var mediaID = ""
    private var duration: Double?
    private var policy = ProgressPolicy()
    private var timeObserver: Any?
    private var statusObservation: NSKeyValueObservation?
    private var rateObservation: NSKeyValueObservation?
    private var backgroundObserver: NSObjectProtocol?

    /// Fetches where to play from and starts playing.
    func start(client: APIClient, mediaID: String) async {
        guard state != .loading else { return }
        self.client = client
        self.mediaID = mediaID
        state = .loading
        // A downloaded copy plays from the phone. The server still supplies the resume point
        // and subtitles when it can be reached, and is not needed when it cannot.
        #if os(iOS)
        let downloads = DownloadManager.shared
        let local = downloads.index[mediaID].map(downloads.fileURL)
        #else
        let local: URL? = nil
        #endif
        do {
            let descriptor: PlaybackDescriptor?
            do {
                descriptor = try await MediaAPI.playback(client, id: mediaID)
            } catch {
                guard local != nil else { throw error }
                descriptor = nil
            }
            duration = descriptor?.duration
            let resumeAt = descriptor?.resumeAt
            captionTracks = descriptor?.captions ?? []
            let asset: AVURLAsset
            if let local {
                asset = AVURLAsset(url: local)
            } else if let descriptor {
                // AVPlayer makes its own requests, including every HLS segment; this asset
                // option puts the session token on all of them.
                asset = AVURLAsset(url: try client.url(descriptor.url),
                                   options: ["AVURLAssetHTTPHeaderFieldsKey": client.authHeaders])
            } else {
                throw APIError(status: 0, code: "unreachable", message: "The server could not be reached.")
            }
            // Left the screen while the descriptor loaded: do not start playing behind it.
            if Task.isCancelled {
                state = .idle
                return
            }
            let item = AVPlayerItem(asset: asset)
            observe(item)
            player.replaceCurrentItem(with: item)
            // Seeking before playing fetches from the resume point at once, instead of loading
            // the start first and then the resume point.
            if let position = ProgressPolicy.resumePosition(resumeAt: resumeAt, playedTo: 0) {
                await player.seek(to: CMTime(seconds: position, preferredTimescale: 600))
            }
            player.play()
            state = .playing
        } catch {
            let text = ErrorText(error)
            state = .failed("\(text.title). \(text.message)")
        }
    }

    private func observe(_ item: AVPlayerItem) {
        statusObservation = item.observe(\.status) { [weak self] item, _ in
            Task { @MainActor in self?.statusChanged(item) }
        }
        // Pausing is a natural point to save where you are.
        rateObservation = player.observe(\.rate) { [weak self] player, _ in
            Task { @MainActor in if player.rate == 0 { self?.report() } }
        }
        timeObserver = player.addPeriodicTimeObserver(
            forInterval: CMTime(seconds: ProgressPolicy.interval, preferredTimescale: 1), queue: .main
        ) { [weak self] _ in
            Task { @MainActor in self?.report() }
        }
        captionObserver = player.addPeriodicTimeObserver(
            forInterval: CMTime(seconds: 0.2, preferredTimescale: 600), queue: .main
        ) { [weak self] _ in
            Task { @MainActor in self?.syncCaption() }
        }
        backgroundObserver = NotificationCenter.default.addObserver(
            forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main
        ) { [weak self] _ in
            Task { @MainActor in self?.report() }
        }
    }

    private func statusChanged(_ item: AVPlayerItem) {
        switch item.status {
        case .failed:
            state = .failed(item.error?.localizedDescription ?? "This video could not be played.")
        default:
            break
        }
    }

    /// Turns captions on with `id`, or off with nil.
    func selectCaption(_ id: String?) async {
        selectedCaption = id
        captionError = nil
        cues = []
        captionText = nil
        guard let id, let client, let track = captionTracks.first(where: { $0.id == id }) else { return }
        do {
            let loaded = try await Captions.fetch(client, path: track.url)
            guard selectedCaption == id else { return }
            cues = loaded
            syncCaption()
        } catch {
            guard selectedCaption == id else { return }
            captionError = "Subtitles could not be loaded: \(error.localizedDescription)"
        }
    }

    private func syncCaption() {
        let time = player.currentTime().seconds
        let text = time.isFinite ? Captions.cue(in: cues, at: time)?.text : nil
        if text != captionText { captionText = text }
    }

    /// Sends the position if it moved enough to matter. Failures are dropped: the next report
    /// carries a newer position anyway.
    func report() {
        guard let client else { return }
        let position = player.currentTime().seconds
        guard policy.shouldReport(position) else { return }
        let (id, duration) = (mediaID, duration)
        Task { try? await MediaAPI.reportProgress(client, id: id, position: position, duration: duration) }
    }

    /// Saves the final position and lets go of the stream.
    func stop() {
        report()
        player.pause()
        if let timeObserver { player.removeTimeObserver(timeObserver) }
        if let captionObserver { player.removeTimeObserver(captionObserver) }
        captionObserver = nil
        if let backgroundObserver { NotificationCenter.default.removeObserver(backgroundObserver) }
        timeObserver = nil
        backgroundObserver = nil
        statusObservation = nil
        rateObservation = nil
        player.replaceCurrentItem(with: nil)
        state = .idle
        captionTracks = []
        selectedCaption = nil
        captionText = nil
        captionError = nil
        cues = []
    }
}

struct CaptionOverlay: View {
    let model: PlayerModel

    var body: some View {
        VStack {
            Spacer()
            if let text = model.captionText {
                Text(text)
                    .font(.body.weight(.medium))
                    .foregroundStyle(.white)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 4)
                    .background(.black.opacity(0.72), in: RoundedRectangle(cornerRadius: 6))
                    .padding(.horizontal, 16)
                    // Clear of the player's own controls along the bottom edge.
                    .padding(.bottom, 44)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .allowsHitTesting(false)
    }
}
