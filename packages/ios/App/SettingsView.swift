import FreeWANKit
import SwiftUI

/// Account, server, offline storage and versions, plus changing the password and signing out.
struct SettingsView: View {
    @Environment(AppModel.self) private var model
    let me: Me

    @State private var serverVersion: String?
    @State private var libraries: [Library] = []
    @State private var confirmingSignOut = false

    private var downloads: DownloadManager { DownloadManager.shared }

    var body: some View {
        List {
            Section("Account") {
                if me.username.isEmpty {
                    Text("Your server cannot be reached, so your account details are not available.")
                        .font(.footnote)
                        .foregroundStyle(Theme.muted)
                } else {
                    LabeledContent("Signed in as", value: me.username)
                    LabeledContent("Role", value: Format.role(me.role))
                    NavigationLink("Change password") { ChangePasswordView() }
                }
            }
            .listRowBackground(Theme.surface)

            Section("Server") {
                LabeledContent("Address", value: model.server?.absoluteString ?? "None")
                LabeledContent("Version", value: serverVersion ?? "Not reachable")
            }
            .listRowBackground(Theme.surface)

            if !libraries.isEmpty {
                Section {
                    ForEach(libraries) { library in
                        Toggle(library.name, isOn: Binding(
                            get: { LibraryPrefs.shared.showsNames(library.id) },
                            set: { LibraryPrefs.shared.setShowsNames($0, for: library.id) }
                        ))
                        .tint(Theme.primary)
                    }
                } header: {
                    Text("Show names")
                } footer: {
                    Text("Names under each library's photos and videos, on this phone.")
                }
                .listRowBackground(Theme.surface)
            }

            Section("Offline") {
                LabeledContent("Downloads", value: "\(downloads.index.records.count)")
                LabeledContent("Storage used", value: Format.bytes(Double(downloads.index.totalBytes)))
            }
            .listRowBackground(Theme.surface)

            Section("App") {
                LabeledContent("Version", value: Format.appVersion(
                    short: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String,
                    build: Bundle.main.infoDictionary?["CFBundleVersion"] as? String))
            }
            .listRowBackground(Theme.surface)

            Section {
                Button("Sign out", role: .destructive) { confirmingSignOut = true }
                    .foregroundStyle(Theme.danger)
                    .frame(maxWidth: .infinity)
            }
            .listRowBackground(Theme.surface)
        }
        .scrollContentBackground(.hidden)
        .foregroundStyle(Theme.text)
        .tabTitle("Settings")
        .confirmationDialog("Sign out?", isPresented: $confirmingSignOut, titleVisibility: .visible) {
            Button("Sign out", role: .destructive) { Task { await model.signOut() } }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Downloads stay on this phone.")
        }
        .task {
            guard let client = model.client else { return }
            serverVersion = (try? await Health.fetch(client))?.version
            // An older server has no library list; the section stays hidden.
            libraries = (try? await MediaAPI.libraries(client)) ?? []
        }
    }
}
