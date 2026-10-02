import Foundation

/// One subtitle line and when it shows, in seconds.
public struct Cue: Equatable, Sendable {
    public let start: Double
    public let end: Double
    public let text: String
}

public enum Captions {
    /// Extracting an embedded track runs ffmpeg on the server, which can take a while.
    public static let fetchTimeout: TimeInterval = 120

    public static func fetch(_ client: APIClient, path: String) async throws -> [Cue] {
        let data = try await client.data(path, timeout: fetchTimeout)
        return parse(String(decoding: data, as: UTF8.self))
    }

    /// `hh:mm:ss.mmm` or `mm:ss.mmm`; a comma is accepted for SRT-style files.
    public static func timestamp(_ value: String) -> Double? {
        let parts = value.trimmingCharacters(in: .whitespaces).split(separator: ":", omittingEmptySubsequences: false)
        guard parts.count == 2 || parts.count == 3 else { return nil }
        let secondsPart = parts.last!.replacingOccurrences(of: ",", with: ".")
        let pieces = secondsPart.split(separator: ".", omittingEmptySubsequences: false)
        guard pieces.count == 2, (1...3).contains(pieces[1].count),
              let s = Int(pieces[0]), s < 60, pieces[0].count <= 2,
              let ms = Int(pieces[1].padding(toLength: 3, withPad: "0", startingAt: 0))
        else { return nil }
        guard let m = Int(parts[parts.count - 2]), m < 60, parts[parts.count - 2].count <= 2 else { return nil }
        let h = parts.count == 3 ? Int(parts[0]) : 0
        guard let h, h >= 0 else { return nil }
        return Double(h * 3600 + m * 60 + s) + Double(ms) / 1000
    }

    /// WebVTT into cues, sorted by start. Styling tags are dropped and the common entities
    /// decoded; header, NOTE, STYLE and REGION blocks and malformed cues are skipped.
    public static func parse(_ input: String) -> [Cue] {
        var text = input.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
        if text.hasPrefix("\u{FEFF}") { text.removeFirst() }

        var cues: [Cue] = []
        for block in text.components(separatedBy: "\n\n") {
            let lines = block.split(separator: "\n").map(String.init).filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
            guard let head = lines.first?.trimmingCharacters(in: .whitespaces) else { continue }
            if ["WEBVTT", "NOTE", "STYLE", "REGION"].contains(where: { head == $0 || head.hasPrefix($0 + " ") || head.hasPrefix($0 + "\t") }) {
                continue
            }
            guard let timing = lines.firstIndex(where: { $0.contains("-->") }) else { continue }
            let halves = lines[timing].components(separatedBy: "-->")
            guard halves.count == 2,
                  let start = timestamp(halves[0]),
                  let rawEnd = halves[1].split(whereSeparator: { $0 == " " || $0 == "\t" }).first,
                  let end = timestamp(String(rawEnd)),
                  end > start
            else { continue }
            let body = lines[(timing + 1)...].map(stripTags).joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
            guard !body.isEmpty else { continue }
            cues.append(Cue(start: start, end: end, text: body))
        }
        return cues.sorted { $0.start < $1.start }
    }

    /// The cue showing at `time`: of those under way, the one that started last.
    public static func cue(in cues: [Cue], at time: Double) -> Cue? {
        var found: Cue?
        for cue in cues {
            if cue.start > time { break }
            if time < cue.end { found = cue }
        }
        return found
    }

    static func stripTags(_ line: String) -> String {
        var out = ""
        var inTag = false
        for ch in line {
            if ch == "<" { inTag = true; continue }
            if ch == ">" && inTag { inTag = false; continue }
            if !inTag { out.append(ch) }
        }
        return out
            .replacingOccurrences(of: "&lt;", with: "<")
            .replacingOccurrences(of: "&gt;", with: ">")
            .replacingOccurrences(of: "&nbsp;", with: " ")
            .replacingOccurrences(of: "&amp;", with: "&")
    }
}
