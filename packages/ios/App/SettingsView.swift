import FreeWANKit
import SwiftUI

/// Grows into the full Settings item (PLAN.md); for now, who is signed in and a way out.
struct SettingsView: View {
    @Environment(AppModel.self) private var model
    let me: Me

    var body: some View {
        List {
            Section("Account") {
                LabeledContent("Server", value: model.server?.host ?? "None")
                LabeledContent("Signed in as", value: me.username.isEmpty ? "Offline" : me.username)
            }
            .listRowBackground(Theme.surface)

            Section {
                Button("Sign out", role: .destructive) { Task { await model.signOut() } }
                    .foregroundStyle(Theme.danger)
            }
            .listRowBackground(Theme.surface)
        }
        .scrollContentBackground(.hidden)
        .foregroundStyle(Theme.text)
        .navigationTitle("Settings")
    }
}
