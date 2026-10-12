import AVFoundation
import FreeWANKit
import SwiftUI

@main
struct FreeWANTVApp: App {
    @State private var model = AppModel()

    init() {
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback)
        // Posters and photos are sent as cacheable; the default disk cache keeps only a few.
        URLCache.shared = URLCache(memoryCapacity: 64 * 1024 * 1024, diskCapacity: 512 * 1024 * 1024)
    }

    var body: some Scene {
        WindowGroup {
            TVRootView()
                .environment(model)
        }
    }
}

struct TVRootView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.scenePhase) private var phase

    var body: some View {
        // No app-wide tint: tvOS draws a tinted button's label in the tint too, on a platter of
        // the same colour, which hides it. Focus and selection look right in the system style.
        content
            .preferredColorScheme(Theme.colorScheme)
            .onChange(of: phase) { _, phase in
                if phase == .background { model.lockPrivate() }
            }
            .sheet(item: Binding(get: { PrivacyLock.shared.prompt }, set: { if $0 == nil { PrivacyLock.shared.answer(nil) } })) {
                PINEntry(prompt: $0)
            }
    }

    @ViewBuilder
    private var content: some View {
        switch model.state {
        case .launching:
            ProgressView()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Theme.background)
                .task(id: phase) { if phase == .active { await model.restore() } }
        case .signedOut:
            TVLoginView()
        case .locked:
            TVLockedView()
        case .signedIn(let me) where me.mustChangePassword:
            TVChangePasswordView(forced: true)
        case .signedIn(let me):
            TVMainTabs(me: me)
                // Each server starts on fresh tabs.
                .id(model.account?.id)
        }
    }
}
