import Foundation
import Observation

/// Display choices per library, kept on this phone for each server: which libraries show item
/// names under their tiles.
@MainActor
@Observable
final class LibraryPrefs {
    static let shared = LibraryPrefs()

    private(set) var hiddenNames: Set<String> = []
    @ObservationIgnored private var key: String?

    func load(for server: URL?) {
        key = server.map { "hiddenNames:" + $0.absoluteString }
        hiddenNames = Set(key.flatMap { UserDefaults.standard.stringArray(forKey: $0) } ?? [])
    }

    func showsNames(_ library: String) -> Bool { !hiddenNames.contains(library) }

    func setShowsNames(_ show: Bool, for library: String) {
        if show { hiddenNames.remove(library) } else { hiddenNames.insert(library) }
        if let key { UserDefaults.standard.set(hiddenNames.sorted(), forKey: key) }
    }
}
