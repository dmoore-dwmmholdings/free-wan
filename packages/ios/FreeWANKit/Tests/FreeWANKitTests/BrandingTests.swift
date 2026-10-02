import Foundation
import Testing
@testable import FreeWANKit

/// `BRANDING_PRESETS` in packages/shared/src/branding.ts.
let presets: [String: Branding.Colors] = [
    "midnight": .init(primary: "#6e4cff", accent: "#22d3ee", background: "#0b0b10", surface: "#16161d", text: "#e9e9ee"),
    "slate": .init(primary: "#5b8def", accent: "#34d399", background: "#16181d", surface: "#1e2127", text: "#e3e6ea"),
    "forest": .init(primary: "#3fb873", accent: "#8fd6b4", background: "#0c1310", surface: "#121d17", text: "#e6efe8"),
    "ember": .init(primary: "#ff7a3c", accent: "#ffd24a", background: "#15100d", surface: "#1f1813", text: "#f6ece2"),
    "neon": .init(primary: "#ff2e88", accent: "#00f5d4", background: "#08080d", surface: "#12121c", text: "#f2f2ff"),
    "paper": .init(primary: "#b8442b", accent: "#2f6f63", background: "#efece4", surface: "#ffffff", text: "#1b1a16"),
    "linen": .init(primary: "#1f6f5c", accent: "#c2682f", background: "#f3efe6", surface: "#fbf8f2", text: "#241f18"),
]

func branding(_ colors: Branding.Colors, radius: String = "16px") -> Branding {
    var b = Branding.default
    b.colors = colors
    b.radius = radius
    return b
}

@Suite struct ColorTests {
    @Test func parsesHexForms() {
        #expect(RGBA(hex: "#6e4cff") == RGBA(110, 76, 255))
        #expect(RGBA(hex: "#fff") == RGBA(255, 255, 255))
        #expect(RGBA(hex: "#241f18ff") == RGBA(36, 31, 24, 1))
        #expect(RGBA(hex: "#0000") == RGBA(0, 0, 0, 0))
    }

    @Test(arguments: ["rebeccapurple", "#12345", "", "#ggg", "123456"])
    func rejects(_ value: String) {
        #expect(RGBA(hex: value) == nil)
    }

    @Test func mixes() {
        let black = RGBA(0, 0, 0), white = RGBA(255, 255, 255)
        #expect(black.mixed(with: white, weight: 0).hex == "#ffffff")
        #expect(black.mixed(with: white, weight: 1).hex == "#000000")
        #expect(black.mixed(with: white, weight: 0.5).hex == "#808080")
    }

    @Test func luminanceNotAverage() {
        #expect(RGBA(hex: "#ffff00")!.isLight)
        #expect(!RGBA(hex: "#0000ff")!.isLight)
        #expect(!RGBA(hex: "#0b0b10")!.isLight)
    }
}

@Suite struct PaletteTests {
    @Test func defaultMatchesWebTokens() {
        let p = Palette(.default)
        #expect(p.surface2.hex == "#23232a")
        #expect(p.muted.hex == "#9b9ba0")
        #expect(p.border == RGBA(233, 233, 238, 0.11))
        #expect(p.onPrimary == RGBA(255, 255, 255))
        #expect(p.radius == 16 && p.radiusSmall == 9)
        #expect(!p.isLight)
    }

    @Test(arguments: Array(presets.keys))
    func presetIsReadable(_ name: String) {
        let p = Palette(branding(presets[name]!))
        #expect(RGBA.contrast(p.onPrimary, p.primary) >= 4.5, "on-primary")
        #expect(RGBA.contrast(p.muted, p.background) >= 4.5, "muted on background")
        #expect(RGBA.contrast(p.danger, p.background) >= 4.5, "danger on background")
        #expect(RGBA.contrast(p.text, p.surface) >= 4.5, "text on surface")
    }

    @Test func darkTextOnLightPrimaries() {
        #expect(Palette(branding(presets["forest"]!)).onPrimary.hex == "#15120c")
        #expect(Palette(branding(presets["ember"]!)).onPrimary.hex == "#15120c")
        #expect(Palette(branding(presets["paper"]!)).isLight)
    }

    @Test func badValuesFallBack() {
        var colors = presets["midnight"]!
        colors.primary = "not-a-colour"
        let p = Palette(branding(colors, radius: "huge"))
        #expect(p.primary.hex == "#6e4cff")
        #expect(p.radius == 16)
        #expect(Palette(branding(colors, radius: "4px")).radiusSmall == 2)
    }

    @Test func decodesServerPayload() throws {
        let json = ##"{"siteName":"Home","logoUrl":null,"faviconUrl":null,"theme":"paper","mode":"light","colors":{"primary":"#b8442b","accent":"#2f6f63","background":"#efece4","surface":"#ffffff","text":"#1b1a16"},"fonts":{"heading":"Newsreader","body":"Hanken Grotesk","headingUrl":null,"bodyUrl":null},"radius":"4px"}"##
        let b = try JSONDecoder().decode(Branding.self, from: Data(json.utf8))
        #expect(b.siteName == "Home")
        #expect(b.colors.background == "#efece4")
    }
}
