import AVFoundation
import SwiftUI

@main
struct FreeWANApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var model = AppModel()

    init() {
        // Playback audio ignores the silent switch, keeps playing with the screen locked and
        // lets Picture in Picture continue in the background.
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback)
        // Reconnects to transfers that kept running, or finished, while the app was closed.
        _ = DownloadManager.shared
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
        }
    }
}

struct RootView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.scenePhase) private var phase

    var body: some View {
        content
            .tint(Theme.primary)
            .preferredColorScheme(Theme.colorScheme)
            .onOpenURL { model.open($0) }
            // The app switcher's snapshot must not show a private server.
            .overlay {
                if phase != .active && model.account?.isPrivate == true {
                    Theme.background.ignoresSafeArea()
                }
            }
            .onChange(of: phase) { _, phase in
                if phase == .background { model.lockPrivate() }
            }
    }

    @ViewBuilder
    private var content: some View {
        switch model.state {
        case .launching:
            ProgressView()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Theme.background)
                // Waits for the app to be in front: after private servers lock on leaving, a
                // request made while suspended would fail and open the server as unreachable.
                .task(id: phase) { if phase == .active { await model.restore() } }
        case .signedOut:
            LoginView()
        case .locked:
            LockedView()
        case .signedIn(let me) where me.mustChangePassword:
            ChangePasswordView(forced: true)
        case .signedIn(let me):
            MainTabs(me: me)
                // Each server starts on fresh tabs.
                .id(model.account?.id)
        }
    }
}
