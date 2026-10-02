# FreeWAN for iOS

Native SwiftUI app. iOS 17 or later.

- `App/`: the SwiftUI app
- `FreeWANKit/`: API client, models and session logic, a Swift package with no UI
- `project.yml`: XcodeGen spec for the Xcode project
- `PLAN.md`: what is built and what is left

## Build on a Mac

```bash
brew install xcodegen
cd packages/ios
xcodegen
open FreeWAN.xcodeproj
```

In Xcode, pick your team under Signing & Capabilities, choose your iPhone, and Run. Re-run
`xcodegen` after pulling changes that add or remove files.

Without a paid Apple Developer account, an app installed this way stops opening after 7 days;
run it from Xcode again to renew.

## Test without a Mac

```bash
bash packages/ios/scripts/test-kit.sh
```

Runs the `FreeWANKit` tests in a Linux Swift container (Docker) and syntax-checks the app
sources. The app itself needs Apple's SDKs, so it is only type-checked by a Mac build.
On a Mac, `swift test` in `FreeWANKit/` runs the same tests.
