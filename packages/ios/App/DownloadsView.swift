import AVFoundation
import FreeWANKit
import SwiftUI
import UIKit

/// The Downloads tab: transfers in progress or failed, then everything kept on the phone.
struct DownloadsView: View {
    private var downloads: DownloadManager { DownloadManager.shared }

    var body: some View {
        List {
            let pending = downloads.visibleJobs.sorted { $0.title < $1.title }
            if !pending.isEmpty {
                Section("In progress") {
                    ForEach(pending, id: \.id) { job in
                        PendingRow(job: job, state: downloads.state(job.id))
                    }
                }
                .listRowBackground(Theme.surface)
            }

            let records = downloads.visible
            if !records.isEmpty {
                Section {
                    ForEach(records) { record in
                        NavigationLink(value: record.id) {
                            DownloadedRow(record: record)
                        }
                    }
                    .onDelete { offsets in
                        for offset in offsets { downloads.remove(records[offset].id) }
                    }
                } header: {
                    Text("On this phone, \(Format.bytes(Double(downloads.visibleBytes)))")
                }
                .listRowBackground(Theme.surface)
            }
        }
        .scrollContentBackground(.hidden)
        .overlay {
            if downloads.visibleJobs.isEmpty && downloads.visible.isEmpty {
                ContentUnavailableView("No downloads", systemImage: "arrow.down.circle",
                                       description: Text("Download anything from its page to watch it without a connection."))
            }
        }
        .tabTitle("Downloads")
        .navigationDestination(for: String.self) { id in
            if let record = downloads.index[id] { OfflineItemView(record: record) }
        }
    }
}

struct PendingRow: View {
    let job: DownloadJob
    let state: DownloadState
    private var downloads: DownloadManager { DownloadManager.shared }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(job.title).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.text).lineLimit(1)
            switch state {
            case .downloading(let progress):
                HStack {
                    ProgressView(value: progress)
                    Text(progress > 0 ? "\(Int(progress * 100))%" : "Starting")
                        .font(.caption.monospacedDigit()).foregroundStyle(Theme.muted)
                    Button { downloads.cancel(job.id) } label: {
                        Image(systemName: "xmark.circle.fill").foregroundStyle(Theme.muted)
                    }
                    .buttonStyle(.borderless)
                    .accessibilityLabel("Stop downloading \(job.title)")
                }
            case .failed(let message):
                Text(message).font(.footnote).foregroundStyle(Theme.danger).lineLimit(2)
                HStack {
                    Button("Try again") { downloads.retry(job.id) }
                    Spacer()
                    Button("Dismiss") { downloads.dismissFailure(job.id) }
                        .foregroundStyle(Theme.muted)
                }
                .buttonStyle(.borderless)
                .font(.footnote.weight(.semibold))
            default:
                EmptyView()
            }
        }
        .padding(.vertical, 4)
    }
}

struct DownloadedRow: View {
    let record: DownloadRecord

    var body: some View {
        HStack(spacing: 12) {
            LocalImage(url: DownloadManager.shared.posterURL(record))
                .frame(width: 80, height: 50)
                .clipShape(RoundedRectangle(cornerRadius: Theme.radiusSmall))
            VStack(alignment: .leading, spacing: 3) {
                Text(record.title).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.text).lineLimit(2)
                Text([Format.duration(record.durationS), Format.bytes(Double(record.bytes))]
                        .compactMap { $0 }.joined(separator: "  /  "))
                    .font(.caption).foregroundStyle(Theme.muted)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityHint("Swipe left to delete")
    }
}

/// An image from a file on the phone.
struct LocalImage: View {
    let url: URL?
    @State private var image: UIImage?

    var body: some View {
        ZStack {
            Theme.surface2
            if let image {
                Image(uiImage: image).resizable().aspectRatio(contentMode: .fill)
            }
        }
        .task(id: url) {
            guard let url else { return }
            image = await Task.detached { UIImage(contentsOfFile: url.path)?.preparingForDisplay() }.value
        }
    }
}

/// A downloaded item, played or shown from the phone with no server needed.
struct OfflineItemView: View {
    let record: DownloadRecord
    @State private var player: AVPlayer?
    @State private var image: UIImage?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Group {
                if record.type == .video {
                    if let player { PlainPlayerView(player: player) } else { Color.black }
                } else if let image {
                    ZoomableImage(image: image)
                } else {
                    Color.black
                }
            }
            .aspectRatio(record.type == .video ? 16 / 9 : nil, contentMode: .fit)
            .frame(maxHeight: record.type == .video ? nil : .infinity)

            VStack(alignment: .leading, spacing: 4) {
                Text(record.title).font(.title3.bold()).foregroundStyle(Theme.text)
                Text("Playing the copy on this phone. No connection to your server is needed.")
                    .font(.footnote).foregroundStyle(Theme.muted)
            }
            .padding(.horizontal, 16)
            if record.type == .video { Spacer() }
        }
        .background(Theme.background)
        .navigationTitle(record.title)
        .navigationBarTitleDisplayMode(.inline)
        .task {
            let url = DownloadManager.shared.fileURL(record)
            if record.type == .video {
                let p = AVPlayer(url: url)
                player = p
                p.play()
            } else {
                image = await Task.detached { UIImage(contentsOfFile: url.path) }.value
            }
        }
        .onDisappear { player?.pause() }
    }
}

/// Download, progress, failure and done states for one item, on its detail screen.
struct DownloadButton: View {
    let card: MediaCard
    let ext: String?
    private var downloads: DownloadManager { DownloadManager.shared }

    var body: some View {
        let state = downloads.state(card.id)
        Group {
            switch state {
            case .none:
                Button { start() } label: {
                    Label("Download", systemImage: "arrow.down.circle").frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
            case .downloading(let progress):
                HStack {
                    ProgressView(value: progress)
                    Text(progress > 0 ? "\(Int(progress * 100))%" : "Starting")
                        .font(.caption.monospacedDigit()).foregroundStyle(Theme.muted)
                    Button("Stop") { downloads.cancel(card.id) }
                        .font(.footnote.weight(.bold))
                        .foregroundStyle(Theme.muted)
                }
            case .failed(let message):
                Button { downloads.retry(card.id) } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Download failed. Tap to try again.").font(.subheadline.weight(.bold))
                        Text(message).font(.caption).lineLimit(2)
                    }
                    .foregroundStyle(Theme.danger)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .buttonStyle(.plain)
            case .done(let record):
                Label("On this phone, \(Format.bytes(Double(record.bytes)))", systemImage: "checkmark.circle.fill")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Theme.text)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .frame(minHeight: 40)
    }

    private func start() {
        downloads.start(DownloadJob(id: card.id, title: card.title, type: card.type,
                                    durationS: card.durationS, ext: ext))
    }
}
