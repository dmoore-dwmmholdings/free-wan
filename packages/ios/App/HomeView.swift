import FreeWANKit
import SwiftUI

/// Placeholder until the library tabs land (PLAN.md).
struct HomeView: View {
    @Environment(AppModel.self) private var model
    let me: Me

    var body: some View {
        NavigationStack {
            VStack(spacing: 16) {
                Text(me.username.isEmpty ? "Offline" : "Signed in as \(me.username)")
                    .foregroundStyle(Theme.text)
                Button("Sign out") { Task { await model.signOut() } }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Theme.background)
            .navigationTitle("FreeWAN")
        }
    }
}
