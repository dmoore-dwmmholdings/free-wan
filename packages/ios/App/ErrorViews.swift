import FreeWANKit
import SwiftUI

/// A screen that could not load anything: what happened, what to do, and Try again. When the
/// server is out of reach, downloads still on the phone are pointed out.
struct ErrorStateView: View {
    let error: Error
    let retry: () async -> Void

    var body: some View {
        let text = ErrorText(error)
        ContentUnavailableView {
            Label(text.title, systemImage: text.offline ? "wifi.exclamationmark" : "exclamationmark.triangle")
        } description: {
            Text([text.message, text.offline ? Format.offlineHint(downloads: DownloadManager.shared.index.records.count) : nil]
                .compactMap { $0 }.joined(separator: " "))
        } actions: {
            Button("Try again") { Task { await retry() } }
                .buttonStyle(.bordered)
        }
    }
}

/// A failure while there is still content on screen, such as a refresh or the next page:
/// say so without taking the content away.
struct ErrorBanner: View {
    let error: Error
    let retry: () async -> Void

    var body: some View {
        let text = ErrorText(error)
        HStack(spacing: 10) {
            Image(systemName: text.offline ? "wifi.exclamationmark" : "exclamationmark.triangle")
                .foregroundStyle(Theme.danger)
            Text(text.title)
                .font(.footnote.weight(.semibold))
                .foregroundStyle(Theme.text)
            Spacer()
            Button("Retry") { Task { await retry() } }
                .font(.footnote.weight(.bold))
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(Theme.surface2, in: RoundedRectangle(cornerRadius: Theme.radiusSmall))
        .padding(.horizontal, 12)
        .accessibilityElement(children: .combine)
    }
}
