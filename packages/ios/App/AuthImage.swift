import FreeWANKit
import SwiftUI
import UIKit

/// Decoded images by server and path, so scrolling back up does not refetch or redecode.
final class ImageCache: @unchecked Sendable {
    static let shared = ImageCache()

    private let cache: NSCache<NSString, UIImage> = {
        let cache = NSCache<NSString, UIImage>()
        cache.totalCostLimit = 150 * 1024 * 1024
        return cache
    }()

    func image(_ key: String) -> UIImage? { cache.object(forKey: key as NSString) }

    func store(_ image: UIImage, _ key: String) {
        let cost = Int(image.size.width * image.size.height * image.scale * image.scale * 4)
        cache.setObject(image, forKey: key as NSString, cost: cost)
    }

    /// Fetches through the client so the request carries the session token.
    func load(_ path: String, client: APIClient) async -> UIImage? {
        let key = client.baseURL.absoluteString + path
        if let hit = image(key) { return hit }
        guard let data = try? await client.data(path) else { return nil }
        // Decode off the main thread; a grid of full-size posters stutters otherwise.
        let decoded = await Task.detached(priority: .userInitiated) {
            UIImage(data: data)?.preparingForDisplay()
        }.value
        if let decoded { store(decoded, key) }
        return decoded
    }
}

/// An image from an API path that needs the session token, which `AsyncImage` cannot send.
struct AuthImage: View {
    @Environment(AppModel.self) private var model
    let path: String
    var contentMode: ContentMode = .fill

    @State private var image: UIImage?

    var body: some View {
        ZStack {
            Theme.surface2
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .aspectRatio(contentMode: contentMode)
            }
        }
        .task(id: path) {
            guard let client = model.client else { return }
            if let hit = ImageCache.shared.image(client.baseURL.absoluteString + path) {
                image = hit
                return
            }
            image = await ImageCache.shared.load(path, client: client)
        }
    }
}
