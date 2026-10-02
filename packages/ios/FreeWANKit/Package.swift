// swift-tools-version:6.0
// Platform-independent core of the iOS app: API client, models, session. Foundation only, so it
// builds and tests on Linux (scripts/test-kit.sh) as well as in Xcode.
import PackageDescription

let package = Package(
    name: "FreeWANKit",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [.library(name: "FreeWANKit", targets: ["FreeWANKit"])],
    targets: [
        .target(name: "FreeWANKit"),
        .testTarget(name: "FreeWANKitTests", dependencies: ["FreeWANKit"]),
    ],
    swiftLanguageModes: [.v5]
)
