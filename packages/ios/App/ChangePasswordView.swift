import FreeWANKit
import SwiftUI
import UIKit

/// Changes the signed-in user's password. With `forced`, it is shown in place of the app while
/// the account still has the password it was created with, as the web app does.
struct ChangePasswordView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    var forced = false

    @State private var current = ""
    @State private var new = ""
    @State private var confirm = ""
    @State private var error: String?
    @State private var busy = false
    @State private var done = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text(forced ? "Choose a password" : "Change password")
                    .font(.largeTitle.bold())
                    .foregroundStyle(Theme.text)
                if forced {
                    Text("This account still has the password it was created with. Pick a new one to carry on.")
                        .foregroundStyle(Theme.muted)
                }

                secure("Current password", text: $current, content: .password)
                secure("New password", text: $new, content: .newPassword)
                secure("Confirm new password", text: $confirm, content: .newPassword)

                if let problem = PasswordChange.problem(current: current, new: new, confirm: confirm) {
                    Text(problem).font(.footnote).foregroundStyle(Theme.muted)
                }
                if let error {
                    Text(error)
                        .foregroundStyle(Theme.danger)
                        .accessibilityLabel("Error: \(error)")
                }
                if done {
                    Text("Password changed.").foregroundStyle(Theme.text)
                }

                Button(action: submit) {
                    HStack {
                        if busy { ProgressView().tint(Theme.onPrimary) }
                        Text("Save password").bold()
                    }
                    .foregroundStyle(Theme.onPrimary)
                    .frame(maxWidth: .infinity)
                    .padding(14)
                }
                .buttonStyle(.borderedProminent)
                .disabled(busy || !PasswordChange.canSubmit(current: current, new: new, confirm: confirm))

                if forced {
                    Button("Sign out") { Task { await model.signOut() } }
                        .frame(maxWidth: .infinity)
                }
            }
            .padding(24)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(Theme.background)
    }

    private func secure(_ label: String, text: Binding<String>, content: UITextContentType) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).font(.subheadline).foregroundStyle(Theme.muted)
            SecureField("", text: text)
                .textContentType(content)
                .accessibilityLabel(label)
                .padding(12)
                .foregroundStyle(Theme.text)
                .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.radiusSmall))
        }
    }

    private func submit() {
        guard !busy, let client = model.client else { return }
        busy = true
        error = nil
        Task {
            defer { busy = false }
            do {
                try await PasswordChange.submit(client: client, current: current, new: new)
                model.passwordChanged()
                if forced { return }
                done = true
                current = ""; new = ""; confirm = ""
            } catch {
                self.error = error.localizedDescription
            }
        }
    }
}
