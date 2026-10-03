import AVFoundation
import FreeWANKit
import SwiftUI

/// The Browse tab: the library as a grid, searchable, paged as you scroll.
struct LibraryView: View {
    @Environment(AppModel.self) private var model
    @State private var query = MediaListQuery()
    @State private var trail = CategoryTrail()
    @State private var searchText = ""
    @State private var pager: Pager<MediaCard>?
    /// The item open in the full-screen gallery.
    @State private var opened: MediaCard?
    /// The video whose page is pushed from its tile.
    @State private var pushed: MediaCard?
    @State private var uploader = Uploader()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                LibraryFilters(query: $query, trail: $trail)
                if let pager, let error = pager.error, !pager.items.isEmpty {
                    ErrorBanner(error: error) { await pager.reload() }.padding(.horizontal, -12)
                }
                if let pager {
                    MediaGrid(pager: pager, autoplay: query.tab == .photos) { card in
                        // Photos open in the gallery; in the Photos tab videos do too, playing like
                        // GIFs, as on the web. Elsewhere a video gets its own page.
                        if card.type == .image || query.tab == .photos { opened = card } else { pushed = card }
                    }
                }
            }
            .padding(12)
        }
        .overlay { if let pager { LibraryStatus(pager: pager, query: query) } }
        .refreshable { await pager?.reload() }
        .searchable(text: $searchText, prompt: "Search your library")
        .onSubmit(of: .search) { query.search = searchText }
        .onChange(of: searchText) { _, text in
            if text.trimmingCharacters(in: .whitespaces).isEmpty { query.search = "" }
        }
        .task(id: query) { await load() }
        .tabTitle(Theme.siteName)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                UploadButton(uploader: uploader)
            }
        }
        .navigationDestination(for: MediaCard.self) { card in
            MediaDetailView(card: card, photos: pager?.items.filter { $0.type == .image } ?? []) { liked, count in
                pager?.update(card.id) { $0.liked = liked; $0.likeCount = count }
            }
        }
        .navigationDestination(item: $pushed) { card in
            MediaDetailView(card: card) { liked, count in updateLike(card.id, liked, count) }
        }
        .uploadFlow(uploader) { Task { await refreshAfterUpload() } }
        .fullScreenCover(item: $opened) { card in
            PhotoViewer(items: galleryItems ?? [card], current: card.id, onLikeChange: updateLike)
                .environment(model)
        }
    }

    /// What the gallery steps through: everything in the Photos tab, otherwise just the photos.
    private var galleryItems: [MediaCard]? {
        pager?.items.filter { query.tab == .photos || $0.type == .image }
    }

    /// The server indexes uploads a moment after they arrive, so look again a few times until
    /// the library's count changes.
    private func refreshAfterUpload() async {
        let before = pager?.total
        for wait in [1, 2, 4, 8] {
            try? await Task.sleep(for: .seconds(wait))
            await pager?.reload()
            if pager?.total != before { return }
        }
    }

    private func updateLike(_ id: String, _ liked: Bool, _ count: Int) {
        pager?.update(id) { $0.liked = liked; $0.likeCount = count }
    }

    private func load() async {
        guard let client = model.client else { return }
        let fresh = MediaAPI.pager(client, query)
        pager = fresh
        await fresh.reload()
    }
}

/// Tiles for every loaded item; reaching the last one loads the next page. A long press on a
/// video plays it in its tile with sound until another is long-pressed or it scrolls away.
struct MediaGrid: View {
    let pager: Pager<MediaCard>
    /// Videos play silently in their tiles while on screen, like GIFs in a photo library.
    var autoplay = false
    let open: (MediaCard) -> Void

    @State private var playing: String?

    private let columns = [GridItem(.adaptive(minimum: 150), spacing: 10)]

    var body: some View {
        LazyVGrid(columns: columns, spacing: 14) {
            ForEach(pager.items) { item in
                MediaTile(item: item, playback: playback(item))
                    .contentShape(Rectangle())
                    .onTapGesture { open(item) }
                    .onLongPressGesture(minimumDuration: 0.35) { if item.type == .video { playing = item.id } }
                    .accessibilityAddTraits(.isButton)
                    .accessibilityAction(named: "Play in place") { if item.type == .video { playing = item.id } }
                    .onAppear {
                        if item.id == pager.items.last?.id {
                            Task { await pager.loadMore() }
                        }
                    }
                    .onDisappear { if playing == item.id { playing = nil } }
            }
        }
        .sensoryFeedback(.impact, trigger: playing) { _, new in new != nil }
        if pager.loadingMore {
            ProgressView().padding(24)
        }
    }

    private func playback(_ item: MediaCard) -> TilePlayback {
        guard item.type == .video else { return .none }
        if playing == item.id { return .sound }
        return autoplay ? .muted : .none
    }
}

enum TilePlayback {
    case none, muted, sound
}

struct MediaTile: View {
    let item: MediaCard
    var playback = TilePlayback.none

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Color.clear
                .aspectRatio(16 / 10, contentMode: .fit)
                .overlay { AuthImage(path: item.posterUrl) }
                .overlay {
                    // While another video plays in Picture in Picture, tiles stay quiet.
                    if playback != .none {
                        TileVideo(card: item, muted: playback == .muted || PlaybackCenter.shared.pipActive,
                                  snippets: playback == .sound)
                    }
                }
                .overlay(alignment: .bottomTrailing) {
                    if let duration = Format.duration(item.durationS) {
                        Text(duration)
                            .font(.caption2.monospacedDigit())
                            .foregroundStyle(.white)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(.black.opacity(0.72), in: RoundedRectangle(cornerRadius: 5))
                            .padding(6)
                    }
                }
                .clipShape(RoundedRectangle(cornerRadius: Theme.radiusSmall))
                // A filled poster overflows its frame; clipping hides that but still takes
                // taps there, which stole them from the filter buttons above the grid.
                .contentShape(RoundedRectangle(cornerRadius: Theme.radiusSmall))
            if LibraryPrefs.shared.showsNames(item.repositoryId) {
                Text(item.title)
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(Theme.text)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Format.duration(item.durationS).map { "\(item.title), \($0)" } ?? item.title)
        .accessibilityAddTraits(.isLink)
    }
}

/// A video playing on a loop inside its tile, filling it as the poster does. With `snippets` it
/// plays a few seconds from each of several points across the video, to tell what it is.
struct TileVideo: View {
    @Environment(AppModel.self) private var model
    let card: MediaCard
    let muted: Bool
    var snippets = false

    @State private var player: AVPlayer?

    var body: some View {
        ZStack {
            if let player { PlayerLayerView(player: player, gravity: .resizeAspectFill) }
        }
        .allowsHitTesting(false)
        .task(id: snippets) {
            player?.pause()
            guard let client = model.client, let asset = await playableAsset(card, client: client),
                  !Task.isCancelled else { return }
            let item = AVPlayerItem(asset: asset)
            // A tile needs a few seconds ahead, not the deep buffer a full-screen player keeps.
            item.preferredForwardBufferDuration = 4
            let tile = AVPlayer(playerItem: item)
            tile.isMuted = muted
            tile.automaticallyWaitsToMinimizeStalling = false
            tile.play()
            player = tile
            let starts = snippets ? PreviewSnippets.starts(duration: card.durationS) : [0]
            if starts.count > 1 {
                var piece = 0
                while !Task.isCancelled {
                    try? await Task.sleep(for: .milliseconds(250))
                    if tile.currentTime().seconds >= starts[piece] + PreviewSnippets.length {
                        piece = (piece + 1) % starts.count
                        await tile.seek(to: CMTime(seconds: starts[piece], preferredTimescale: 600))
                    }
                }
            } else {
                for await _ in NotificationCenter.default.notifications(named: AVPlayerItem.didPlayToEndTimeNotification, object: item) {
                    await tile.seek(to: .zero)
                    tile.play()
                }
            }
        }
        .onChange(of: muted) { _, muted in player?.isMuted = muted }
        .onDisappear {
            player?.pause()
            player = nil
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
