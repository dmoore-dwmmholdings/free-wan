import FreeWANKit
import Observation
import SwiftUI

/// The server's branding, resolved into colours. Views read it through `Theme`, and because
/// `ThemeStore` is observable, any view that read a colour redraws when the branding changes.
/// Read from anywhere; changed only on the main actor.
@Observable
final class ThemeStore {
    static let shared = ThemeStore()

    private(set) var branding = Branding.default
    private(set) var palette = Palette(.default)

    private static func cacheKey(_ server: URL) -> String { "branding:" + server.absoluteString }

    /// The last branding seen for this server, so an offline launch keeps its look.
    @MainActor
    func applyCached(for server: URL) {
        guard let data = UserDefaults.standard.data(forKey: Self.cacheKey(server)),
              let cached = try? JSONDecoder().decode(Branding.self, from: data)
        else { return }
        apply(cached)
    }

    /// Fetches current branding, shown if `current` still says so when it arrives (another
    /// server may be open by then). A failure keeps whatever is showing.
    @MainActor
    @discardableResult
    func refresh(from server: URL, current: () -> Bool = { true }) async -> Branding? {
        guard let fresh = try? await Branding.fetch(from: APIClient(baseURL: server)) else { return nil }
        if current() { apply(fresh) }
        if let data = try? JSONEncoder().encode(fresh) {
            UserDefaults.standard.set(data, forKey: Self.cacheKey(server))
        }
        return fresh
    }

    @MainActor
    private func apply(_ new: Branding) {
        guard new != branding else { return }
        branding = new
        palette = Palette(new)
    }
}

enum Theme {
    private static var p: Palette { ThemeStore.shared.palette }

    static var siteName: String { ThemeStore.shared.branding.siteName }
    static var background: Color { Color(p.background) }
    static var surface: Color { Color(p.surface) }
    static var surface2: Color { Color(p.surface2) }
    static var border: Color { Color(p.border) }
    static var primary: Color { Color(p.primary) }
    static var primaryTint: Color { Color(p.primaryTint) }
    /// The primary where it is drawn as text or an icon, which the raw primary is too faint for.
    static var primaryStrong: Color { Color(p.primaryStrong) }
    static var accent: Color { Color(p.accent) }
    static var text: Color { Color(p.text) }
    static var muted: Color { Color(p.muted) }
    static var onPrimary: Color { Color(p.onPrimary) }
    static var danger: Color { Color(p.danger) }
    static var radius: CGFloat { CGFloat(p.radius) }
    static var radiusSmall: CGFloat { CGFloat(p.radiusSmall) }
    /// Keyboard, alerts and system sheets follow the brand, not the phone.
    static var colorScheme: ColorScheme { p.isLight ? .light : .dark }
}

extension Color {
    init(_ c: RGBA) {
        self.init(.sRGB, red: c.r / 255, green: c.g / 255, blue: c.b / 255, opacity: c.a)
    }
}
