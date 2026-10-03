import AVFoundation
import AVKit
import FreeWANKit
import Observation
import SwiftUI

/// The Clips tab: clips cut on the web, each playing its span of the source video.
struct ClipsView: View {
    @Environment(AppModel.self) private var model
    @State private var clips: [Clip] = []
    @State private var loaded = false
    @State private var error: Error?

    var body: some View {
        List(clips) { clip in
            NavigationLink(value: clip) {
                ClipRow(clip: clip)
            }
            .listRowBackground(Theme.background)
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .overlay { status }
        .safeAreaInset(edge: .top) {
            if let error, !clips.isEmpty { ErrorBanner(error: error) { await load() } }
        }
        .refreshable { await load() }
        .task { if !loaded { await load() } }
        .tabTitle("Clips")
        .navigationDestination(for: Clip.self) { ClipPlayerView(clip: $0) }
    }

    @ViewBuilder
    private var status: some View {
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

struct ClipRow: View {
    let clip: Clip

    var body: some View {
        HStack(spacing: 12) {
            Group {
                if let poster = clip.posterUrl {
                    AuthImage(path: poster)
                } else {
                    Theme.surface2.overlay { Image(systemName: "scissors").foregroundStyle(Theme.muted) }
                }
            }
            .frame(width: 96, height: 60)
            .clipShape(RoundedRectangle(cornerRadius: Theme.radiusSmall))

            VStack(alignment: .leading, spacing: 3) {
                Text(clip.name).font(.headline).foregroundStyle(Theme.text)
                Text([Format.duration(clip.durationS) ?? "Under a second", clip.loop ? "Loops" : nil]
                        .compactMap { $0 }.joined(separator: "  /  "))
                    .font(.footnote)
                    .foregroundStyle(Theme.muted)
                if clip.orphaned {
                    Text("Source video is gone").font(.footnote).foregroundStyle(Theme.danger)
                }
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }
}

/// Plays a clip's span of its source, looping or stopping at the out point.
@MainActor
@Observable
final class ClipPlayback {
    let player = AVPlayer()
    private(set) var preview: ClipPreview?
    private(set) var error: String?
    private var observer: Any?

    func start(client: APIClient, clipID: String) async {
        do {
            let preview = try await MediaAPI.clipPreview(client, id: clipID)
            self.preview = preview
            guard preview.playable else { return }
            let asset = AVURLAsset(url: try client.url(preview.sourceUrl),
                                   options: ["AVURLAssetHTTPHeaderFieldsKey": client.authHeaders])
            player.replaceCurrentItem(with: AVPlayerItem(asset: asset))
            _ = await player.seek(to: CMTime(seconds: preview.startS, preferredTimescale: 600),
                              toleranceBefore: .zero, toleranceAfter: .zero)
            observer = player.addPeriodicTimeObserver(
                forInterval: CMTime(seconds: 0.1, preferredTimescale: 600), queue: .main
            ) { [weak self] time in
                Task { @MainActor in self?.tick(time.seconds) }
            }
            player.play()
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func tick(_ time: Double) {
        guard let preview, time.isFinite,
              let command = ClipLoop.command(at: time, startS: preview.startS, endS: preview.endS, loop: preview.loop)
        else { return }
        if command.pause { player.pause() }
        player.seek(to: CMTime(seconds: command.seekTo, preferredTimescale: 600),
                    toleranceBefore: .zero, toleranceAfter: .zero)
    }

    func stop() {
        if let observer { player.removeTimeObserver(observer) }
        observer = nil
        player.pause()
        player.replaceCurrentItem(with: nil)
    }
}

struct ClipPlayerView: View {
    @Environment(AppModel.self) private var model
    let clip: Clip
    @State private var playback = ClipPlayback()

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Color.black
                .aspectRatio(16 / 9, contentMode: .fit)
                .overlay { video }
            VStack(alignment: .leading, spacing: 6) {
                Text(clip.name).font(.title2.bold()).foregroundStyle(Theme.text)
                Text(span).font(.footnote).foregroundStyle(Theme.muted)
            }
            .padding(.horizontal, 16)
            Spacer()
        }
        .background(Theme.background)
        .navigationTitle(clip.name)
        .navigationBarTitleDisplayMode(.inline)
        .task {
            guard let client = model.client else { return }
            await playback.start(client: client, clipID: clip.id)
        }
        .onDisappear { playback.stop() }
    }

    @ViewBuilder
    private var video: some View {
        if let error = playback.error {
            unavailable(error)
        } else if let preview = playback.preview, !preview.playable {
            unavailable("The video this clip was cut from is no longer in the library.")
        } else if playback.preview == nil {
            ProgressView().tint(.white)
        } else {
            PlainPlayerView(player: playback.player)
        }
    }

    private func unavailable(_ message: String) -> some View {
        VStack(spacing: 8) {
            Image(systemName: "exclamationmark.triangle").font(.title2)
            Text("This clip cannot play").font(.headline)
            Text(message).font(.footnote).multilineTextAlignment(.center).opacity(0.8)
        }
        .foregroundStyle(.white)
        .padding(20)
    }

    private var span: String {
        let from = Format.duration(clip.startS) ?? "0:00"
        let to = Format.duration(clip.endS) ?? "0:00"
        return "\(from) to \(to)\(clip.loop ? ", looping" : "")"
    }
}

/// The system player around an AVPlayer, with no extras.
struct PlainPlayerView: UIViewControllerRepresentable {
    let player: AVPlayer

    func makeUIViewController(context: Context) -> AVPlayerViewController {
        let controller = AVPlayerViewController()
        controller.player = player
        return controller
    }

    func updateUIViewController(_ controller: AVPlayerViewController, context: Context) {}
}
