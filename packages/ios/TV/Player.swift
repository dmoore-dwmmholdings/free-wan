import AVFoundation
import AVKit
import FreeWANKit
import SwiftUI
import UIKit

/// A video in the system TV player, from where it was left off, saving the position as it goes.
/// Subtitles are in the player's menu bar; swiping down shows its details and a like button.
struct TVVideoPlayer: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let card: MediaCard
    var onLikeChange: (Bool, Int) -> Void = { _, _ in }

    @State private var playback = PlayerModel()

    var body: some View {
        ZStack {
            Color.black
            switch playback.state {
            case .playing:
                TVPlayerController(model: playback, info: AnyView(
                    TVItemInfo(card: card, wide: true, onLikeChange: onLikeChange)
                        .padding(.horizontal, 80)
                        .padding(.vertical, 30)
                        .environment(model)))
            case .failed(let message):
                VStack(spacing: 24) {
                    Image(systemName: "exclamationmark.triangle").font(.largeTitle)
                    Text("This video could not be played").font(.title3.bold())
                    Text(message).foregroundStyle(.secondary).multilineTextAlignment(.center)
                    HStack(spacing: 30) {
                        Button("Try again") { start() }
                        Button("Back") { dismiss() }
                    }
                }
                .padding(80)
            case .idle, .loading:
                AuthImage(path: card.posterUrl, contentMode: .fit, placeholder: .black)
                ProgressView()
            }
        }
        .ignoresSafeArea()
        .task { if playback.state == .idle { start() } }
        // In Picture in Picture the video carries on after this screen closes.
        .onDisappear { if !playback.isFullScreen { playback.stop() } }
    }

    private func start() {
        playback.stop()
        guard let client = model.client else { return }
        Task { await playback.start(client: client, mediaID: card.id) }
    }
}

/// AVPlayerViewController, with subtitles drawn over the picture and offered in the menu bar,
/// an Info panel, and Picture in Picture.
struct TVPlayerController: UIViewControllerRepresentable {
    let model: PlayerModel
    let info: AnyView

    func makeUIViewController(context: Context) -> AVPlayerViewController {
        let controller = AVPlayerViewController()
        controller.player = model.player
        controller.delegate = context.coordinator
        controller.allowsPictureInPicturePlayback = true

        let captions = UIHostingController(rootView: CaptionOverlay(model: model))
        captions.view.backgroundColor = .clear
        captions.view.isUserInteractionEnabled = false
        if let overlay = controller.contentOverlayView {
            captions.view.frame = overlay.bounds
            captions.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            overlay.addSubview(captions.view)
        }
        context.coordinator.captions = captions

        let details = UIHostingController(rootView: info)
        details.title = "Info"
        details.preferredContentSize = CGSize(width: 0, height: 420)
        controller.customInfoViewControllers = [details]
        context.coordinator.updateSubtitles(controller)
        return controller
    }

    func updateUIViewController(_ controller: AVPlayerViewController, context: Context) {
        context.coordinator.updateSubtitles(controller)
    }

    func makeCoordinator() -> Coordinator { Coordinator(model: model) }

    @MainActor
    final class Coordinator: NSObject, AVPlayerViewControllerDelegate {
        let model: PlayerModel
        var captions: UIHostingController<CaptionOverlay>?

        init(model: PlayerModel) {
            self.model = model
        }

        /// A Subtitles menu in the transport bar, once the server has said which tracks there are.
        func updateSubtitles(_ controller: AVPlayerViewController) {
            guard !model.captionTracks.isEmpty else {
                controller.transportBarCustomMenuItems = []
                return
            }
            let choose = { [model] (id: String?) in Task { await model.selectCaption(id) } }
            var actions = [UIAction(title: "Off", state: model.selectedCaption == nil ? .on : .off) { _ in choose(nil) }]
            for track in model.captionTracks {
                actions.append(UIAction(title: track.label, state: model.selectedCaption == track.id ? .on : .off) { _ in
                    choose(track.id)
                })
            }
            controller.transportBarCustomMenuItems = [
                UIMenu(title: "Subtitles", image: UIImage(systemName: "captions.bubble"), options: .singleSelection, children: actions),
            ]
        }

        // Picture in Picture keeps the player once its screen has closed.
        func playerViewControllerWillStartPictureInPicture(_ controller: AVPlayerViewController) {
            model.isFullScreen = true
        }

        func playerViewControllerDidStopPictureInPicture(_ controller: AVPlayerViewController) {
            model.isFullScreen = false
            if controller.view.window == nil { model.stop() }
        }
    }
}
