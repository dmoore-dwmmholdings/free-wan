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
        do {
            let descriptor = try await MediaAPI.playback(client, id: mediaID)
            duration = descriptor.duration
            resumeAt = descriptor.resumeAt
            // AVPlayer makes its own requests, including every HLS segment; this asset option
            // puts the session token on all of them.
            let asset = AVURLAsset(url: try client.url(descriptor.url),
                                   options: ["AVURLAssetHTTPHeaderFieldsKey": client.authHeaders])
            let item = AVPlayerItem(asset: asset)
            observe(item)
            player.replaceCurrentItem(with: item)
            player.play()
            state = .playing
        } catch {
            state = .failed(error.localizedDescription)
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
        if let backgroundObserver { NotificationCenter.default.removeObserver(backgroundObserver) }
        timeObserver = nil
        backgroundObserver = nil
        statusObservation = nil
        rateObservation = nil
        player.replaceCurrentItem(with: nil)
        state = .idle
        resumed = false
    }
}

/// The system player: standard controls, full screen, AirPlay and Picture in Picture.
struct VideoPlayerView: UIViewControllerRepresentable {
    let player: AVPlayer

    func makeUIViewController(context: Context) -> AVPlayerViewController {
        let controller = AVPlayerViewController()
        controller.player = player
        controller.allowsPictureInPicturePlayback = true
        controller.canStartPictureInPictureAutomaticallyFromInline = true
        return controller
    }

    func updateUIViewController(_ controller: AVPlayerViewController, context: Context) {
        if controller.player !== player { controller.player = player }
    }
}

/// The video area on the detail screen: the poster with a play button until tapped, then the
/// player, or the reason it could not play.
struct PlayerArea: View {
    @Environment(AppModel.self) private var model
    let card: MediaCard
    @State private var playback = PlayerModel()

    var body: some View {
        Color.black
            .aspectRatio(16 / 9, contentMode: .fit)
            .overlay { content }
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
            VideoPlayerView(player: playback.player)
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
