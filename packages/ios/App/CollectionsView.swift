import FreeWANKit
import SwiftUI

/// The Collections tab: the user's collections, read-only, each opening to its items.
struct CollectionsView: View {
    @Environment(AppModel.self) private var model
    @State private var collections: [MediaCollection] = []
    @State private var loaded = false
    @State private var error: Error?

    var body: some View {
        List(collections) { collection in
            NavigationLink(value: collection) {
                CollectionRow(collection: collection)
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
        .navigationTitle("Collections")
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
    }
}

struct CollectionRow: View {
    let collection: MediaCollection

    var body: some View {
        HStack(spacing: 12) {
            Group {
                if let cover = collection.coverUrl {
                    AuthImage(path: cover)
                } else {
                    Theme.surface2.overlay {
                        Image(systemName: "rectangle.stack").foregroundStyle(Theme.muted)
                    }
                }
            }
            .frame(width: 96, height: 60)
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

struct CollectionDetailView: View {
    @Environment(AppModel.self) private var model
    let collection: MediaCollection
    @State private var pager: Pager<MediaCard>?

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
                    MediaGrid(pager: pager)
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
        .navigationDestination(for: MediaCard.self) { card in
            MediaDetailView(card: card, photos: pager?.items.filter { $0.type == .image } ?? []) { liked, count in
                pager?.update(card.id) { $0.liked = liked; $0.likeCount = count }
            }
        }
    }
}
