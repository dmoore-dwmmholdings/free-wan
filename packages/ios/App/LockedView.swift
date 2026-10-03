import FreeWANKit
import SwiftUI

/// Shown when every server is private: unlock to choose one, or add another.
struct LockedView: View {
    @Environment(AppModel.self) private var model
    @State private var adding = false

    private var lock: PrivacyLock { PrivacyLock.shared }

    var body: some View {
        VStack(spacing: 18) {
            Spacer()
            Image(systemName: "lock.fill")
                .font(.largeTitle)
                .foregroundStyle(Theme.muted)
            Text("Your servers are private")
                .font(.title3.bold())
                .foregroundStyle(Theme.text)
            if lock.unlocked {
                VStack(spacing: 10) {
                    ForEach(model.visibleAccounts) { account in
                        Button {
                            Task { await model.switchTo(account) }
                        } label: {
                            ServerLabel(account: account)
                                .padding(14)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.radiusSmall))
                        }
                        .buttonStyle(.plain)
                    }
                }
            } else {
                Button {
                    Task { await lock.unlock() }
                } label: {
                    Label("Unlock", systemImage: "faceid").bold().frame(maxWidth: .infinity).padding(10)
                }
                .buttonStyle(.borderedProminent)
                if let problem = lock.problem {
                    Text(problem).font(.footnote).foregroundStyle(Theme.danger).multilineTextAlignment(.center)
                }
            }
            Spacer()
            Button("Add a server") { adding = true }
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.background)
        .sheet(isPresented: $adding) { LoginView { adding = false } }
    }
}

/// A server's name, who it is signed in as, and whether it is private.
struct ServerLabel: View {
    let account: ServerAccount

    var body: some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(account.name).foregroundStyle(Theme.text)
                Text([account.username, account.server.host ?? account.server.absoluteString]
                    .filter { !$0.isEmpty }.joined(separator: " · "))
                    .font(.caption)
                    .foregroundStyle(Theme.muted)
            }
            Spacer(minLength: 0)
            if account.isPrivate {
                Image(systemName: "lock.fill").font(.caption).foregroundStyle(Theme.muted)
                    .accessibilityLabel("Private")
            }
        }
    }
}
