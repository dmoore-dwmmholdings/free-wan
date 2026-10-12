import AVFoundation
import AVKit
import FreeWANKit
import Observation
import SwiftUI
import UIKit

/// The system player: standard controls, full screen and AirPlay. Captions
/// are drawn in its content overlay, so they stay visible in full screen too.
struct VideoPlayerView: UIViewControllerRepresentable {
    let model: PlayerModel

    func makeUIViewController(context: Context) -> AVPlayerViewController {
        let controller = AVPlayerViewController()
        controller.player = model.player
        controller.delegate = context.coordinator
        // Picture in Picture comes from PlaybackCenter, which keeps it going after this page.
        controller.allowsPictureInPicturePlayback = false

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

    func makeCoordinator() -> Coordinator { Coordinator(model: model) }

    /// Keeps the hosting controller alive for as long as the player view, and tells the model
    /// when the player goes full screen.
    @MainActor
    final class Coordinator: NSObject, AVPlayerViewControllerDelegate {
        let model: PlayerModel
        var captions: UIHostingController<CaptionOverlay>?

        init(model: PlayerModel) {
            self.model = model
        }

        func playerViewController(_ controller: AVPlayerViewController,
                                  willBeginFullScreenPresentationWithAnimationCoordinator coordinator: UIViewControllerTransitionCoordinator) {
            model.isFullScreen = true
            FullScreenRotation.began()
        }

        func playerViewController(_ controller: AVPlayerViewController,
                                  willEndFullScreenPresentationWithAnimationCoordinator coordinator: UIViewControllerTransitionCoordinator) {
            // A swipe that is let go of part way stays in full screen.
            coordinator.animate(alongsideTransition: nil) { [model] context in
                MainActor.assumeIsolated {
                    guard !context.isCancelled else { return }
                    model.isFullScreen = false
                    FullScreenRotation.ended()
                }
            }
        }
    }
}

/// The app is portrait only; a video in the system player's full screen may turn to landscape.
@MainActor
final class FullScreenRotation: NSObject, AVPlayerViewControllerDelegate {
    /// For players with no delegate of their own.
    static let shared = FullScreenRotation()
    private(set) static var allowsLandscape = false
    /// The system player's full screen covers the page it came from, which SwiftUI reports as
    /// that page disappearing; a page should not stop its video for it.
    static var isFullScreen: Bool { allowsLandscape }

    static func began() {
        allowsLandscape = true
        updateWindows()
    }

    /// Back to portrait, turning the screen round if the phone is held sideways.
    static func ended() {
        allowsLandscape = false
        updateWindows()
        for scene in UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }) {
            scene.requestGeometryUpdate(.iOS(interfaceOrientations: .portrait))
        }
    }

    private static func updateWindows() {
        for scene in UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }) {
            scene.keyWindow?.rootViewController?.setNeedsUpdateOfSupportedInterfaceOrientations()
        }
    }

    func playerViewController(_ controller: AVPlayerViewController,
                              willBeginFullScreenPresentationWithAnimationCoordinator coordinator: UIViewControllerTransitionCoordinator) {
        Self.began()
    }

    func playerViewController(_ controller: AVPlayerViewController,
                              willEndFullScreenPresentationWithAnimationCoordinator coordinator: UIViewControllerTransitionCoordinator) {
        coordinator.animate(alongsideTransition: nil) { context in
            MainActor.assumeIsolated { if !context.isCancelled { Self.ended() } }
        }
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

/// The video area on the detail screen: plays as soon as it opens, like a watch page, or shows
/// the reason it could not play.
struct PlayerArea: View {
    @Environment(AppModel.self) private var model
    let card: MediaCard
    /// A stand-in until the page appears and takes the video's shared player.
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
        .task {
            let center = PlaybackCenter.shared
            playback = center.claim(card.id)
            center.showing = card.id
            guard playback.state == .idle, let client = model.client else { return }
            await playback.start(client: client, mediaID: card.id)
        }
        .onDisappear {
            let center = PlaybackCenter.shared
            if center.showing == card.id { center.showing = nil }
            if !playback.isFullScreen { center.leave(playback) }
        }
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
