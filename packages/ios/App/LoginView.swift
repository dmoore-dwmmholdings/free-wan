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
                Text("FreeWAN")
                    .font(.largeTitle.bold())
                    .foregroundStyle(Theme.text)
                Text("Sign in to your server")
                    .foregroundStyle(Theme.text.opacity(0.7))

                field("Server address", text: $address, prompt: "media.tailnet.ts.net")
                    .keyboardType(.URL)
                    .textContentType(.URL)
                field("Username", text: $username, prompt: "admin")
                    .textContentType(.username)
                VStack(alignment: .leading, spacing: 6) {
                    Text("Password").font(.subheadline).foregroundStyle(Theme.text.opacity(0.7))
                    SecureField("", text: $password)
                        .textContentType(.password)
                        .padding(12)
                        .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.radius / 2))
                        .submitLabel(.go)
                        .onSubmit(submit)
                }

                if let error {
                    Text(error)
                        .foregroundStyle(Color(hex: 0xFF8A8A))
                        .accessibilityLabel("Error: \(error)")
                }

                Button(action: submit) {
                    HStack {
                        if busy { ProgressView().tint(.white) }
                        Text(busy ? "Signing in" : "Sign in").bold()
                    }
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
            Text(label).font(.subheadline).foregroundStyle(Theme.text.opacity(0.7))
            TextField("", text: text, prompt: Text(prompt))
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .padding(12)
                .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.radius / 2))
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
            } catch {
                self.error = error.localizedDescription
            }
        }
    }
}
