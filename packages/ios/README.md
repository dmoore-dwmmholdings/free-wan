# FreeWAN for iOS and Apple TV

Native SwiftUI apps: iPhone and iPad (iOS 17 or later) and Apple TV (tvOS 17 or later).

- `App/`: the iPhone app, and the files both apps share (the app model, player and loop logic,
  branding, a few views), with their iPhone-only parts behind `#if os(iOS)`
- `TV/`: the Apple TV app's own screens, built for focus and the Siri Remote
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

In Xcode, pick your team under Signing & Capabilities, choose your iPhone, and Run. For the
Apple TV app, pick the `FreeWANTV` scheme and your Apple TV (pair it in Xcode's Devices window
first). It does everything the phone app does except uploads and downloads; private servers
use a PIN set on the TV, since Apple TV has no Face ID or passcode. `scripts/tv-icons.sh`
rebuilds its icons from the iPhone icon. Re-run
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
