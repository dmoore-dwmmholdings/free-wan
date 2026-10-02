import AVFoundation
import AVKit
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
    private var resumeAt: Double?
    private var resumed = false
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
        let downloads = DownloadManager.shared
        let local = downloads.index[mediaID].map(downloads.fileURL)
        do {
            let descriptor: PlaybackDescriptor?
            do {
                descriptor = try await MediaAPI.playback(client, id: mediaID)
            } catch {
                guard local != nil else { throw error }
                descriptor = nil
            }
            duration = descriptor?.duration
            resumeAt = descriptor?.resumeAt
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
            let item = AVPlayerItem(asset: asset)
            observe(item)
            player.replaceCurrentItem(with: item)
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
        case .readyToPlay where !resumed:
            resumed = true
            let playedTo = player.currentTime().seconds
            if let position = ProgressPolicy.resumePosition(resumeAt: resumeAt, playedTo: playedTo.isFinite ? playedTo : 0) {
                player.seek(to: CMTime(seconds: position, preferredTimescale: 600))
            }
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
        resumed = false
        captionTracks = []
        selectedCaption = nil
        captionText = nil
        captionError = nil
        cues = []
    }
}

/// The system player: standard controls, full screen, AirPlay and Picture in Picture. Captions
/// are drawn in its content overlay, so they stay visible in full screen too.
struct VideoPlayerView: UIViewControllerRepresentable {
    let model: PlayerModel

    func makeUIViewController(context: Context) -> AVPlayerViewController {
        let controller = AVPlayerViewController()
        controller.player = model.player
        controller.allowsPictureInPicturePlayback = true
        controller.canStartPictureInPictureAutomaticallyFromInline = true

        let captions = UIHostingController(rootView: CaptionOverlay(model: model))
        captions.view.backgroundColor = .clear
        captions.view.isUserInteractionEnabled = false
        if let overlay = controller.contentOverlayView {
            captions.view.frame = overlay.bounds
            captions.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            overlay.addSubview(captions.view)
        }
        context.coordinator.captions = captions
        return controller
    }

    func updateUIViewController(_ controller: AVPlayerViewController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator() }

    /// Keeps the hosting controller alive for as long as the player view.
    final class Coordinator {
        var captions: UIHostingController<CaptionOverlay>?
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

/// Picks a subtitle track or turns them off.
struct CaptionPicker: View {
    let model: PlayerModel

    var body: some View {
        Menu {
            Picker("Subtitles", selection: Binding(
                get: { model.selectedCaption },
                set: { id in Task { await model.selectCaption(id) } }
            )) {
                Text("Off").tag(String?.none)
                ForEach(model.captionTracks) { track in
                    Text(track.label).tag(String?.some(track.id))
                }
            }
        } label: {
            Image(systemName: model.selectedCaption == nil ? "captions.bubble" : "captions.bubble.fill")
                .foregroundStyle(model.selectedCaption == nil ? Theme.muted : Theme.primaryStrong)
                .frame(width: 48, height: 40)
                .background(model.selectedCaption == nil ? Theme.surface : Theme.primaryTint, in: Capsule())
                .overlay(Capsule().stroke(model.selectedCaption == nil ? Theme.border : Theme.primary))
        }
        .accessibilityLabel(model.selectedCaption == nil ? "Subtitles, off" : "Subtitles, on")
    }
}

/// The video area on the detail screen: the poster with a play button until tapped, then the
/// player, or the reason it could not play.
struct PlayerArea: View {
    @Environment(AppModel.self) private var model
    let card: MediaCard
    @State private var playback = PlayerModel()

    var body: some View {
        VStack(spacing: 10) {
            Color.black
                .aspectRatio(16 / 9, contentMode: .fit)
                .overlay { content }
            if !playback.captionTracks.isEmpty {
                HStack(alignment: .center) {
                    if let error = playback.captionError {
                        Text(error).font(.footnote).foregroundStyle(Theme.danger)
                    }
                    Spacer()
                    CaptionPicker(model: playback)
                }
                .padding(.horizontal, 16)
            }
        }
        .onDisappear { playback.stop() }
    }

    @ViewBuilder
    private var content: some View {
        switch playback.state {
        case .idle:
            Button {
                guard let client = model.client else { return }
                Task { await playback.start(client: client, mediaID: card.id) }
            } label: {
                ZStack {
                    AuthImage(path: card.posterUrl, contentMode: .fit)
                    Image(systemName: "play.fill")
                        .font(.title)
                        .foregroundStyle(Theme.onPrimary)
                        .frame(width: 64, height: 64)
                        .background(Theme.primary, in: Circle())
                }
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Play \(card.title)")
        case .loading:
            ZStack {
                AuthImage(path: card.posterUrl, contentMode: .fit)
                ProgressView().tint(.white)
            }
        case .playing:
            VideoPlayerView(model: playback)
        case .failed(let message):
            VStack(spacing: 10) {
                Image(systemName: "exclamationmark.triangle")
                    .font(.title2)
                Text("This video could not be played")
                    .font(.headline)
                Text(message)
                    .font(.footnote)
                    .multilineTextAlignment(.center)
                    .opacity(0.8)
                Button("Try again") {
                    playback.stop()
                    guard let client = model.client else { return }
                    Task { await playback.start(client: client, mediaID: card.id) }
                }
                .buttonStyle(.bordered)
            }
            .foregroundStyle(.white)
            .padding(20)
        }
    }
}
