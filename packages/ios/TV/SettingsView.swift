import FreeWANKit
import SwiftUI

/// Servers (switch, add, private, sign out), which libraries show names, the account, the
/// server and the app.
struct TVSettingsView: View {
    @Environment(AppModel.self) private var model
    let me: Me

    @State private var serverVersion: String?
    @State private var libraries: [Library] = []
    @State private var librariesUnavailable = false
    @State private var adding = false
    @State private var changingPassword = false

    private var lock: PrivacyLock { PrivacyLock.shared }

    var body: some View {
        List {
            Section {
                ForEach(model.visibleAccounts) { account in
                    Menu {
                        if account.id != model.account?.id {
                            Button("Switch to \(account.name)") { Task { await model.switchTo(account) } }
                        }
                        Button(account.isPrivate ? "Make not private" : "Make private") {
                            Task { await makePrivate(account, !account.isPrivate) }
                        }
                        Button("Sign out", role: .destructive) { Task { await model.signOut(account) } }
                    } label: {
                        HStack {
                            TVServerLabel(account: account)
                            Spacer()
                            if account.id == model.account?.id {
                                Image(systemName: "checkmark").accessibilityLabel("In use")
                            }
                        }
                    }
                }
                Button("Add a server") { adding = true }
                if !lock.unlocked {
                    // Shown whether or not any server is private, so it gives nothing away.
                    Button("Show private servers") { Task { await lock.unlock() } }
                }
                if let problem = lock.problem {
                    Text(problem).foregroundStyle(Theme.danger)
                }
            } header: {
                Text("Servers")
            } footer: {
                Text("Private servers stay hidden until your PIN unlocks them, and lock again when you leave FreeWAN.")
            }

            if librariesUnavailable {
                Section("Show names") {
                    Text("Update your server to choose which libraries show names.").foregroundStyle(.secondary)
                }
            } else if !libraries.isEmpty {
                Section("Show names") {
                    ForEach(libraries) { library in
                        Toggle(library.name, isOn: Binding(
                            get: { LibraryPrefs.shared.showsNames(library.id) },
                            set: { LibraryPrefs.shared.setShowsNames($0, for: library.id) }
                        ))
                    }
                }
            }

            Section("Account") {
                if me.username.isEmpty {
                    Text("Your server cannot be reached, so your account details are not available.")
                        .foregroundStyle(.secondary)
                } else {
                    LabeledContent("Signed in as", value: me.username)
                    LabeledContent("Role", value: Format.role(me.role))
                    Button("Change password") { changingPassword = true }
                }
            }

            Section("Server") {
                LabeledContent("Address", value: model.server?.absoluteString ?? "None")
                LabeledContent("Version", value: serverVersion ?? "Not reachable")
            }

            Section("App") {
                LabeledContent("Version", value: Format.appVersion(
                    short: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String,
                    build: Bundle.main.infoDictionary?["CFBundleVersion"] as? String))
            }

            Section {
                Button("Sign out", role: .destructive) { Task { await model.signOut() } }
            }
        }
        .task {
            guard let client = model.client else { return }
            serverVersion = (try? await Health.fetch(client))?.version
            do {
                libraries = try await MediaAPI.libraries(client)
            } catch let error as APIError where error.status > 0 {
                librariesUnavailable = true
            } catch {
                // Unreachable: the Server section shows that already.
            }
        }
        .sheet(isPresented: $adding) { TVLoginView { adding = false } }
        .sheet(isPresented: $changingPassword) { TVChangePasswordView() }
    }

    /// The first private server sets the PIN that unlocks them all.
    private func makePrivate(_ account: ServerAccount, _ isPrivate: Bool) async {
        if isPrivate, !(await lock.ensurePIN()) { return }
        model.setPrivate(account, isPrivate)
    }
}
