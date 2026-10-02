import SwiftUI

/// The default "Midnight" preset (packages/shared/src/branding.ts). Server branding replaces
/// these once it is loaded; see PLAN.md.
enum Theme {
    static let primary = Color(hex: 0x7C5CFF)
    static let accent = Color(hex: 0x22D3EE)
    static let background = Color(hex: 0x0B0B10)
    static let text = Color(hex: 0xE9E9EE)
    static let surface = Color.white.opacity(0.06)
    static let radius: CGFloat = 16
}

extension Color {
    init(hex: UInt32) {
        self.init(
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255
        )
    }
}
