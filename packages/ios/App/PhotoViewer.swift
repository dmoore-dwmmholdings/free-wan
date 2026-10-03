import AVFoundation
import FreeWANKit
import SwiftUI
import UIKit

/// Full-screen gallery: tap the left or right side or swipe sideways to move, swipe up for
/// details, swipe down to close, pinch to zoom a photo. Videos play muted on a loop, like GIFs.
struct PhotoViewer: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @Environment(\.displayScale) private var scale
    let items: [MediaCard]
    @State var current: String
    /// Tells the list a like changed, by item id, so its tile agrees.
    var onLikeChange: (String, Bool, Int) -> Void = { _, _, _ in }

    @State private var info: MediaCard?
    @State private var muted = true
    @State private var players = LoopPlayers()

    private var card: MediaCard? { items.first { $0.id == current } }

    var body: some View {
        GeometryReader { geometry in
            ZStack {
                Color.black
                // One page at a time, swapped without a transition so stepping is instant.
                if let card {
                    page(card)
                        .id(card.id)
                }
            }
            .task(id: current) { await preloadNeighbours(size: geometry.size) }
            .onDisappear { players.keep([], client: nil) }
        }
        .ignoresSafeArea()
        .overlay(alignment: .topTrailing) {
            HStack(spacing: 12) {
                if card?.type == .video {
                    circleButton(muted ? "speaker.slash.fill" : "speaker.wave.2.fill",
                                 label: muted ? "Unmute" : "Mute") { muted.toggle() }
                }
                circleButton("xmark", label: "Close") { dismiss() }
            }
            .padding(16)
        }
        .overlay(alignment: .bottom) {
            if let card, LibraryPrefs.shared.showsNames(card.repositoryId) {
                Text(card.title)
                    .font(.footnote)
                    .foregroundStyle(.white)
                    .lineLimit(1)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(.black.opacity(0.5), in: Capsule())
                    .padding(.bottom, 24)
            }
        }
        .statusBarHidden()
        // Muted loops should not stop music from other apps; sound on is a real playback. A
        // video in Picture in Picture keeps the playback session it has.
        .onChange(of: muted, initial: true) { _, muted in
            guard !PlaybackCenter.shared.pipActive else { return }
            try? AVAudioSession.sharedInstance().setCategory(muted ? .ambient : .playback,
                                                             mode: muted ? .default : .moviePlayback)
        }
        .onDisappear {
            try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback)
        }
        .sheet(item: $info) { card in
            MediaInfoSheet(card: card) { liked, count in onLikeChange(card.id, liked, count) }
        }
    }

    @ViewBuilder
    private func page(_ card: MediaCard) -> some View {
        if card.type == .video {
            LoopingVideo(card: card, muted: muted, players: players)
                .galleryGestures(onTap: tapped, onSwipe: { swiped($0, card) })
        } else {
            ZoomablePhoto(card: card, onTap: tapped, onSwipe: { swiped($0, card) })
        }
    }

    private func tapped(_ x: CGFloat) {
        step(x < 0.5 ? -1 : 1)
    }

    private func swiped(_ swipe: GallerySwipe, _ card: MediaCard) {
        switch swipe {
        case .left: step(1)
        case .right: step(-1)
        case .up: info = card
        case .down: dismiss()
        }
    }

    private func step(_ by: Int) {
        guard let index = items.firstIndex(where: { $0.id == current }),
              items.indices.contains(index + by) else { return }
        current = items[index + by].id
    }

    /// Fetches the photos either side and readies their videos, so stepping to them shows them
    /// at once.
    private func preloadNeighbours(size: CGSize) async {
        guard let client = model.client, let index = items.firstIndex(where: { $0.id == current }) else { return }
        let around = [index, index + 1, index - 1].filter(items.indices.contains).map { items[$0] }
        players.keep(around.filter { $0.type == .video }, client: client)
        for neighbour in [index + 1, index - 1] where items.indices.contains(neighbour) {
            let item = items[neighbour]
            let path = item.type == .video ? item.posterUrl : ZoomablePhoto.screenPath(item, size: size, scale: scale)
            _ = await ImageCache.shared.load(path, client: client)
        }
    }

    private func circleButton(_ symbol: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.headline)
                .foregroundStyle(.white)
                .frame(width: 44, height: 44)
                .background(.black.opacity(0.5), in: Circle())
        }
        .accessibilityLabel(label)
    }
}

enum GallerySwipe {
    case left, right, up, down

    /// The direction of a finished drag, or nil when it was too short to count.
    init?(_ translation: CGSize) {
        let (dx, dy) = (translation.width, translation.height)
        if abs(dx) > abs(dy) {
            guard abs(dx) > 50 else { return nil }
            self = dx < 0 ? .left : .right
        } else {
            guard abs(dy) > 60 else { return nil }
            self = dy < 0 ? .up : .down
        }
    }
}

extension View {
    /// The gallery's taps and swipes for a page that is not a zoomable photo, which handles
    /// its own in UIKit alongside the zoom.
    func galleryGestures(onTap: @escaping (CGFloat) -> Void, onSwipe: @escaping (GallerySwipe) -> Void) -> some View {
        GeometryReader { geometry in
            self
                .frame(width: geometry.size.width, height: geometry.size.height)
                .contentShape(Rectangle())
                .onTapGesture { location in onTap(location.x / max(geometry.size.width, 1)) }
                .gesture(DragGesture(minimumDistance: 20).onEnded { value in
                    if let swipe = GallerySwipe(value.translation) { onSwipe(swipe) }
                })
        }
    }
}

/// A video's media, from a downloaded copy when there is one, otherwise from the server; nil
/// when neither can be had.
@MainActor
func playableAsset(_ card: MediaCard, client: APIClient) async -> AVURLAsset? {
    let downloads = DownloadManager.shared
    if let local = downloads.index[card.id].map(downloads.fileURL) { return AVURLAsset(url: local) }
    guard let descriptor = try? await MediaAPI.playback(client, id: card.id),
          let url = try? client.url(descriptor.url) else { return nil }
    return AVURLAsset(url: url, options: ["AVURLAssetHTTPHeaderFieldsKey": client.authHeaders])
}

/// Players for the gallery's current video and the ones either side, made ahead so stepping to
/// one starts it at once. Making one also starts the server's transcode when the video needs it.
@MainActor
final class LoopPlayers {
    private var made: [String: Task<AVPlayer?, Never>] = [:]

    /// The player for `card`, made now if it was not made ahead.
    func player(for card: MediaCard, client: APIClient) async -> AVPlayer? {
        if made[card.id] == nil { make(card, client: client) }
        return await made[card.id]?.value
    }

    /// Makes players for `cards` and lets go of the rest.
    func keep(_ cards: [MediaCard], client: APIClient?) {
        let ids = Set(cards.map(\.id))
        for (id, task) in made where !ids.contains(id) {
            task.cancel()
            made[id] = nil
            Task { await task.value?.pause() }
        }
        guard let client else { return }
        for card in cards where made[card.id] == nil { make(card, client: client) }
    }

    private func make(_ card: MediaCard, client: APIClient) {
        made[card.id] = Task {
            guard let asset = await playableAsset(card, client: client), !Task.isCancelled else { return nil }
            let player = AVPlayer(playerItem: AVPlayerItem(asset: asset))
            player.isMuted = true
            // A short loop should start on its first frames rather than wait for a deep buffer.
            player.automaticallyWaitsToMinimizeStalling = false
            return player
        }
    }
}

/// A video playing on a loop with no controls, like a GIF, over its poster until it starts.
struct LoopingVideo: View {
    @Environment(AppModel.self) private var model
    let card: MediaCard
    let muted: Bool
    let players: LoopPlayers

    @State private var player: AVPlayer?
    @State private var failed = false

    var body: some View {
        ZStack {
            if let client = model.client,
               let poster = ImageCache.shared.image(client.baseURL.absoluteString + card.posterUrl) {
                Image(uiImage: poster).resizable().aspectRatio(contentMode: .fit)
            }
            if let player { PlayerLayerView(player: player) }
            if failed {
                Label("This video could not be played", systemImage: "film")
                    .foregroundStyle(.white)
            } else if player == nil {
                ProgressView().tint(.white)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .task { await play() }
        .onDisappear { player?.pause() }
        .onChange(of: muted) { _, muted in player?.isMuted = muted }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(card.title)
    }

    /// Plays and loops until the page goes away.
    private func play() async {
        guard let client = model.client else { return }
        guard let player = await players.player(for: card, client: client), let item = player.currentItem else {
            if !Task.isCancelled { failed = true }
            return
        }
        guard !Task.isCancelled else { return }
        player.isMuted = muted
        player.play()
        self.player = player
        for await _ in NotificationCenter.default.notifications(named: AVPlayerItem.didPlayToEndTimeNotification, object: item) {
            await player.seek(to: .zero)
            player.play()
        }
    }
}

/// The bare picture of an AVPlayer, without the system controls.
struct PlayerLayerView: UIViewRepresentable {
    let player: AVPlayer
    var gravity = AVLayerVideoGravity.resizeAspect

    func makeUIView(context: Context) -> LayerView {
        let view = LayerView()
        view.playerLayer.player = player
        view.playerLayer.videoGravity = gravity
        // Taps and swipes belong to the gallery around it.
        view.isUserInteractionEnabled = false
        return view
    }

    func updateUIView(_ view: LayerView, context: Context) {
        view.playerLayer.player = player
    }

    final class LayerView: UIView {
        override class var layerClass: AnyClass { AVPlayerLayer.self }
        var playerLayer: AVPlayerLayer { layer as! AVPlayerLayer }
    }
}

/// One photo, sized for the screen, swapped for the original once zoomed in far enough to
/// see the difference.
struct ZoomablePhoto: View {
    @Environment(AppModel.self) private var model
    @Environment(\.displayScale) private var scale
    let card: MediaCard
    /// A single tap, with where it landed across the width from 0 to 1.
    var onTap: (CGFloat) -> Void = { _ in }
    var onSwipe: (GallerySwipe) -> Void = { _ in }

    @State private var image: UIImage?
    @State private var original = false
    @State private var failed = false

    /// The screen-sized copy of `card`, also what the gallery preloads for the photos around it.
    static func screenPath(_ card: MediaCard, size: CGSize, scale: CGFloat) -> String {
        PhotoSize.path(id: card.id, width: PhotoSize.width(
            points: max(size.width, size.height), scale: scale, sourceWidth: card.width))
    }

    var body: some View {
        GeometryReader { geometry in
            ZStack {
                // A preloaded copy shows on the first frame, before the task below runs.
                if let image = image ?? cached(size: geometry.size) {
                    ZoomableImage(image: image, onZoom: { zoom in
                        if zoom > 1.5 && !original { original = true }
                    }, onTap: onTap, onSwipe: onSwipe)
                } else {
                    // Still loading or failed: taps and swipes still move between items.
                    Group {
                        if failed {
                            Label("This photo could not be loaded", systemImage: "photo")
                                .foregroundStyle(.white)
                        } else {
                            ProgressView().tint(.white)
                        }
                    }
                    .galleryGestures(onTap: onTap, onSwipe: onSwipe)
                }
            }
            .frame(width: geometry.size.width, height: geometry.size.height)
            .task(id: original) {
                guard let client = model.client else { return }
                let path = original ? PhotoSize.path(id: card.id, width: nil)
                    : Self.screenPath(card, size: geometry.size, scale: scale)
                if let loaded = await ImageCache.shared.load(path, client: client) {
                    image = loaded
                } else if image == nil {
                    failed = true
                }
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(card.title)
        .accessibilityAddTraits(.isImage)
    }

    private func cached(size: CGSize) -> UIImage? {
        guard let client = model.client else { return nil }
        return ImageCache.shared.image(client.baseURL.absoluteString + Self.screenPath(card, size: size, scale: scale))
    }
}

/// A UIScrollView around an image view, for native pinch and pan zoom, plus the gallery's taps
/// and swipes, which only count while the photo is not zoomed in.
struct ZoomableImage: UIViewRepresentable {
    let image: UIImage
    var onZoom: (CGFloat) -> Void = { _ in }
    var onTap: (CGFloat) -> Void = { _ in }
    var onSwipe: (GallerySwipe) -> Void = { _ in }

    func makeUIView(context: Context) -> UIScrollView {
        let scroll = UIScrollView()
        scroll.delegate = context.coordinator
        scroll.minimumZoomScale = 1
        scroll.maximumZoomScale = 5
        scroll.showsHorizontalScrollIndicator = false
        scroll.showsVerticalScrollIndicator = false
        scroll.backgroundColor = .black

        let imageView = UIImageView(image: image)
        imageView.contentMode = .scaleAspectFit
        imageView.frame = scroll.bounds
        imageView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        scroll.addSubview(imageView)
        context.coordinator.imageView = imageView

        // No double-tap zoom: waiting to rule out a second tap would delay every step.
        let tap = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.tapped(_:)))
        scroll.addGestureRecognizer(tap)

        for direction: UISwipeGestureRecognizer.Direction in [.left, .right, .up, .down] {
            let swipe = UISwipeGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.swiped(_:)))
            swipe.direction = direction
            swipe.delegate = context.coordinator
            scroll.addGestureRecognizer(swipe)
        }
        return scroll
    }

    func updateUIView(_ scroll: UIScrollView, context: Context) {
        context.coordinator.onZoom = onZoom
        context.coordinator.onTap = onTap
        context.coordinator.onSwipe = onSwipe
        // A sharper copy of the same photo replaces the image without resetting the zoom.
        if context.coordinator.imageView?.image !== image {
            context.coordinator.imageView?.image = image
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator(onZoom: onZoom, onTap: onTap, onSwipe: onSwipe) }

    final class Coordinator: NSObject, UIScrollViewDelegate, UIGestureRecognizerDelegate {
        var imageView: UIImageView?
        var onZoom: (CGFloat) -> Void
        var onTap: (CGFloat) -> Void
        var onSwipe: (GallerySwipe) -> Void

        init(onZoom: @escaping (CGFloat) -> Void, onTap: @escaping (CGFloat) -> Void,
             onSwipe: @escaping (GallerySwipe) -> Void) {
            self.onZoom = onZoom
            self.onTap = onTap
            self.onSwipe = onSwipe
        }

        func viewForZooming(in scrollView: UIScrollView) -> UIView? { imageView }

        func scrollViewDidEndZooming(_ scrollView: UIScrollView, with view: UIView?, atScale scale: CGFloat) {
            onZoom(scale)
        }

        @objc func tapped(_ gesture: UITapGestureRecognizer) {
            guard let view = gesture.view, view.bounds.width > 0 else { return }
            // A scroll view's bounds move with the zoomed content; measure across what is on screen.
            onTap((gesture.location(in: view).x - view.bounds.minX) / view.bounds.width)
        }

        @objc func swiped(_ gesture: UISwipeGestureRecognizer) {
            switch gesture.direction {
            case .left: onSwipe(.left)
            case .right: onSwipe(.right)
            case .up: onSwipe(.up)
            default: onSwipe(.down)
            }
        }

        /// Zoomed in, a drag pans the photo instead.
        func gestureRecognizerShouldBegin(_ gesture: UIGestureRecognizer) -> Bool {
            (gesture.view as? UIScrollView).map { $0.zoomScale <= $0.minimumZoomScale } ?? true
        }

        /// The scroll view's own pan sees the same drag; at normal zoom it has nothing to move.
        func gestureRecognizer(_ gesture: UIGestureRecognizer,
                               shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool {
            other === (gesture.view as? UIScrollView)?.panGestureRecognizer
        }
    }
}
