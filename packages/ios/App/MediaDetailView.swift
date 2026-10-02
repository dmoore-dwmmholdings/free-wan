import FreeWANKit
import SwiftUI
import UIKit

/// One item: the player or picture, title, like button, tags and file details.
struct MediaDetailView: View {
    @Environment(AppModel.self) private var model
    let card: MediaCard
    /// The photos around this one, for swiping in the full-screen viewer.
    var photos: [MediaCard] = []
    /// Tells the list the item came from about a like, so its tile agrees.
    var onLikeChange: (Bool, Int) -> Void = { _, _ in }

    @State private var detail: MediaDetail?
    @State private var error: String?
    @State private var liked: Bool
    @State private var likeCount: Int
    @State private var liking = false
    @State private var viewing = false
    @Environment(\.displayScale) private var scale

    init(card: MediaCard, photos: [MediaCard] = [], onLikeChange: @escaping (Bool, Int) -> Void = { _, _ in }) {
        self.card = card
        self.photos = photos
        self.onLikeChange = onLikeChange
        _liked = State(initialValue: card.liked)
        _likeCount = State(initialValue: card.likeCount)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if card.type == .video {
                    PlayerArea(card: card)
                } else {
                    Button { viewing = true } label: {
                        Color.clear
                            .aspectRatio(photoAspect, contentMode: .fit)
                            .overlay { AuthImage(path: photoPath, contentMode: .fit) }
                            .background(.black)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Open \(card.title) full screen")
                }

                VStack(alignment: .leading, spacing: 16) {
                    header
                    if let detail, !detail.tags.isEmpty { TagList(tags: detail.tags) }
                    if let detail { FileDetails(detail: detail) }
                    if let error {
                        Text(error).font(.footnote).foregroundStyle(Theme.danger)
                    }
                }
                .padding(.horizontal, 16)
            }
            .padding(.bottom, 24)
        }
        .background(Theme.background)
        .navigationTitle(card.title)
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .refreshable { await load() }
        .fullScreenCover(isPresented: $viewing) {
            PhotoViewer(photos: photos.contains(where: { $0.id == card.id }) ? photos : [card], current: card.id)
                .environment(model)
        }
    }

    /// The photo's own shape, so a portrait shot is not letterboxed into a wide frame.
    private var photoAspect: CGFloat {
        guard let w = card.width, let h = card.height, w > 0, h > 0 else { return 4 / 3 }
        return max(0.5, CGFloat(w / h))
    }

    /// Sized for the screen width; the viewer loads larger copies as needed.
    private var photoPath: String {
        PhotoSize.path(id: card.id, width: PhotoSize.width(
            points: UIScreen.main.bounds.width, scale: scale, sourceWidth: card.width))
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(card.title)
                .font(.title2.bold())
                .foregroundStyle(Theme.text)
            let meta = [Format.duration(card.durationS), card.categoryPath].compactMap { $0 }
            if !meta.isEmpty {
                Text(meta.joined(separator: "  /  "))
                    .font(.footnote)
                    .foregroundStyle(Theme.muted)
            }
            HStack(spacing: 12) {
                DownloadButton(card: card, ext: detail?.ext)
                likeButton
            }
        }
    }

    private var likeButton: some View {
        Button {
            Task { await toggleLike() }
        } label: {
            HStack(spacing: 6) {
                Image(systemName: liked ? "heart.fill" : "heart")
                    .foregroundStyle(liked ? Theme.primaryStrong : Theme.muted)
                Text("\(likeCount)")
                    .font(.subheadline.weight(.semibold).monospacedDigit())
                    .foregroundStyle(Theme.muted)
            }
            .padding(.horizontal, 14)
            .frame(height: 40)
            .background(liked ? Theme.primaryTint : Theme.surface, in: Capsule())
            .overlay(Capsule().stroke(liked ? Theme.primary : Theme.border))
        }
        .buttonStyle(.plain)
        .disabled(liking)
        .accessibilityLabel(liked ? "Unlike" : "Like")
        .accessibilityValue("\(likeCount) likes")
    }

    private func load() async {
        guard let client = model.client else { return }
        do {
            let fresh = try await MediaAPI.detail(client, id: card.id)
            detail = fresh
            liked = fresh.liked
            likeCount = fresh.likeCount
            error = nil
        } catch {
            let text = ErrorText(error)
            self.error = "\(text.title). \(text.message)"
        }
    }

    /// Shows the change at once and puts it back if the server refuses.
    private func toggleLike() async {
        guard let client = model.client, !liking else { return }
        let (before, beforeCount) = (liked, likeCount)
        liking = true
        liked.toggle()
        likeCount += liked ? 1 : -1
        defer { liking = false }
        do {
            let result = try await MediaAPI.setLiked(client, id: card.id, liked: liked)
            liked = result.liked
            likeCount = result.likeCount
            onLikeChange(result.liked, result.likeCount)
        } catch {
            liked = before
            likeCount = beforeCount
            self.error = "Could not save the like. \(ErrorText(error).title)."
        }
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
