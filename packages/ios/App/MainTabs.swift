import FreeWANKit
import SwiftUI

enum AppTab: Hashable {
    case library, collections, clips, downloads, settings
}

struct MainTabs: View {
    let me: Me
    @State private var tab: AppTab = .library

    var body: some View {
        TabView(selection: $tab) {
            screen(LibraryView())
                .tabItem { Label("Browse", systemImage: "square.grid.2x2") }
                .tag(AppTab.library)
            screen(CollectionsView())
                .tabItem { Label("Collections", systemImage: "rectangle.stack") }
                .tag(AppTab.collections)
            screen(ClipsView())
                .tabItem { Label("Clips", systemImage: "scissors") }
                .tag(AppTab.clips)
            screen(DownloadsView())
                .tabItem { Label("Downloads", systemImage: "arrow.down.circle") }
                .tag(AppTab.downloads)
            screen(SettingsView(me: me))
                .tabItem { Label("Settings", systemImage: "gearshape") }
                .tag(AppTab.settings)
        }
        // The raw primary is too faint for the 10pt tab label on the default preset.
        .tint(Theme.primaryStrong)
    }

    private func screen(_ content: some View) -> some View {
        NavigationStack {
            content
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Theme.background)
                .toolbarBackground(Theme.background, for: .navigationBar)
        }
        .toolbarBackground(Theme.surface, for: .tabBar)
        .toolbarBackground(.visible, for: .tabBar)
    }
}

/// Stand-in for a tab whose screen has not been built yet (PLAN.md).
struct ComingSoon: View {
    let title: String
    let symbol: String

    var body: some View {
        ContentUnavailableView(title, systemImage: symbol, description: Text("Not built yet."))
            .foregroundStyle(Theme.muted)
            .navigationTitle(title)
    }
}

struct DownloadsView: View {
    var body: some View { ComingSoon(title: "Downloads", symbol: "arrow.down.circle") }
}
