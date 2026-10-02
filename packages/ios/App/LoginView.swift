import FreeWANKit
import SwiftUI

struct LoginView: View {
    @Environment(AppModel.self) private var model
    @State private var address = ""
    @State private var username = ""
    @State private var password = ""
    @State private var error: String?
    @State private var busy = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text(Theme.siteName)
                    .font(.largeTitle.bold())
                    .foregroundStyle(Theme.text)
                Text("Sign in to your server")
                    .foregroundStyle(Theme.muted)

                field("Server address", text: $address, prompt: "media.tailnet.ts.net")
                    .keyboardType(.URL)
                    .textContentType(.URL)
                field("Username", text: $username, prompt: "admin")
                    .textContentType(.username)
                VStack(alignment: .leading, spacing: 6) {
                    Text("Password").font(.subheadline).foregroundStyle(Theme.muted)
                    SecureField("", text: $password)
                        .textContentType(.password)
                        .padding(12)
                        .foregroundStyle(Theme.text)
                        .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.radiusSmall))
                        .submitLabel(.go)
                        .onSubmit(submit)
                }

                if let error {
                    Text(error)
                        .foregroundStyle(Theme.danger)
                        .accessibilityLabel("Error: \(error)")
                }

                Button(action: submit) {
                    HStack {
                        if busy { ProgressView().tint(Theme.onPrimary) }
                        Text(busy ? "Signing in" : "Sign in").bold()
                    }
                    .foregroundStyle(Theme.onPrimary)
                    .frame(maxWidth: .infinity)
                    .padding(14)
                }
                .buttonStyle(.borderedProminent)
                .disabled(busy || address.isEmpty || username.isEmpty || password.isEmpty)
            }
            .padding(24)
        }
        .background(Theme.background)
        .onAppear { if address.isEmpty { address = model.server?.absoluteString ?? "" } }
    }

    private func field(_ label: String, text: Binding<String>, prompt: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).font(.subheadline).foregroundStyle(Theme.muted)
            TextField("", text: text, prompt: Text(prompt))
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .padding(12)
                .foregroundStyle(Theme.text)
                .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.radiusSmall))
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
                // The server's own words, such as wrong username or password.
                self.error = error.message
            } catch {
                let text = ErrorText(error)
                self.error = "\(text.title). \(text.message)"
            }
        }
    }
}
