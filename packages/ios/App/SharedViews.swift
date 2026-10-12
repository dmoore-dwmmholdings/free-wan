import AVFoundation
import FreeWANKit
import SwiftUI
import UIKit

// Views the iPhone and Apple TV apps both use.

/// A video playing on a loop inside its tile, filling it as the poster does. With `snippets` it
/// plays a few seconds from each of several points across the video, to tell what it is.
struct TileVideo: View {
    @Environment(AppModel.self) private var model
    let card: MediaCard
    let muted: Bool
    var snippets = false

    @State private var player: AVPlayer?
    /// Keeps a repeating video's looper alive.
    @State private var loop: Loop?

    var body: some View {
        ZStack {
            if let player { PlayerLayerView(player: player, gravity: .resizeAspectFill) }
        }
        .allowsHitTesting(false)
        .task(id: snippets) {
            player?.pause()
            loop = nil
            guard let client = model.client else { return }
            let starts = snippets ? PreviewSnippets.starts(duration: card.durationS) : [0]
            // A copy on the phone is for a short video that repeats, not one jumped about in.
            guard let playable = await playableAsset(card, client: client, keepCopy: starts.count == 1),
                  !Task.isCancelled else { return }
            guard starts.count > 1 else {
                let repeating = Loop(playable, muted: muted)
                repeating.player.play()
                loop = repeating
                player = repeating.player
                return
            }
            let item = AVPlayerItem(asset: playable.asset)
            // A tile needs a few seconds ahead, not the deep buffer a full-screen player keeps.
            item.preferredForwardBufferDuration = 4
            let tile = AVPlayer(playerItem: item)
            tile.isMuted = muted
            tile.automaticallyWaitsToMinimizeStalling = false
            tile.play()
            player = tile
            var piece = 0
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(250))
                if tile.currentTime().seconds >= starts[piece] + PreviewSnippets.length {
                    piece = (piece + 1) % starts.count
                    await tile.seek(to: CMTime(seconds: starts[piece], preferredTimescale: 600))
                }
            }
        }
        .onChange(of: muted) { _, muted in player?.isMuted = muted }
        .onDisappear {
            player?.pause()
            player = nil
            loop = nil
        }
    }
}

/// Spinner, error or empty message over the grid when there is nothing to show.
struct LibraryStatus: View {
    let pager: Pager<MediaCard>
    let query: MediaListQuery

    var body: some View {
        if pager.items.isEmpty {
            if !pager.loaded && pager.error == nil {
                ProgressView()
            } else if let error = pager.error {
                ErrorStateView(error: error) { await pager.reload() }
            } else if pager.loaded {
                ContentUnavailableView("Nothing here", systemImage: "square.grid.2x2",
                                       description: Text(emptyMessage))
            }
        }
    }

    private var emptyMessage: String { query.emptyMessage }
}

/// Players for the gallery's current video and the ones either side, made ahead so stepping to
/// one starts it at once. Making one also starts the server's transcode when the video needs it.
@MainActor
final class LoopPlayers {
    private var made: [String: Task<Loop?, Never>] = [:]

    /// The player for `card`, made now if it was not made ahead.
    func player(for card: MediaCard, client: APIClient) async -> AVPlayer? {
        if made[card.id] == nil { make(card, client: client) }
        return await made[card.id]?.value?.player
    }

    /// Makes players for `cards` and lets go of the rest.
    func keep(_ cards: [MediaCard], client: APIClient?) {
        let ids = Set(cards.map(\.id))
        for (id, task) in made where !ids.contains(id) {
            task.cancel()
            made[id] = nil
            Task { await task.value?.player.pause() }
        }
        guard let client else { return }
        for card in cards where made[card.id] == nil { make(card, client: client) }
    }

    private func make(_ card: MediaCard, client: APIClient) {
        made[card.id] = Task {
            guard let playable = await playableAsset(card, client: client, keepCopy: true),
                  !Task.isCancelled else { return nil }
            return Loop(playable, muted: true)
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

/// A collection's cover: with four or more items, its first four tiled; with fewer, one
/// picture, its chosen cover or else its first item's poster.
struct CollectionCover: View {
    let collection: MediaCollection
    let posters: [String]

    var body: some View {
        if collection.itemCount >= 4 && posters.count >= 4 {
            Grid(horizontalSpacing: 1, verticalSpacing: 1) {
                GridRow { tile(posters[0]); tile(posters[1]) }
                GridRow { tile(posters[2]); tile(posters[3]) }
            }
            .background(Theme.background)
        } else if let cover = collection.coverUrl ?? posters.first {
            AuthImage(path: cover)
        } else {
            Theme.surface2.overlay {
                Image(systemName: "rectangle.stack").foregroundStyle(Theme.muted)
            }
        }
    }

    private func tile(_ path: String) -> some View {
        Color.clear
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .overlay { AuthImage(path: path) }
            .clipped()
    }
}

struct TagList: View {
    let tags: [Tag]

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(tags) { tag in
                    HStack(spacing: 6) {
                        Circle()
                            .fill(tag.color.flatMap(RGBA.init(hex:)).map { Color($0) } ?? Theme.primary)
                            .frame(width: 8, height: 8)
                        Text(tag.name).font(.caption.weight(.semibold)).foregroundStyle(Theme.muted)
                    }
                    .padding(.horizontal, 10)
                    .frame(height: 28)
                    .background(Theme.surface, in: Capsule())
                    .overlay(Capsule().stroke(Theme.border))
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel("Tag \(tag.name)")
                }
            }
        }
    }
}

struct FileDetails: View {
    let detail: MediaDetail

    var body: some View {
        VStack(spacing: 0) {
            row("Resolution", detail.resolution)
            row("Size", Format.bytes(detail.sizeBytes))
            row("Format", detail.ext.uppercased())
            row("Video", detail.videoCodec)
            row("Audio", detail.audioCodec)
            row("Frame rate", detail.frameRate.map { $0.formatted(.number.precision(.fractionLength(0...3))) + " fps" })
            row("Added", Date(timeIntervalSince1970: detail.addedAt / 1000).formatted(date: .abbreviated, time: .omitted))
        }
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.radiusSmall))
    }

    @ViewBuilder
    private func row(_ label: String, _ value: String?) -> some View {
        if let value, !value.isEmpty {
            HStack {
                Text(label).foregroundStyle(Theme.muted)
                Spacer()
                Text(value).foregroundStyle(Theme.text)
            }
            .font(.footnote)
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
        }
    }
}
