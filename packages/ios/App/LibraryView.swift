import FreeWANKit
import SwiftUI

/// The Browse tab: the library as a grid, searchable, paged as you scroll.
struct LibraryView: View {
    @Environment(AppModel.self) private var model
    @State private var query = MediaListQuery()
    @State private var trail = CategoryTrail()
    @State private var searchText = ""
    @State private var pager: Pager<MediaCard>?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                LibraryFilters(query: $query, trail: $trail)
                if let pager, let error = pager.error, !pager.items.isEmpty {
                    ErrorBanner(error: error) { await pager.reload() }.padding(.horizontal, -12)
                }
                if let pager { MediaGrid(pager: pager) }
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
        .navigationTitle(Theme.siteName)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                UploadButton { Task { await pager?.reload() } }
            }
        }
        .navigationDestination(for: MediaCard.self) { card in
            MediaDetailView(card: card, photos: pager?.items.filter { $0.type == .image } ?? []) { liked, count in
                pager?.update(card.id) { $0.liked = liked; $0.likeCount = count }
            }
        }
    }

    private func load() async {
        guard let client = model.client else { return }
        let fresh = MediaAPI.pager(client, query)
        pager = fresh
        await fresh.reload()
    }
}

/// Tiles for every loaded item; reaching the last one loads the next page.
struct MediaGrid: View {
    let pager: Pager<MediaCard>

    private let columns = [GridItem(.adaptive(minimum: 150), spacing: 10)]

    var body: some View {
        LazyVGrid(columns: columns, spacing: 14) {
            ForEach(pager.items) { item in
                NavigationLink(value: item) {
                    MediaTile(item: item)
                }
                .buttonStyle(.plain)
                .onAppear {
                    if item.id == pager.items.last?.id {
                        Task { await pager.loadMore() }
                    }
                }
            }
        }
        if pager.loadingMore {
            ProgressView().padding(24)
        }
    }
}

struct MediaTile: View {
    let item: MediaCard

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Color.clear
                .aspectRatio(16 / 10, contentMode: .fit)
                .overlay { AuthImage(path: item.posterUrl) }
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
            Text(item.title)
                .font(.footnote.weight(.semibold))
                .foregroundStyle(Theme.text)
                .lineLimit(2)
                .multilineTextAlignment(.leading)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Format.duration(item.durationS).map { "\(item.title), \($0)" } ?? item.title)
        .accessibilityAddTraits(.isLink)
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
