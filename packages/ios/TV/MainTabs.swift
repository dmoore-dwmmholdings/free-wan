import FreeWANKit
import SwiftUI

struct TVMainTabs: View {
    let me: Me

    var body: some View {
        TabView {
            NavigationStack { TVBrowseView() }
                .tabItem { Label("Browse", systemImage: "square.grid.2x2") }
            NavigationStack { TVSearchView() }
                .tabItem { Label("Search", systemImage: "magnifyingglass") }
            NavigationStack { TVCollectionsView() }
                .tabItem { Label("Collections", systemImage: "rectangle.stack") }
            NavigationStack { TVClipsView() }
                .tabItem { Label("Clips", systemImage: "scissors") }
            NavigationStack { TVSettingsView(me: me) }
                .tabItem { Label("Settings", systemImage: "gearshape") }
        }
    }
}

/// What opening an item shows: a video in the player, anything else (and a Photos-tab video,
/// which plays like a GIF) in the full-screen gallery.
struct Opener: ViewModifier {
    @Environment(AppModel.self) private var model
    @Binding var playing: MediaCard?
    @Binding var viewing: MediaCard?
    let gallery: [MediaCard]
    let onLikeChange: (String, Bool, Int) -> Void

    func body(content: Content) -> some View {
        content
            .fullScreenCover(item: $playing) { card in
                TVVideoPlayer(card: card) { liked, count in onLikeChange(card.id, liked, count) }
                    .environment(model)
            }
            .fullScreenCover(item: $viewing) { card in
                TVGallery(items: gallery.contains(card) ? gallery : [card], current: card.id, onLikeChange: onLikeChange)
                    .environment(model)
            }
    }
}
