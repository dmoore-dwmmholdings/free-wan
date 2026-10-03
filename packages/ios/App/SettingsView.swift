import FreeWANKit
import SwiftUI

/// Account, server, offline storage and versions, plus changing the password and signing out.
struct SettingsView: View {
    @Environment(AppModel.self) private var model
    let me: Me

    @State private var serverVersion: String?
    @State private var libraries: [Library] = []
    /// Set when the server answered but could not list its libraries.
    @State private var librariesUnavailable = false
    @State private var adding = false
    @State private var serverProblem: String?
    @State private var confirmingSignOut = false

    private var downloads: DownloadManager { DownloadManager.shared }

    var body: some View {
        List {
            Section {
                ForEach(model.visibleAccounts) { account in
                    HStack {
                        Button {
                            Task { await model.switchTo(account) }
                        } label: {
                            HStack {
                                ServerLabel(account: account)
                                if account.id == model.account?.id {
                                    Image(systemName: "checkmark").foregroundStyle(Theme.primaryStrong)
                                        .accessibilityLabel("In use")
                                }
                            }
                        }
                        .buttonStyle(.plain)
                        Menu {
                            Button(account.isPrivate ? "Make not private" : "Make private",
                                   systemImage: account.isPrivate ? "lock.open" : "lock") {
                                makePrivate(account, !account.isPrivate)
                            }
                            Button("Sign out", systemImage: "rectangle.portrait.and.arrow.right", role: .destructive) {
                                Task { await model.signOut(account) }
                            }
                        } label: {
                            Image(systemName: "ellipsis.circle").foregroundStyle(Theme.muted)
                        }
                        .accessibilityLabel("Options for \(account.name)")
                    }
                }
                Button("Add a server", systemImage: "plus") { adding = true }
                if !PrivacyLock.shared.unlocked {
                    // Shown whether or not any server is private, so it gives nothing away.
                    Button("Show private servers", systemImage: "faceid") {
                        Task {
                            if !(await PrivacyLock.shared.unlock()) { serverProblem = PrivacyLock.shared.problem }
                        }
                    }
                }
                if let serverProblem {
                    Text(serverProblem).font(.footnote).foregroundStyle(Theme.danger)
                }
            } header: {
                Text("Servers")
            } footer: {
                Text("Private servers stay hidden until Face ID or your passcode unlocks them, and lock again when you leave FreeWAN.")
            }
            .listRowBackground(Theme.surface)

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

            if librariesUnavailable {
                Section("Show names") {
                    Text("Update your server to choose which libraries show names.")
                        .font(.footnote)
                        .foregroundStyle(Theme.muted)
                }
                .listRowBackground(Theme.surface)
            } else if !libraries.isEmpty {
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
                LabeledContent("Downloads", value: "\(downloads.visible.count)")
                LabeledContent("Storage used", value: Format.bytes(Double(downloads.visibleBytes)))
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
        .sheet(isPresented: $adding) { LoginView { adding = false } }
        .confirmationDialog("Sign out?", isPresented: $confirmingSignOut, titleVisibility: .visible) {
            Button("Sign out", role: .destructive) { Task { await model.signOut() } }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Downloads stay on this phone.")
        }
        .task {
            guard let client = model.client else { return }
            serverVersion = (try? await Health.fetch(client))?.version
            do {
                libraries = try await MediaAPI.libraries(client)
            } catch let error as APIError where error.status > 0 {
                // Reached, but too old to list them to this user.
                librariesUnavailable = true
            } catch {
                // Unreachable: Settings shows that already.
            }
        }
    }
}

extension SettingsView {
    /// A private server has to be unlockable, which needs a passcode on the phone.
    fileprivate func makePrivate(_ account: ServerAccount, _ isPrivate: Bool) {
        serverProblem = nil
        if isPrivate && !PrivacyLock.canProtect {
            serverProblem = "Set a passcode on this phone to make a server private."
            return
        }
        model.setPrivate(account, isPrivate)
    }
}
