import FreeWANKit
import SwiftUI

/// Signing in to a server: the first one, or another alongside.
struct TVLoginView: View {
    @Environment(AppModel.self) private var model
    /// Set when adding a server alongside others, which can be backed out of.
    var onCancel: (() -> Void)?

    @State private var address = ""
    @State private var username = ""
    @State private var password = ""
    @State private var error: String?
    @State private var busy = false

    var body: some View {
        VStack(alignment: .leading, spacing: 28) {
            Text(onCancel == nil ? Theme.siteName : "Add a server")
                .font(.largeTitle.bold())
            Text("Sign in to your server")
                .foregroundStyle(.secondary)
            TextField("Server address, like media.tailnet.ts.net", text: $address)
                .textContentType(.URL)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
            TextField("Username", text: $username)
                .textContentType(.username)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
            SecureField("Password", text: $password)
                .textContentType(.password)
            if let error {
                Text(error).foregroundStyle(Theme.danger)
            }
            HStack(spacing: 30) {
                Button(busy ? "Signing in" : "Sign in", action: submit)
                    .disabled(busy || address.isEmpty || username.isEmpty || password.isEmpty)
                if let onCancel { Button("Cancel", action: onCancel) }
            }
        }
        .frame(maxWidth: 1000)
        .padding(80)
        .onAppear {
            if address.isEmpty && onCancel == nil { address = model.session.recentServer?.absoluteString ?? "" }
        }
    }

    private func submit() {
        guard !busy else { return }
        busy = true
        error = nil
        Task {
            defer { busy = false }
            do {
                try await model.signIn(address: address, username: username, password: password)
            } catch let error as APIError where error.status > 0 || error.code == "bad_address" {
                self.error = error.message
            } catch {
                let text = ErrorText(error)
                self.error = "\(text.title). \(text.message)"
            }
        }
    }
}

/// Changing the password, required before anything else when the server asks for it.
struct TVChangePasswordView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    var forced = false

    @State private var current = ""
    @State private var new = ""
    @State private var confirm = ""
    @State private var error: String?
    @State private var busy = false

    var body: some View {
        VStack(alignment: .leading, spacing: 28) {
            Text("Change your password").font(.largeTitle.bold())
            if forced {
                Text("Your server asks for a new password before you go on.").foregroundStyle(.secondary)
            }
            SecureField("Current password", text: $current)
            SecureField("New password", text: $new)
            SecureField("New password again", text: $confirm)
            if let message = error ?? PasswordChange.problem(current: current, new: new, confirm: confirm) {
                Text(message).foregroundStyle(Theme.danger)
            }
            Button(busy ? "Saving" : "Save") {
                guard let client = model.client else { return }
                busy = true
                Task {
                    defer { busy = false }
                    do {
                        try await PasswordChange.submit(client: client, current: current, new: new)
                        model.passwordChanged()
                        if !forced { dismiss() }
                    } catch {
                        self.error = ErrorText(error).message
                    }
                }
            }
            .disabled(busy || !PasswordChange.canSubmit(current: current, new: new, confirm: confirm))
        }
        .frame(maxWidth: 1000)
        .padding(80)
    }
}

/// Shown when every server is private: unlock to choose one, or add another.
struct TVLockedView: View {
    @Environment(AppModel.self) private var model
    @State private var adding = false

    private var lock: PrivacyLock { PrivacyLock.shared }

    var body: some View {
        VStack(spacing: 30) {
            Image(systemName: "lock.fill").font(.system(size: 80)).foregroundStyle(.secondary)
            Text("Your servers are private").font(.title2.bold())
            if lock.unlocked {
                ForEach(model.visibleAccounts) { account in
                    Button { Task { await model.switchTo(account) } } label: { TVServerLabel(account: account) }
                }
            } else {
                Button("Unlock") { Task { await lock.unlock() } }
                if let problem = lock.problem { Text(problem).foregroundStyle(Theme.danger) }
            }
            Button("Add a server") { adding = true }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .sheet(isPresented: $adding) { TVLoginView { adding = false } }
    }
}

/// A server's name, who it is signed in as, and whether it is private.
struct TVServerLabel: View {
    let account: ServerAccount

    var body: some View {
        HStack(spacing: 16) {
            VStack(alignment: .leading, spacing: 4) {
                Text(account.name)
                Text([account.username, account.server.host ?? account.server.absoluteString]
                    .filter { !$0.isEmpty }.joined(separator: " · "))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            if account.isPrivate {
                Image(systemName: "lock.fill").accessibilityLabel("Private")
            }
        }
    }
}

/// Entering the PIN, or choosing one (twice, to be sure of it).
struct PINEntry: View {
    let prompt: PrivacyLock.Prompt

    @State private var pin = ""
    @State private var again = ""

    private var problem: String? {
        if pin.count < 4 { return "At least 4 digits." }
        if !pin.allSatisfy(\.isNumber) { return "Digits only." }
        if prompt.choosing && pin != again { return "These do not match." }
        return nil
    }

    var body: some View {
        VStack(spacing: 28) {
            Text(prompt.choosing ? "Choose a PIN" : "Enter your PIN").font(.title2.bold())
            if prompt.choosing {
                Text("You'll need it to see private servers on this Apple TV.")
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            SecureField("PIN", text: $pin).keyboardType(.numberPad)
            if prompt.choosing {
                SecureField("PIN again", text: $again).keyboardType(.numberPad)
            }
            if !pin.isEmpty, let problem { Text(problem).foregroundStyle(.secondary) }
            // Stacked, so moving down from the field lands on OK.
            VStack(spacing: 20) {
                Button("OK") { PrivacyLock.shared.answer(pin) }
                    .disabled(problem != nil)
                Button("Cancel") { PrivacyLock.shared.answer(nil) }
            }
        }
        .frame(maxWidth: 700)
        .padding(60)
    }
}
