import FreeWANKit
import SwiftUI

enum AppTab: Hashable {
    case library, collections, clips, downloads, settings
}

struct MainTabs: View {
    @Environment(AppModel.self) private var model
    let me: Me
    @State private var tab: AppTab = .library
    @State private var libraryPath = NavigationPath()
    @State private var collectionsPath = NavigationPath()
    @State private var clipsPath = NavigationPath()
    @State private var linkProblem: String?

    var body: some View {
        TabView(selection: $tab) {
            screen(LibraryView(), path: $libraryPath)
                .tabItem { Label("Browse", systemImage: "square.grid.2x2") }
                .tag(AppTab.library)
            screen(CollectionsView(), path: $collectionsPath)
                .tabItem { Label("Collections", systemImage: "rectangle.stack") }
                .tag(AppTab.collections)
            screen(ClipsView(), path: $clipsPath)
                .tabItem { Label("Clips", systemImage: "scissors") }
                .tag(AppTab.clips)
            screen(DownloadsView(), path: .constant(NavigationPath()))
                .tabItem { Label("Downloads", systemImage: "arrow.down.circle") }
                .tag(AppTab.downloads)
            screen(SettingsView(me: me), path: .constant(NavigationPath()))
                .tabItem { Label("Settings", systemImage: "gearshape") }
                .tag(AppTab.settings)
        }
        // The raw primary is too faint for the 10pt tab label on the default preset.
        .tint(Theme.primaryStrong)
        .background(alignment: .topLeading) { PiPHost().frame(width: 4, height: 4) }
        .onAppear {
            PlaybackCenter.shared.onRestore = { [model] id in model.show(.media(id)) }
            LibraryPrefs.shared.load(for: model.server)
        }
        // Runs when a link arrives, and when the tabs first appear with one held from before
        // sign-in.
        .task(id: model.pendingLink) { await openPendingLink() }
        .alert("Cannot open link", isPresented: Binding(
            get: { linkProblem != nil }, set: { if !$0 { linkProblem = nil } }
        )) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(linkProblem ?? "")
        }
    }

    private func openPendingLink() async {
        guard let link = model.takePendingLink(), let client = model.client else { return }
        do {
            switch link {
            case .media(let id):
                let card = try await MediaAPI.detail(client, id: id).card
                tab = .library
                libraryPath = NavigationPath([card])
            case .clip(let id):
                guard let clip = try await MediaAPI.clips(client).first(where: { $0.id == id }) else {
                    throw APIError(status: 404, code: "not_found", message: "That clip is no longer on your server.")
                }
                tab = .clips
                clipsPath = NavigationPath([clip])
            case .collection(let id):
                guard let collection = try await MediaAPI.collections(client).first(where: { $0.id == id }) else {
                    throw APIError(status: 404, code: "not_found", message: "That collection is no longer on your server.")
                }
                tab = .collections
                collectionsPath = NavigationPath([collection])
            }
        } catch let error as APIError where error.status == 404 {
            // The clip and collection cases name what is missing; the server's own 404 does not.
            linkProblem = error.message.hasPrefix("That") ? error.message : "That item is no longer on your server."
        } catch {
            linkProblem = error.localizedDescription
        }
    }

    private func screen(_ content: some View, path: Binding<NavigationPath>) -> some View {
        NavigationStack(path: path) {
            content
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Theme.background)
                .toolbarBackground(Theme.background, for: .navigationBar)
        }
        .toolbarBackground(Theme.surface, for: .tabBar)
        .toolbarBackground(.visible, for: .tabBar)
    }
}


extension View {
    /// A tab's title on the row of its toolbar buttons, rather than as a large title under them.
    @ViewBuilder
    func tabTitle(_ title: String) -> some View {
        let inline = navigationTitle(title).navigationBarTitleDisplayMode(.inline)
        let label = Text(title)
            .font(.title2.bold())
            .foregroundStyle(Theme.text)
            .lineLimit(1)
            .fixedSize()
            .accessibilityAddTraits(.isHeader)
        if #available(iOS 26, *) {
            inline.toolbar {
                // An item in the principal place stands in for the centred inline title.
                ToolbarItem(placement: .principal) { Color.clear.frame(width: 1, height: 1) }
                // A label, not a button, so no glass behind it.
                ToolbarItem(placement: .topBarLeading) { label }.sharedBackgroundVisibility(.hidden)
            }
        } else {
            inline.toolbar {
                ToolbarItem(placement: .principal) { Color.clear.frame(width: 1, height: 1) }
                ToolbarItem(placement: .topBarLeading) { label }
            }
        }
    }
}
