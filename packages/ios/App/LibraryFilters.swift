import FreeWANKit
import SwiftUI

/// Filter toggles, sort menu, folder chips and tag chips above the library grid.
struct LibraryFilters: View {
    @Environment(AppModel.self) private var model
    @Binding var query: MediaListQuery
    @Binding var trail: CategoryTrail

    @State private var folders: [CategoryNode] = []
    @State private var tags: [Tag] = []

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Picker("Library", selection: Binding(get: { query.tab }, set: { tab in
                // Each tab has its own folders, so leave the current one, as on the web.
                query.tab = tab
                exit(to: 0)
            })) {
                ForEach(LibraryTab.allCases) { tab in
                    Text(tab.label).tag(tab)
                }
            }
            .pickerStyle(.segmented)
            HStack(spacing: 8) {
                toggle(on: query.liked, symbol: query.liked ? "heart.fill" : "heart",
                       label: query.liked ? "Show all media" : "Show only liked media") {
                    query.liked.toggle()
                }
                toggle(on: query.type == .video, symbol: "film",
                       label: query.type == .video ? "Show all media types" : "Show only videos") {
                    query.type = query.type == .video ? nil : .video
                }
                toggle(on: query.type == .image, symbol: "photo",
                       label: query.type == .image ? "Show all media types" : "Show only photos") {
                    query.type = query.type == .image ? nil : .image
                }
                Spacer()
                sortMenu
            }
            folderChips
            tagChips
        }
        .task(id: "\(query.tab.rawValue)/\(trail.current?.id ?? "")") {
            guard let client = model.client else { return }
            folders = (try? await MediaAPI.categories(client, parent: trail.current?.id, tab: query.tab)) ?? []
        }
        .task {
            guard let client = model.client else { return }
            tags = (try? await MediaAPI.tags(client)) ?? []
        }
    }

    private func toggle(on: Bool, symbol: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.body)
                // The raw primary is too faint on its own tint; primaryStrong is what the web uses.
                .foregroundStyle(on ? Theme.primaryStrong : Theme.muted)
                .frame(width: 44, height: 36)
                .background(on ? Theme.primaryTint : Theme.surface, in: Capsule())
                .overlay(Capsule().stroke(on ? Theme.primary : Theme.border))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    private var sortMenu: some View {
        Menu {
            Picker("Sort by", selection: $query.sort) {
                ForEach(SortChoice.all) { choice in
                    Text(choice.label).tag(choice)
                }
            }
        } label: {
            Label(query.sort.label, systemImage: "arrow.up.arrow.down")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Theme.text)
                .padding(.horizontal, 12)
                .frame(height: 36)
                .background(Theme.surface, in: Capsule())
                .overlay(Capsule().stroke(Theme.border))
        }
        .accessibilityLabel("Sort by, currently \(query.sort.label)")
    }

    @ViewBuilder
    private var folderChips: some View {
        if !trail.crumbs.isEmpty || !folders.isEmpty {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    if let current = trail.current {
                        chip("All", symbol: "chevron.left", muted: true) { exit(to: 0) }
                        ForEach(Array(trail.crumbs.dropLast().enumerated()), id: \.element.id) { index, crumb in
                            chip(crumb.name, muted: true) { exit(to: index + 1) }
                        }
                        Text(current.name)
                            .font(.footnote.weight(.bold))
                            .foregroundStyle(Theme.primaryStrong)
                            .padding(.horizontal, 6)
                            .accessibilityAddTraits(.isHeader)
                    }
                    ForEach(folders) { folder in
                        chip(folder.itemCount > 0 ? "\(folder.name)  \(folder.itemCount)" : folder.name) {
                            trail.enter(folder)
                            query.category = folder.id
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var tagChips: some View {
        if !tags.isEmpty {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(tags) { tag in
                        let on = query.tags.contains(tag.id)
                        Button {
                            if on { query.tags.remove(tag.id) } else { query.tags.insert(tag.id) }
                        } label: {
                            HStack(spacing: 6) {
                                Circle()
                                    .fill(tag.color.flatMap(RGBA.init(hex:)).map { Color($0) } ?? Theme.primary)
                                    .frame(width: 8, height: 8)
                                Text(tag.name)
                                    .font(.footnote.weight(.semibold))
                                    .foregroundStyle(on ? Theme.text : Theme.muted)
                            }
                            .padding(.horizontal, 12)
                            .frame(height: 32)
                            .background(on ? Theme.primaryTint : Theme.surface, in: Capsule())
                            .overlay(Capsule().stroke(on ? Theme.primary : Theme.border))
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("\(on ? "Remove" : "Add") tag filter \(tag.name)")
                        .accessibilityAddTraits(on ? .isSelected : [])
                    }
                }
            }
        }
    }

    private func chip(_ label: String, symbol: String? = nil, muted: Bool = false,
                      action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 4) {
                if let symbol { Image(systemName: symbol).font(.caption.weight(.bold)) }
                Text(label).font(.footnote.weight(.semibold))
            }
            .foregroundStyle(muted ? Theme.muted : Theme.text)
            .padding(.horizontal, 12)
            .frame(height: 32)
            .background(Theme.surface, in: Capsule())
            .overlay(Capsule().stroke(Theme.border))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }

    private func exit(to depth: Int) {
        trail.exit(to: depth)
        query.category = trail.current?.id
    }
}
