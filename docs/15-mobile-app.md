# 15 — Mobile app

`packages/mobile` is a native iOS and Android client built with Expo and React Native. It
talks to the same REST API as the web app and shares types through `@free-wan/shared`, so
there is one contract to keep in sync rather than two.

The reason it exists rather than a PWA: **offline downloads**. Saving a video to the device
and playing it with the server unreachable is not something a browser does well, and it was
the point of the app.

---

## Requirements

- Node and pnpm as for the rest of the repo (`pnpm install` at the root covers it)
- **Expo SDK 54.** Expo Go ships one SDK runtime at a time, so the version here has to match
  the Expo Go installed on the phone. If Expo Go refuses to open the project, that mismatch
  is almost always why.
- A phone on the same network as your machine, or on your tailnet

---

## Running it during development

```bash
pnpm --filter @free-wan/mobile start
```

Metro prints a QR code. Scan it with Expo Go (Android) or the Camera app (iOS). If the QR
does not render — it needs a real terminal — use the printed `exp://<host>:8081` address
through Expo Go's "Enter URL manually".

Two addresses usually work:

| Address | When to use it |
|---|---|
| `exp://<lan-ip>:8081` | Phone on the same Wi-Fi as your machine |
| `exp://<tailscale-ip>:8081` | Phone on your tailnet, from anywhere |

Metro hot-reloads, so edits appear without rescanning.

---

## Signing in

The app has no origin of its own, so the first screen asks for the **server address** as well
as your username and password. A bare hostname is assumed to be `https://`; type `http://`
explicitly for a plain-HTTP server on your LAN.

Anything the browser would reach works here — a tailnet hostname
(`media.tailnet.ts.net`), a LAN address with a port (`http://192.168.1.10:8080`), or a
pasted URL with a path, which is reduced to its origin.

### Why the app uses a bearer token

The web app authenticates with an httpOnly `fw_session` cookie. The mobile app cannot: both
`expo-file-system` (downloads) and `expo-video` (playback) make their requests outside the
JavaScript layer, through the platform's own networking, and they take **headers**, not
cookies.

So the app sends `client: "native"` when it logs in. The server then returns the session
token in the response body and sets no cookie, and the app sends it as
`Authorization: Bearer <token>` on every request, including the ones it hands to the video
player and the downloader.

Browser logins are unchanged and still never receive the token, so a cross-site script
cannot mint one without the password. See `resolveSession` in
`packages/api/src/plugins/auth.ts`.

The token is stored in `expo-secure-store` — the iOS Keychain and the Android Keystore.

---

## Offline downloads

Tapping **Download** on any item saves the media and its poster under the app's document
directory, with an index in `AsyncStorage`.

A downloaded item plays entirely from the device: the screen skips the `/playback` request
and points the player at the local `file://`, so it works with the server switched off.
Photos are downloaded at full resolution, not as thumbnails.

Two behaviours worth knowing:

- If the OS reclaims a file to free space, its record is dropped when the app next loads its
  index, rather than leaving an entry that fails to open.
- A transfer that fails leaves no record behind, so a broken download never looks complete.

The Downloads tab lists transfers still running above finished ones, with progress.

---

## Installing it on your phone for real

Expo Go is a development client. It cannot keep the app on your phone, and it will stop
working when your Expo Go updates to a newer SDK. For an app you actually own you need a
build.

This project uses Expo's managed native workflow, so `android/` and `ios/` are generated and
are not committed. Regenerate them any time with:

```bash
pnpm --filter @free-wan/mobile prebuild
```

That reads `app.json` and writes real native projects, wiring in the launcher icons, the
splash screen, and the Android cleartext-HTTP permission a plain-HTTP server needs.

From there, either:

- **Build locally.** `pnpm --filter @free-wan/mobile android` (needs Android Studio and the
  Android SDK) or `... ios` (needs a Mac with Xcode). This installs a real app on a
  connected device.
- **Build in the cloud with EAS.** `npx eas build --platform android --profile preview`
  produces an installable APK without a local Android toolchain. Needs an Expo account.

For a personal server, an Android APK you sideload is usually the least friction. iOS is
harder: without a paid Apple Developer account, a build installed from Xcode expires after
seven days.

---

## What it does not do

Deliberate omissions, since this is a companion to the web app rather than a replacement:

- No admin: repositories, users, branding, commands and plugins stay on the web app
- Collections are read-only — you can browse them but not create or edit them
- Clips play here, looping between their in and out points, but are cut on the web app
- No uploads
- Tags can be filtered on and are shown per item, but not created or edited

---

## Troubleshooting

**"Project is incompatible with this version of Expo Go."** Your Expo Go expects a different
SDK. Either install an Expo Go matching SDK 54, or upgrade the project with
`npx expo install expo@latest --fix` and check the notes below about `expo-file-system`.

**The app cannot reach the server.** Check the address in Settings. On Android a plain-HTTP
server needs the cleartext permission, which `expo-build-properties` sets in `app.json` —
this only applies to a real build, not to Expo Go.

**Typed routes break after adding a screen.** `.expo/types/router.d.ts` is generated by the
running dev server and appended to incrementally, so a route added while it runs can be
classified wrongly and files outside `app/` can leak in as routes. Delete `.expo` and restart
`expo start`. The file is gitignored, and a fresh clone typechecks without it.

**Metro cannot resolve a module.** `metro.config.js` is deliberately minimal and additive.
Do not set `disableHierarchicalLookup`: it is the usual advice for npm and yarn monorepos,
but pnpm nests each package's dependencies under `node_modules/.pnpm/<pkg>/node_modules/`,
which Metro only finds by walking up from the importing file. Setting it breaks every
transitive dependency of `expo-router`.

**`expo-file-system` and the legacy import.** `src/lib/downloads.ts` imports from
`expo-file-system/legacy`. SDK 54 replaced the module's API with `File`/`Directory`, but the
new download call reports no progress, and a multi-gigabyte video needs a progress bar.
Revisit when the new API can report progress.

---

## Testing

```bash
pnpm --filter @free-wan/mobile test
```

The unit tests cover the logic that does not need a device: server-address parsing, session
handling, formatting, and the download manager. The download tests run against an in-memory
filesystem stub that can report progress, fail a transfer, and evict a file behind the app's
back, so the manager's real behaviour is exercised without a phone.

What tests cannot cover, and still needs a device: actual playback, real file I/O, and
secure storage.
