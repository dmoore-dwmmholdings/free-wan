import LocalAuthentication
import Observation

/// Private servers stay hidden until Face ID, or the phone's passcode, unlocks them, and lock
/// again whenever the app is left.
@MainActor
@Observable
final class PrivacyLock {
    static let shared = PrivacyLock()

    private(set) var unlocked = false

    /// Whether the phone can lock anything: it needs a passcode.
    static var canProtect: Bool {
        LAContext().canEvaluatePolicy(.deviceOwnerAuthentication, error: nil)
    }
    /// Why the last unlock did not happen, when it was not simply cancelled.
    private(set) var problem: String?

    func unlock() async -> Bool {
        if unlocked { return true }
        problem = nil
        let context = LAContext()
        var error: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) else {
            problem = "Set a passcode on this phone to use private servers."
            return false
        }
        unlocked = (try? await context.evaluatePolicy(.deviceOwnerAuthentication,
                                                      localizedReason: "Show your private servers")) ?? false
        return unlocked
    }

    func lock() {
        unlocked = false
    }
}
