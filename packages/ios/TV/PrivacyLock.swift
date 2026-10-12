import Foundation
import FreeWANKit
import Observation

/// Private servers stay hidden until unlocked, and lock again whenever the app is left. Apple TV
/// has no Face ID or passcode, so it uses a PIN of its own, chosen the first time a server is
/// made private and kept in the Keychain.
@MainActor
@Observable
final class PrivacyLock {
    static let shared = PrivacyLock()

    struct Prompt: Identifiable {
        let id = UUID()
        /// Choosing a new PIN, rather than entering the one there is.
        let choosing: Bool
    }

    private(set) var unlocked = false
    /// Why the last unlock did not happen, when it was not simply cancelled.
    private(set) var problem: String?
    /// The PIN entry on screen, if any.
    private(set) var prompt: Prompt?

    @ObservationIgnored private let store = KeychainStore(service: "com.freewan.tv.pin")
    @ObservationIgnored private var waiting: CheckedContinuation<String?, Never>?

    /// A PIN can always be chosen when it is first needed.
    static var canProtect: Bool { true }

    var hasPIN: Bool { store.get("pin") != nil }

    func unlock() async -> Bool {
        if unlocked { return true }
        problem = nil
        // Asked for even with no PIN set, so the prompt gives nothing away.
        guard let entered = await ask(choosing: false) else { return false }
        unlocked = entered == store.get("pin")
        if !unlocked { problem = "That PIN is not right." }
        return unlocked
    }

    /// True once there is a PIN, choosing one now if there is none.
    func ensurePIN() async -> Bool {
        if hasPIN { return true }
        guard let pin = await ask(choosing: true) else { return false }
        store.set("pin", pin)
        unlocked = true
        return true
    }

    func lock() {
        unlocked = false
    }

    /// The entry's result: the PIN, or nil when cancelled.
    func answer(_ pin: String?) {
        prompt = nil
        waiting?.resume(returning: pin)
        waiting = nil
    }

    private func ask(choosing: Bool) async -> String? {
        answer(nil)
        return await withCheckedContinuation { continuation in
            waiting = continuation
            prompt = Prompt(choosing: choosing)
        }
    }
}
