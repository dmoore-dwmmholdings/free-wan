import FreeWANKit
import SwiftUI

/// The Browse tab: All / Video / Photos, filters, folders and tags over the library's grid.
struct TVBrowseView: View {
    @Environment(AppModel.self) private var model
    @State private var query = MediaListQuery()
    @State private var trail = CategoryTrail()
    @State private var pager: Pager<MediaCard>?
    @State private var folders: [CategoryNode] = []
    @State private var tags: [Tag] = []
    @State private var playing: MediaCard?
    @State private var viewing: MediaCard?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 30) {
                Text(Theme.siteName).font(.title2.bold())
                filters
                if let pager {
                    TVMediaGrid(pager: pager, autoplay: query.tab == .photos) { card in
                        if card.type == .image || query.tab == .photos { viewing = card } else { playing = card }
                    }
                }
            }
            .padding(.horizontal, 60)
        }
        .overlay { if let pager { LibraryStatus(pager: pager, query: query) } }
        .task(id: query) {
            guard let client = model.client else { return }
            let fresh = MediaAPI.pager(client, query)
            pager = fresh
            await fresh.reload()
        }
        .task(id: "\(query.tab.rawValue)/\(trail.current?.id ?? "")") {
            guard let client = model.client else { return }
            folders = (try? await MediaAPI.categories(client, parent: trail.current?.id, tab: query.tab)) ?? []
        }
        .task {
            guard let client = model.client else { return }
            tags = (try? await MediaAPI.tags(client)) ?? []
        }
        .modifier(Opener(playing: $playing, viewing: $viewing, gallery: galleryItems, onLikeChange: updateLike))
    }

    /// The gallery steps through everything in the Photos tab, otherwise just the photos.
    private var galleryItems: [MediaCard] {
        pager?.items.filter { query.tab == .photos || $0.type == .image } ?? []
    }

    private func updateLike(_ id: String, _ liked: Bool, _ count: Int) {
        pager?.update(id) { $0.liked = liked; $0.likeCount = count }
    }

    private var filters: some View {
        VStack(alignment: .leading, spacing: 24) {
            HStack(spacing: 30) {
                Picker("Library", selection: Binding(get: { query.tab }, set: { tab in
                    // Each tab has its own folders, so leave the current one, as on the web.
                    query.tab = tab
                    trail.exit(to: 0)
                    query.category = nil
                })) {
                    ForEach(LibraryTab.allCases) { Text($0.label).tag($0) }
                }
                .pickerStyle(.segmented)
                .frame(maxWidth: 700)
                toggle(query.liked ? "heart.fill" : "heart", on: query.liked, label: "Liked") { query.liked.toggle() }
                toggle("film", on: query.type == .video, label: "Videos only") {
                    query.type = query.type == .video ? nil : .video
                }
                toggle("photo", on: query.type == .image, label: "Photos only") {
                    query.type = query.type == .image ? nil : .image
                }
                Menu {
                    Picker("Sort by", selection: $query.sort) {
                        ForEach(SortChoice.all) { Text($0.label).tag($0) }
                    }
                } label: {
                    Label(query.sort.label, systemImage: "arrow.up.arrow.down")
                }
            }
            if trail.current != nil || !folders.isEmpty {
                ScrollView(.horizontal) {
                    HStack(spacing: 20) {
                        if let current = trail.current {
                            Button { exit(to: 0) } label: { Label("All", systemImage: "chevron.left") }
                            ForEach(Array(trail.crumbs.dropLast().enumerated()), id: \.element.id) { index, crumb in
                                Button(crumb.name) { exit(to: index + 1) }
                            }
                            Text(current.name).font(.headline).foregroundStyle(Theme.primaryStrong)
                        }
                        ForEach(folders) { folder in
                            Button(folder.itemCount > 0 ? "\(folder.name)  \(folder.itemCount)" : folder.name) {
                                trail.enter(folder)
                                query.category = folder.id
                            }
                        }
                    }
                    .padding(.vertical, 20)
                }
                .scrollClipDisabled()
            }
            if !tags.isEmpty {
                ScrollView(.horizontal) {
                    HStack(spacing: 20) {
                        ForEach(tags) { tag in
                            let on = query.tags.contains(tag.id)
                            Button {
                                if on { query.tags.remove(tag.id) } else { query.tags.insert(tag.id) }
                            } label: {
                                Label(tag.name, systemImage: on ? "checkmark.circle.fill" : "circle")
                            }
                        }
                    }
                    .padding(.vertical, 20)
                }
                .scrollClipDisabled()
            }
        }
        .focusSection()
    }

    private func toggle(_ symbol: String, on: Bool, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol).foregroundStyle(on ? Theme.primaryStrong : .primary)
        }
        .accessibilityLabel(label)
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    private func exit(to depth: Int) {
        trail.exit(to: depth)
        query.category = trail.current?.id
    }
}

/// The library's tiles, loading the next page near the end. A focused video previews a few
/// seconds from across it; with `autoplay` every video on screen loops instead, like a GIF.
struct TVMediaGrid: View {
    @Environment(AppModel.self) private var model
    let pager: Pager<MediaCard>
    var autoplay = false
    let open: (MediaCard) -> Void

    @FocusState private var focused: String?
    /// The tile focused long enough to preview, so scrolling past does not start them all.
    @State private var previewing: String?

    private let columns = [GridItem(.adaptive(minimum: 380), spacing: 48)]

    var body: some View {
        LazyVGrid(columns: columns, spacing: 60) {
            ForEach(pager.items) { item in
                Button { open(item) } label: { TVTile(item: item, playback: playback(item)) }
                    .buttonStyle(.borderless)
                    .focused($focused, equals: item.id)
                    .contextMenu {
                        Button(item.type == .video ? "Play" : "Open") { open(item) }
                        Button(item.liked ? "Unlike" : "Like") { Task { await toggleLike(item) } }
                    }
                    .onAppear {
                        if item.id == pager.items.last?.id { Task { await pager.loadMore() } }
                    }
            }
        }
        .focusSection()
        .task(id: focused) {
            previewing = nil
            guard let focused else { return }
            try? await Task.sleep(for: .milliseconds(800))
            if !Task.isCancelled { previewing = focused }
        }
        if pager.loadingMore { ProgressView().padding(40) }
    }

    private func playback(_ item: MediaCard) -> TilePlayback {
        guard item.type == .video else { return .none }
        if autoplay { return .muted }
        return previewing == item.id ? .snippets : .none
    }

    private func toggleLike(_ item: MediaCard) async {
        guard let client = model.client,
              let result = try? await MediaAPI.setLiked(client, id: item.id, liked: !item.liked) else { return }
        pager.update(item.id) { $0.liked = result.liked; $0.likeCount = result.likeCount }
    }
}

enum TilePlayback {
    case none, muted, snippets
}

/// A poster that lifts when focused, with its duration, its name unless the library hides
/// names, and, when asked, the video playing in place.
struct TVTile: View {
    let item: MediaCard
    var playback = TilePlayback.none

    @Environment(\.isFocused) private var isFocused

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Color.clear
                .aspectRatio(16 / 10, contentMode: .fit)
                .overlay { AuthImage(path: item.posterUrl) }
                .overlay {
                    if playback != .none {
                        TileVideo(card: item, muted: true, snippets: playback == .snippets)
                    }
                }
                .overlay(alignment: .bottomTrailing) {
                    if let duration = Format.duration(item.durationS) {
                        Text(duration)
                            .font(.caption2.monospacedDigit())
                            .foregroundStyle(.white)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 4)
                            .background(.black.opacity(0.72), in: RoundedRectangle(cornerRadius: 8))
                            .padding(12)
                    }
                }
                .overlay(alignment: .topTrailing) {
                    if item.liked {
                        Image(systemName: "heart.fill").foregroundStyle(.white).padding(12).shadow(radius: 4)
                    }
                }
                .clipShape(RoundedRectangle(cornerRadius: 16))
                .hoverEffect(.highlight)
            if LibraryPrefs.shared.showsNames(item.repositoryId) {
                Text(item.title)
                    .font(.callout)
                    .lineLimit(1)
                    .foregroundStyle(isFocused ? .primary : .secondary)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Format.duration(item.durationS).map { "\(item.title), \($0)" } ?? item.title)
    }
}
