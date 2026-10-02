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

    var body: some View {
        content
            .tint(Theme.primary)
            .preferredColorScheme(Theme.colorScheme)
    }

    @ViewBuilder
    private var content: some View {
        switch model.state {
        case .launching:
            ProgressView()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Theme.background)
                .task { await model.restore() }
        case .signedOut:
            LoginView()
        case .signedIn(let me) where me.mustChangePassword:
            ChangePasswordView(forced: true)
        case .signedIn(let me):
            MainTabs(me: me)
        }
    }
}
