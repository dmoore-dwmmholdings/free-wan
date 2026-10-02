import Foundation

/// Mirrors `brandingSchema` in packages/shared/src/branding.ts. Served by `GET /api/branding`,
/// which needs no session.
public struct Branding: Codable, Equatable, Sendable {
    public struct Colors: Codable, Equatable, Sendable {
        public var primary: String
        public var accent: String
        public var background: String
        public var surface: String
        public var text: String
    }

    public var siteName: String
    public var logoUrl: String?
    public var theme: String
    public var mode: String
    public var colors: Colors
    public var radius: String

    /// `DEFAULT_BRANDING` ("midnight").
    public static let `default` = Branding(
        siteName: "FreeWAN", logoUrl: nil, theme: "midnight", mode: "dark",
        colors: Colors(primary: "#6e4cff", accent: "#22d3ee", background: "#0b0b10",
                       surface: "#16161d", text: "#e9e9ee"),
        radius: "16px")

    public static func fetch(from client: APIClient) async throws -> Branding {
        try await client.get("/api/branding")
    }
}

/// An sRGB colour, channels 0...255 and alpha 0...1.
public struct RGBA: Equatable, Sendable {
    public var r: Double, g: Double, b: Double, a: Double

    public init(_ r: Double, _ g: Double, _ b: Double, _ a: Double = 1) {
        self.r = r; self.g = g; self.b = b; self.a = a
    }

    /// `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa`, all of which the branding schema accepts.
    public init?(hex input: String) {
        var digits = input.trimmingCharacters(in: .whitespaces)
        guard digits.hasPrefix("#") else { return nil }
        digits.removeFirst()
        guard [3, 4, 6, 8].contains(digits.count), digits.allSatisfy(\.isHexDigit) else { return nil }
        if digits.count <= 4 { digits = String(digits.flatMap { [$0, $0] }) }
        let value = { (i: Int) -> Double in
            let start = digits.index(digits.startIndex, offsetBy: i)
            return Double(Int(digits[start..<digits.index(start, offsetBy: 2)], radix: 16)!)
        }
        self.init(value(0), value(2), value(4), digits.count == 8 ? value(6) / 255 : 1)
    }

    /// `color-mix(in srgb, self <weight>, other)`, premultiplied by alpha as CSS does.
    public func mixed(with other: RGBA, weight: Double) -> RGBA {
        let w = min(1, max(0, weight))
        let alpha = a * w + other.a * (1 - w)
        guard alpha > 0 else { return RGBA(0, 0, 0, 0) }
        func channel(_ x: Double, _ y: Double) -> Double { (x * a * w + y * other.a * (1 - w)) / alpha }
        return RGBA(channel(r, other.r), channel(g, other.g), channel(b, other.b), alpha)
    }

    /// The same colour, partly see-through. An already translucent colour gets more so.
    public func withAlpha(_ alpha: Double) -> RGBA {
        RGBA(r, g, b, min(1, max(0, alpha)) * a)
    }

    /// `#rrggbb`, rounding each channel; alpha is ignored.
    public var hex: String {
        func byte(_ v: Double) -> Int { Int(min(255, max(0, v)).rounded()) }
        return "#" + [r, g, b].map { String(format: "%02x", byte($0)) }.joined()
    }

    /// WCAG relative luminance.
    public var luminance: Double {
        func channel(_ v: Double) -> Double {
            let x = v / 255
            return x <= 0.04045 ? x / 12.92 : pow((x + 0.055) / 1.055, 2.4)
        }
        return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
    }

    /// Where black and white text are equally readable: sqrt(1.05 x 0.05) - 0.05. Shared with
    /// `TEXT_CROSSOVER_LUMINANCE` in packages/web/src/lib/theme.ts.
    public static let textCrossoverLuminance = 0.1791

    /// Light enough to need dark text over it.
    public var isLight: Bool { luminance > Self.textCrossoverLuminance }

    public static func contrast(_ x: RGBA, _ y: RGBA) -> Double {
        let (hi, lo) = (max(x.luminance, y.luminance), min(x.luminance, y.luminance))
        return (hi + 0.05) / (lo + 0.05)
    }
}

/// The full token set the web app derives from the five base colours with `color-mix`, using
/// the same percentages so a preset looks the same in both apps.
public struct Palette: Equatable, Sendable {
    public var background, surface, surface2, border: RGBA
    public var primary, primaryTint, primaryStrong, accent: RGBA
    public var text, muted, onPrimary, danger: RGBA
    public var radius: Double
    public var radiusSmall: Double

    public var isLight: Bool { background.isLight }

    static let onPrimaryDark = RGBA(hex: "#15120c")!
    static let dangerOnDark = RGBA(hex: "#f87171")!
    static let dangerOnLight = RGBA(hex: "#b91c1c")!

    public init(_ branding: Branding) {
        let fallback = Branding.default.colors
        func color(_ value: String, _ backup: String) -> RGBA { RGBA(hex: value) ?? RGBA(hex: backup)! }
        let c = branding.colors
        background = color(c.background, fallback.background)
        surface = color(c.surface, fallback.surface)
        primary = color(c.primary, fallback.primary)
        accent = color(c.accent, fallback.accent)
        text = color(c.text, fallback.text)

        surface2 = text.mixed(with: surface, weight: 0.06)
        border = text.withAlpha(0.11)
        primaryTint = primary.withAlpha(0.15)
        // The primary pushed towards the text colour, for where it is drawn as text or an icon.
        primaryStrong = primary.mixed(with: text, weight: 0.6)
        muted = text.mixed(with: background, weight: 0.65)
        onPrimary = primary.isLight ? Self.onPrimaryDark : RGBA(255, 255, 255)
        danger = background.isLight ? Self.dangerOnLight : Self.dangerOnDark

        // A CSS length such as "16px"; the small radius is 0.58 of it, as on the web.
        let scanned = Double(branding.radius.prefix { $0.isNumber || $0 == "." }) ?? 16
        radius = scanned >= 0 ? scanned : 16
        radiusSmall = (radius * 0.58).rounded()
    }
}
