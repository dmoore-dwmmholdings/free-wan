import SwiftUI

@main
struct FreeWANApp: App {
    @State private var model = AppModel()

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
