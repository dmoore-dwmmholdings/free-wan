import FreeWANKit
import SwiftUI

/// The Collections tab: the user's collections, read-only, each opening to its items.
struct CollectionsView: View {
    @Environment(AppModel.self) private var model
    @State private var collections: [MediaCollection] = []
    /// Each collection's first few posters, by collection id, for its cover.
    @State private var posters: [String: [String]] = [:]
    @State private var loaded = false
    @State private var error: Error?

    var body: some View {
        List(collections) { collection in
            NavigationLink(value: collection) {
                CollectionRow(collection: collection, posters: posters[collection.id] ?? [])
            }
            .listRowBackground(Theme.background)
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .overlay { status }
        .safeAreaInset(edge: .top) {
            if let error, !collections.isEmpty { ErrorBanner(error: error) { await load() } }
        }
        .refreshable { await load() }
        .task { if !loaded { await load() } }
        .tabTitle("Collections")
        .navigationDestination(for: MediaCollection.self) { CollectionDetailView(collection: $0) }
    }

    @ViewBuilder
    private var status: some View {
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

    private func load() async {
        guard let client = model.client else { return }
        do {
            collections = try await MediaAPI.collections(client)
            error = nil
        } catch {
            self.error = error
        }
        loaded = true
        await loadPosters(client)
    }

    /// One small request per collection, all at once; a failure leaves that cover plain.
    private func loadPosters(_ client: APIClient) async {
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

struct CollectionRow: View {
    let collection: MediaCollection
    var posters: [String] = []

    var body: some View {
        HStack(spacing: 12) {
            CollectionCover(collection: collection, posters: posters)
                .frame(width: 112, height: 70)
                .clipShape(RoundedRectangle(cornerRadius: Theme.radiusSmall))

            VStack(alignment: .leading, spacing: 3) {
                Text(collection.name)
                    .font(.headline)
                    .foregroundStyle(Theme.text)
                Text(Format.count(collection.itemCount, "item"))
                    .font(.footnote)
                    .foregroundStyle(Theme.muted)
                if let description = collection.description, !description.isEmpty {
                    Text(description)
                        .font(.footnote)
                        .foregroundStyle(Theme.muted)
                        .lineLimit(2)
                }
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
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

struct CollectionDetailView: View {
    @Environment(AppModel.self) private var model
    let collection: MediaCollection
    @State private var pager: Pager<MediaCard>?
    @State private var pushed: MediaCard?

    var body: some View {
        ScrollView {
            if let pager {
                VStack(alignment: .leading, spacing: 14) {
                    if let description = collection.description, !description.isEmpty {
                        Text(description).font(.subheadline).foregroundStyle(Theme.muted)
                    }
                    if let error = pager.error, !pager.items.isEmpty {
                        ErrorBanner(error: error) { await pager.reload() }.padding(.horizontal, -12)
                    }
                    MediaGrid(pager: pager) { pushed = $0 }
                }
                .padding(12)
            }
        }
        .overlay {
            if let pager, pager.items.isEmpty {
                if let error = pager.error {
                    ErrorStateView(error: error) { await pager.reload() }
                } else if pager.loaded {
                    ContentUnavailableView("This collection is empty", systemImage: "rectangle.stack")
                } else {
                    ProgressView()
                }
            }
        }
        .refreshable { await pager?.reload() }
        .task {
            guard pager == nil, let client = model.client else { return }
            let fresh = MediaAPI.pager(client, MediaAPI.collectionQuery(collection.id))
            pager = fresh
            await fresh.reload()
        }
        .background(Theme.background)
        .navigationTitle(collection.name)
        .navigationDestination(item: $pushed) { card in
            MediaDetailView(card: card, photos: pager?.items.filter { $0.type == .image } ?? []) { liked, count in
                pager?.update(card.id) { $0.liked = liked; $0.likeCount = count }
            }
        }
    }
}
