import AVKit
import FreeWANKit
import SwiftUI

/// The Search tab: the whole library by words in titles and tags.
struct TVSearchView: View {
    @Environment(AppModel.self) private var model
    @State private var text = ""
    @State private var pager: Pager<MediaCard>?
    @State private var playing: MediaCard?
    @State private var viewing: MediaCard?

    var body: some View {
        ScrollView {
            if let pager, !text.isEmpty {
                TVMediaGrid(pager: pager) { card in
                    if card.type == .image { viewing = card } else { playing = card }
                }
                .padding(.horizontal, 60)
            }
        }
        .searchable(text: $text, prompt: "Search your library")
        .task(id: text) {
            // Waits for a pause in typing before asking the server.
            try? await Task.sleep(for: .milliseconds(400))
            guard !Task.isCancelled, let client = model.client else { return }
            let trimmed = text.trimmingCharacters(in: .whitespaces)
            guard !trimmed.isEmpty else { pager = nil; return }
            var query = MediaListQuery()
            query.search = trimmed
            let fresh = MediaAPI.pager(client, query)
            pager = fresh
            await fresh.reload()
        }
        .modifier(Opener(playing: $playing, viewing: $viewing,
                         gallery: pager?.items.filter { $0.type == .image } ?? [],
                         onLikeChange: { id, liked, count in pager?.update(id) { $0.liked = liked; $0.likeCount = count } }))
    }
}

/// The Collections tab: each collection's cover, opening to its items.
struct TVCollectionsView: View {
    @Environment(AppModel.self) private var model
    @State private var collections: [MediaCollection] = []
    @State private var posters: [String: [String]] = [:]
    @State private var loaded = false
    @State private var error: Error?

    private let columns = [GridItem(.adaptive(minimum: 420), spacing: 48)]

    var body: some View {
        ScrollView {
            LazyVGrid(columns: columns, spacing: 60) {
                ForEach(collections) { collection in
                    NavigationLink(value: collection) {
                        VStack(alignment: .leading, spacing: 14) {
                            CollectionCover(collection: collection, posters: posters[collection.id] ?? [])
                                .aspectRatio(16 / 10, contentMode: .fit)
                                .clipShape(RoundedRectangle(cornerRadius: 16))
                                .hoverEffect(.highlight)
                            Text(collection.name).font(.callout).lineLimit(1)
                            Text(Format.count(collection.itemCount, "item")).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    .buttonStyle(.borderless)
                }
            }
            .padding(.horizontal, 60)
        }
        .overlay {
            if collections.isEmpty {
                if let error {
                    ErrorStateView(error: error) { await load() }
                } else if loaded {
                    ContentUnavailableView("No collections", systemImage: "rectangle.stack",
                                           description: Text("Make collections on the web app; they show up here."))
                } else {
                    ProgressView()
                }
            }
        }
        .task { if !loaded { await load() } }
        .navigationDestination(for: MediaCollection.self) { TVCollectionDetail(collection: $0) }
    }

    private func load() async {
        guard let client = model.client else { return }
        do {
            collections = try await MediaAPI.collections(client)
            error = nil
        } catch {
            self.error = error
        }
        loaded = true
        await withTaskGroup(of: (String, [String]?).self) { group in
            for collection in collections where collection.itemCount > 0 {
                group.addTask { (collection.id, try? await MediaAPI.collectionPosters(client, id: collection.id)) }
            }
            for await (id, found) in group {
                if let found { posters[id] = found }
            }
        }
    }
}

struct TVCollectionDetail: View {
    @Environment(AppModel.self) private var model
    let collection: MediaCollection
    @State private var pager: Pager<MediaCard>?
    @State private var playing: MediaCard?
    @State private var viewing: MediaCard?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 30) {
                Text(collection.name).font(.title2.bold())
                if let description = collection.description, !description.isEmpty {
                    Text(description).foregroundStyle(.secondary)
                }
                if let pager {
                    TVMediaGrid(pager: pager) { card in
                        if card.type == .image { viewing = card } else { playing = card }
                    }
                }
            }
            .padding(.horizontal, 60)
        }
        .task {
            guard pager == nil, let client = model.client else { return }
            let fresh = MediaAPI.pager(client, MediaAPI.collectionQuery(collection.id))
            pager = fresh
            await fresh.reload()
        }
        .modifier(Opener(playing: $playing, viewing: $viewing,
                         gallery: pager?.items.filter { $0.type == .image } ?? [],
                         onLikeChange: { id, liked, count in pager?.update(id) { $0.liked = liked; $0.likeCount = count } }))
    }
}

/// The Clips tab: clips cut on the web, each playing its span of the source.
struct TVClipsView: View {
    @Environment(AppModel.self) private var model
    @State private var clips: [Clip] = []
    @State private var loaded = false
    @State private var error: Error?
    @State private var playing: Clip?

    var body: some View {
        List(clips) { clip in
            Button { playing = clip } label: {
                HStack(spacing: 30) {
                    Group {
                        if let poster = clip.posterUrl {
                            AuthImage(path: poster)
                        } else {
                            Theme.surface2.overlay { Image(systemName: "scissors").foregroundStyle(.secondary) }
                        }
                    }
                    .frame(width: 240, height: 135)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    VStack(alignment: .leading, spacing: 6) {
                        Text(clip.name)
                        Text([Format.duration(clip.durationS) ?? "Under a second", clip.loop ? "Loops" : nil]
                                .compactMap { $0 }.joined(separator: "  /  "))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        if clip.orphaned {
                            Text("Source video is gone").font(.caption).foregroundStyle(Theme.danger)
                        }
                    }
                }
            }
        }
        .overlay {
            if clips.isEmpty {
                if let error {
                    ErrorStateView(error: error) { await load() }
                } else if loaded {
                    ContentUnavailableView("No clips", systemImage: "scissors",
                                           description: Text("Cut clips on the web app; they show up here."))
                } else {
                    ProgressView()
                }
            }
        }
        .task { if !loaded { await load() } }
        .fullScreenCover(item: $playing) { TVClipPlayer(clip: $0).environment(model) }
    }

    private func load() async {
        guard let client = model.client else { return }
        do {
            clips = try await MediaAPI.clips(client)
            error = nil
        } catch {
            self.error = error
        }
        loaded = true
    }
}

/// A clip's span of its source in the system player, looping or stopping at its end.
struct TVClipPlayer: View {
    @Environment(AppModel.self) private var model
    let clip: Clip
    @State private var playback = ClipPlayback()

    var body: some View {
        ClipController(player: playback.player)
            .ignoresSafeArea()
            .task {
                guard playback.player.currentItem == nil, let client = model.client else { return }
                await playback.start(client: client, clipID: clip.id)
            }
            .onDisappear { playback.stop() }
    }
}

private struct ClipController: UIViewControllerRepresentable {
    let player: AVPlayer

    func makeUIViewController(context: Context) -> AVPlayerViewController {
        let controller = AVPlayerViewController()
        controller.player = player
        return controller
    }

    func updateUIViewController(_ controller: AVPlayerViewController, context: Context) {}
}
