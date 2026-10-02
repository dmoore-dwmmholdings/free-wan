import FreeWANKit
import SwiftUI
import UIKit

/// Full-screen photos: swipe between them, pinch or double-tap to zoom.
struct PhotoViewer: View {
    @Environment(\.dismiss) private var dismiss
    let photos: [MediaCard]
    @State var current: String

    var body: some View {
        TabView(selection: $current) {
            ForEach(photos) { photo in
                ZoomablePhoto(card: photo)
                    .tag(photo.id)
                    .ignoresSafeArea()
            }
        }
        .tabViewStyle(.page(indexDisplayMode: .never))
        .background(.black)
        .ignoresSafeArea()
        .overlay(alignment: .topTrailing) {
            Button { dismiss() } label: {
                Image(systemName: "xmark")
                    .font(.headline)
                    .foregroundStyle(.white)
                    .frame(width: 44, height: 44)
                    .background(.black.opacity(0.5), in: Circle())
            }
            .padding(16)
            .accessibilityLabel("Close")
        }
        .overlay(alignment: .bottom) {
            if let title = photos.first(where: { $0.id == current })?.title {
                Text(title)
                    .font(.footnote)
                    .foregroundStyle(.white)
                    .lineLimit(1)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(.black.opacity(0.5), in: Capsule())
                    .padding(.bottom, 24)
            }
        }
        .statusBarHidden()
    }
}

/// One photo, sized for the screen, swapped for the original once zoomed in far enough to
/// see the difference.
struct ZoomablePhoto: View {
    @Environment(AppModel.self) private var model
    @Environment(\.displayScale) private var scale
    let card: MediaCard

    @State private var image: UIImage?
    @State private var original = false
    @State private var failed = false

    var body: some View {
        GeometryReader { geometry in
            ZStack {
                if let image {
                    ZoomableImage(image: image) { zoom in
                        if zoom > 1.5 && !original { original = true }
                    }
                } else if failed {
                    Label("This photo could not be loaded", systemImage: "photo")
                        .foregroundStyle(.white)
                } else {
                    ProgressView().tint(.white)
                }
            }
            .frame(width: geometry.size.width, height: geometry.size.height)
            .task(id: original) {
                guard let client = model.client else { return }
                let width = original ? nil : PhotoSize.width(
                    points: max(geometry.size.width, geometry.size.height),
                    scale: scale, sourceWidth: card.width)
                if let loaded = await ImageCache.shared.load(PhotoSize.path(id: card.id, width: width), client: client) {
                    image = loaded
                } else if image == nil {
                    failed = true
                }
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(card.title)
        .accessibilityAddTraits(.isImage)
    }
}

/// A UIScrollView around an image view, for native pinch, pan and double-tap zoom.
struct ZoomableImage: UIViewRepresentable {
    let image: UIImage
    var onZoom: (CGFloat) -> Void = { _ in }

    func makeUIView(context: Context) -> UIScrollView {
        let scroll = UIScrollView()
        scroll.delegate = context.coordinator
        scroll.minimumZoomScale = 1
        scroll.maximumZoomScale = 5
        scroll.showsHorizontalScrollIndicator = false
        scroll.showsVerticalScrollIndicator = false
        scroll.backgroundColor = .black

        let imageView = UIImageView(image: image)
        imageView.contentMode = .scaleAspectFit
        imageView.frame = scroll.bounds
        imageView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        scroll.addSubview(imageView)
        context.coordinator.imageView = imageView

        let doubleTap = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.doubleTapped(_:)))
        doubleTap.numberOfTapsRequired = 2
        scroll.addGestureRecognizer(doubleTap)
        return scroll
    }

    func updateUIView(_ scroll: UIScrollView, context: Context) {
        context.coordinator.onZoom = onZoom
        // A sharper copy of the same photo replaces the image without resetting the zoom.
        if context.coordinator.imageView?.image !== image {
            context.coordinator.imageView?.image = image
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator(onZoom: onZoom) }

    final class Coordinator: NSObject, UIScrollViewDelegate {
        var imageView: UIImageView?
        var onZoom: (CGFloat) -> Void

        init(onZoom: @escaping (CGFloat) -> Void) {
            self.onZoom = onZoom
        }

        func viewForZooming(in scrollView: UIScrollView) -> UIView? { imageView }

        func scrollViewDidEndZooming(_ scrollView: UIScrollView, with view: UIView?, atScale scale: CGFloat) {
            onZoom(scale)
        }

        @objc func doubleTapped(_ gesture: UITapGestureRecognizer) {
            guard let scroll = gesture.view as? UIScrollView else { return }
            if scroll.zoomScale > 1 {
                scroll.setZoomScale(1, animated: true)
            } else {
                let point = gesture.location(in: imageView)
                let size = CGSize(width: scroll.bounds.width / 2.5, height: scroll.bounds.height / 2.5)
                scroll.zoom(to: CGRect(x: point.x - size.width / 2, y: point.y - size.height / 2,
                                       width: size.width, height: size.height), animated: true)
                onZoom(2.5)
            }
        }
    }
}
