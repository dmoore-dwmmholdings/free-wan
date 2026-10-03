import AVFoundation
import AVKit
import Observation
import SwiftUI

/// The video playing now, which outlives its page: backing out of a playing video carries it
/// on in Picture in Picture until another video is opened or the PiP window is closed.
@MainActor
@Observable
final class PlaybackCenter: NSObject {
    static let shared = PlaybackCenter()

    private(set) var currentID: String?
    private(set) var current: PlayerModel?
    private(set) var pipActive = false

    /// Reopens a video's page; the PiP window's button back to the app calls it.
    @ObservationIgnored var onRestore: (String) -> Void = { _ in }
    /// The video whose page is on screen, if any.
    @ObservationIgnored var showing: String?

    @ObservationIgnored private var layer: AVPlayerLayer?
    @ObservationIgnored private var pip: AVPictureInPictureController?
    /// The player that went into PiP, so its stopping does not end a video opened since.
    @ObservationIgnored private var inPiP: PlayerModel?
    @ObservationIgnored private var restoring = false

    /// PiP plays from this layer, which stays on screen when a video's page is gone.
    func attach(_ layer: AVPlayerLayer) {
        self.layer = layer
        layer.player = current?.player
        guard AVPictureInPictureController.isPictureInPictureSupported() else { return }
        let pip = AVPictureInPictureController(playerLayer: layer)
        pip?.delegate = self
        // Leaving the app with a video playing carries it on in PiP too.
        pip?.canStartPictureInPictureAutomaticallyFromInline = true
        self.pip = pip
    }

    /// The player for a video's page. The same video gets the player it already has, back from
    /// PiP if it is there; another video ends the one before.
    func claim(_ id: String) -> PlayerModel {
        if let current, currentID == id {
            if pipActive {
                restoring = true
                pip?.stopPictureInPicture()
            }
            return current
        }
        end()
        let fresh = PlayerModel()
        current = fresh
        currentID = id
        layer?.player = fresh.player
        return fresh
    }

    /// A video's page is gone: if it was playing it carries on in PiP, otherwise it stops.
    func leave(_ model: PlayerModel) {
        guard model === current else {
            model.stop()
            return
        }
        if model.player.rate > 0, let pip, pip.isPictureInPicturePossible {
            inPiP = model
            pip.startPictureInPicture()
        } else {
            end()
        }
    }

    private func end() {
        if pip?.isPictureInPictureActive == true { pip?.stopPictureInPicture() }
        current?.stop()
        current = nil
        currentID = nil
        inPiP = nil
        layer?.player = nil
    }

    private func pipStopped() {
        pipActive = false
        // Closed from the PiP window, rather than handed back to a page or replaced.
        if !restoring && inPiP != nil && inPiP === current { end() }
        restoring = false
        inPiP = nil
    }
}

extension PlaybackCenter: AVPictureInPictureControllerDelegate {
    nonisolated func pictureInPictureControllerDidStartPictureInPicture(_ controller: AVPictureInPictureController) {
        MainActor.assumeIsolated {
            pipActive = true
            if inPiP == nil { inPiP = current } // started by leaving the app
        }
    }

    nonisolated func pictureInPictureControllerDidStopPictureInPicture(_ controller: AVPictureInPictureController) {
        MainActor.assumeIsolated { pipStopped() }
    }

    nonisolated func pictureInPictureController(_ controller: AVPictureInPictureController,
                                                failedToStartPictureInPictureWithError error: Error) {
        MainActor.assumeIsolated {
            pipActive = false
            end()
        }
    }

    nonisolated func pictureInPictureController(
        _ controller: AVPictureInPictureController,
        restoreUserInterfaceForPictureInPictureStopWithCompletionHandler completion: @escaping (Bool) -> Void
    ) {
        MainActor.assumeIsolated {
            restoring = true
            if let currentID, currentID != showing { onRestore(currentID) }
        }
        completion(true)
    }
}

/// The always-present layer PiP plays from. A few points in size, behind everything: a layer
/// must be in the window, though not seen, for PiP to start from it.
struct PiPHost: UIViewRepresentable {
    func makeUIView(context: Context) -> PlayerLayerView.LayerView {
        let view = PlayerLayerView.LayerView()
        view.isUserInteractionEnabled = false
        PlaybackCenter.shared.attach(view.playerLayer)
        return view
    }

    func updateUIView(_ view: PlayerLayerView.LayerView, context: Context) {}
}
