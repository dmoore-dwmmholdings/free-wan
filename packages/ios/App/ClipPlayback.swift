import AVFoundation
import FreeWANKit
import Observation

/// Plays a clip's span of its source, looping or stopping at the out point.
@MainActor
@Observable
final class ClipPlayback {
    let player = AVPlayer()
    private(set) var preview: ClipPreview?
    private(set) var error: String?
    private var observer: Any?

    func start(client: APIClient, clipID: String) async {
        do {
            let preview = try await MediaAPI.clipPreview(client, id: clipID)
            self.preview = preview
            guard preview.playable else { return }
            let asset = AVURLAsset(url: try client.url(preview.sourceUrl),
                                   options: ["AVURLAssetHTTPHeaderFieldsKey": client.authHeaders])
            player.replaceCurrentItem(with: AVPlayerItem(asset: asset))
            _ = await player.seek(to: CMTime(seconds: preview.startS, preferredTimescale: 600),
                              toleranceBefore: .zero, toleranceAfter: .zero)
            observer = player.addPeriodicTimeObserver(
                forInterval: CMTime(seconds: 0.1, preferredTimescale: 600), queue: .main
            ) { [weak self] time in
                Task { @MainActor in self?.tick(time.seconds) }
            }
            player.play()
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func tick(_ time: Double) {
        guard let preview, time.isFinite,
              let command = ClipLoop.command(at: time, startS: preview.startS, endS: preview.endS, loop: preview.loop)
        else { return }
        if command.pause { player.pause() }
        player.seek(to: CMTime(seconds: command.seekTo, preferredTimescale: 600),
                    toleranceBefore: .zero, toleranceAfter: .zero)
    }

    func stop() {
        if let observer { player.removeTimeObserver(observer) }
        observer = nil
        player.pause()
        player.replaceCurrentItem(with: nil)
    }
}
