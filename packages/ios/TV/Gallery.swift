import AVFoundation
import FreeWANKit
import SwiftUI

/// Full-screen photos and looping videos. Left and right on the remote step between them, up
/// shows details, play/pause turns a video's sound on and off, Menu goes back.
struct TVGallery: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @Environment(\.displayScale) private var scale
    let items: [MediaCard]
    @State var current: String
    var onLikeChange: (String, Bool, Int) -> Void = { _, _, _ in }

    @State private var muted = true
    @State private var showingInfo = false
    @State private var players = LoopPlayers()
    @FocusState private var focused: Bool

    private var card: MediaCard? { items.first { $0.id == current } }

    var body: some View {
        ZStack {
            Color.black
            if let card {
                page(card).id(card.id)
            }
        }
        .ignoresSafeArea()
        .overlay(alignment: .bottomLeading) {
            if let card, LibraryPrefs.shared.showsNames(card.repositoryId) {
                Text(card.title)
                    .font(.callout)
                    .padding(.horizontal, 20)
                    .padding(.vertical, 10)
                    .background(.black.opacity(0.5), in: Capsule())
                    .padding(60)
            }
        }
        .focusable()
        .focused($focused)
        .onAppear { focused = true }
        .onMoveCommand { direction in
            switch direction {
            case .left: step(-1)
            case .right: step(1)
            case .up: showingInfo = true
            default: break
            }
        }
        .onPlayPauseCommand { muted.toggle() }
        .onExitCommand { dismiss() }
        // A sheet of its own, so its like button takes focus and presses like any other.
        .sheet(isPresented: $showingInfo, onDismiss: { focused = true }) {
            if let card {
                TVItemInfo(card: card) { liked, count in onLikeChange(card.id, liked, count) }
                    .padding(60)
                    .frame(maxWidth: 1100, alignment: .leading)
                    .environment(model)
            }
        }
        .task(id: current) { prepareNeighbours() }
        .onDisappear { players.keep([], client: nil) }
    }

    @ViewBuilder
    private func page(_ card: MediaCard) -> some View {
        if card.type == .video {
            TVLoopingVideo(card: card, muted: muted, players: players)
        } else {
            AuthImage(path: PhotoSize.path(id: card.id, width: PhotoSize.width(
                points: 1920, scale: scale, sourceWidth: card.width)), contentMode: .fit, placeholder: .black)
        }
    }

    private func step(_ by: Int) {
        guard let index = items.firstIndex(where: { $0.id == current }),
              items.indices.contains(index + by) else { return }
        current = items[index + by].id
    }

    /// Readies the videos either side, so stepping to one starts it at once.
    private func prepareNeighbours() {
        guard let index = items.firstIndex(where: { $0.id == current }) else { return }
        let around = [index, index + 1, index - 1].filter(items.indices.contains).map { items[$0] }
        players.keep(around.filter { $0.type == .video }, client: model.client)
    }
}

/// A gallery video, looping with no controls.
struct TVLoopingVideo: View {
    @Environment(AppModel.self) private var model
    let card: MediaCard
    let muted: Bool
    let players: LoopPlayers

    @State private var player: AVPlayer?

    var body: some View {
        ZStack {
            AuthImage(path: card.posterUrl, contentMode: .fit, placeholder: .black)
            if let player { PlayerLayerView(player: player) }
        }
        .task {
            guard let client = model.client,
                  let player = await players.player(for: card, client: client), !Task.isCancelled else { return }
            player.isMuted = muted
            player.play()
            self.player = player
        }
        .onChange(of: muted) { _, muted in player?.isMuted = muted }
        .onDisappear { player?.pause() }
    }
}

/// An item's title, where it lives, a like button, tags and file details: stacked, or side by
/// side to fit the player's short Info panel.
struct TVItemInfo: View {
    @Environment(AppModel.self) private var model
    let card: MediaCard
    var wide = false
    var onLikeChange: (Bool, Int) -> Void = { _, _ in }

    @State private var detail: MediaDetail?
    @State private var liked: Bool?
    @State private var likeCount = 0

    var body: some View {
        Group {
            if wide {
                HStack(alignment: .top, spacing: 60) {
                    summary.frame(maxWidth: .infinity, alignment: .leading)
                    if let detail { FileDetails(detail: detail).frame(width: 760) }
                }
            } else {
                VStack(alignment: .leading, spacing: 20) {
                    summary
                    if let detail { FileDetails(detail: detail) }
                }
            }
        }
        .task {
            likeCount = card.likeCount
            guard let client = model.client, let fresh = try? await MediaAPI.detail(client, id: card.id) else { return }
            detail = fresh
            liked = fresh.liked
            likeCount = fresh.likeCount
        }
    }

    private var summary: some View {
        VStack(alignment: .leading, spacing: 20) {
            Text(card.title).font(.title3.bold()).lineLimit(2)
            let meta = [Format.duration(card.durationS), card.categoryPath].compactMap { $0 }
            if !meta.isEmpty {
                Text(meta.joined(separator: "  /  ")).font(.callout).foregroundStyle(.secondary)
            }
            Button {
                Task { await toggleLike() }
            } label: {
                Label("\(likeCount)", systemImage: (liked ?? card.liked) ? "heart.fill" : "heart")
            }
            if let detail, !detail.tags.isEmpty { TagList(tags: detail.tags) }
        }
    }

    private func toggleLike() async {
        guard let client = model.client else { return }
        let now = !(liked ?? card.liked)
        guard let result = try? await MediaAPI.setLiked(client, id: card.id, liked: now) else { return }
        liked = result.liked
        likeCount = result.likeCount
        onLikeChange(result.liked, result.likeCount)
    }
}
