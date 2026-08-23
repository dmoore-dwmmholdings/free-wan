# ADR 0015 — Native mobile app

- **Status:** accepted
- **Date:** 2026-08-23
- **Phase:** — (not in `docs/14-build-plan.md`; added on request after Phase 14)

## Context

The web app is already mobile-responsive: bottom tab bar, safe-area insets, a branded web
manifest. What it cannot do well is keep media on the device and play it with the server
unreachable. That was the reason for asking for a mobile app, so the decisions below are all
downstream of **offline downloads** being the point.

Some of this deviates from AGENTS.md. Those deviations are recorded here rather than left to
be discovered.

## Decisions

1. **Expo + React Native, not a PWA or a Capacitor wrapper.** A PWA cannot download a video
   for offline playback in a way that survives on iOS, and a Capacitor shell would inherit
   the web player's limits while still costing a native build. Expo gives
   `expo-file-system` for real downloads and `expo-video` for native playback, background
   audio and PiP.

2. **The session token is also accepted as `Authorization: Bearer`.** This is a server
   change, made for the app. `expo-file-system` and `expo-video` issue their requests
   outside the JavaScript layer, through the platform's networking, and carry headers rather
   than cookies — so the httpOnly `fw_session` cookie cannot reach them. Both credentials
   resolve through the same `resolveSession`, so revocation, expiry and the disabled-user
   check are unchanged. A browser never receives the token: it is returned only for a login
   that opts in with `client: "native"`, which sets no cookie in exchange. See
   [`docs/13-security.md`](../13-security.md).

3. **The app asks for a server address, and builds absolute URLs.** This departs from the
   definition of done's "relative URLs, no hardcoded hostnames". A native app has no origin
   to be relative to. Nothing is hardcoded — the address is entered on first sign-in, stored
   in `expo-secure-store`, and every URL is derived from it, including the ones handed to the
   video player and the downloader.

4. **Downloads use `expo-file-system/legacy`.** SDK 54 replaced the module's API with
   `File`/`Directory`, whose download call takes auth headers but reports no progress. A
   multi-gigabyte video needs a progress bar. Revisit when the new API can report progress.

5. **Read-only for anything that is really authoring.** Collections, tags and clips can be
   browsed and filtered on but not created or edited; repositories, users, branding,
   commands and plugins do not appear at all. Curating is better with a keyboard, and every
   screen added here is a screen to keep in step with the web app. Changing your own
   password is the exception, because the server forces it (decision 7).

6. **Dependency versions are ranged, not pinned.** ADR 0001 pins versions with no `^`.
   `expo install` deliberately writes `~` ranges, because Expo expresses SDK compatibility
   that way and `expo-doctor` checks against it; pinning exactly would fight the tooling on
   every upgrade. 15 of the package's dependencies are ranged, against none in `api` and
   `shared`.

7. **`mustChangePassword` is honoured, but only on a positive answer.** The web app blocks
   every route until the starting password is replaced, and the phone must not be the way
   around that. When the server cannot be reached the flag is unknown and the app carries
   on, since locking someone out of their own downloads over a rule the server enforces on
   every request would help nobody.

8. **Subtitles are not supported.** Captions are separate WebVTT files that a browser
   attaches as `<track>` elements. `expo-video` accepts no external subtitle URLs, and this
   server's HLS master is a single rendition with no `EXT-X-MEDIA TYPE=SUBTITLES`, so a
   native player has nothing to find. Supporting them means advertising the caption tracks
   in the HLS master — a server change, not an app one, and not made here.

9. **Branding is not followed.** `/api/branding` carries the site name, colours and radius an
   admin chose, and the web app themes itself from them. The app mirrors the defaults in
   `src/theme.ts` instead. Applying live branding means threading a dynamic theme through
   every screen for a cosmetic gain; half-applying it would look broken rather than branded.

10. **TanStack Query runs with `networkMode: 'always'`.** The default `'online'` mode gates
    every fetch and retry on `onlineManager`, which on React Native is only accurate if it is
    wired to NetInfo. Wiring it would add a native module for the sole purpose of letting the
    client decide not to try. Worse, a wrong guess is not a delay: the retry is *paused*, and
    a query paused before it recorded any result stays `pending` indefinitely, rendering as
    no data, no error and no spinner, with nothing to revive it. Reaching this server depends
    on the tailnet rather than on internet connectivity, so it is not a thing worth guessing
    at — the app issues the request and surfaces a failure as a retryable error.

11. **`metro.config.js` stays minimal and additive.** It appends the workspace root to
    `watchFolders` and the root store to `nodeModulesPaths`, and nothing else. In particular
    it must not set `disableHierarchicalLookup`: that is the usual advice for npm and yarn
    monorepos, but pnpm nests each package's dependencies under
    `node_modules/.pnpm/<pkg>/node_modules/`, which Metro reaches only by walking up from the
    importing file. Setting it breaks every transitive dependency of `expo-router`.

## Consequences

- There are now two UIs against one API. `@free-wan/shared` keeps the contract in one place,
  and the app fails loudly on drift because it compiles against those types.
- `pnpm -r build` now bundles the app through Metro for both platforms. This matters more
  than it sounds: every module-resolution failure in this package has passed `tsc` cleanly,
  so without a bundle step CI would go green on a build that cannot run.
- Unit tests cover what does not need a device — server-address parsing, session handling,
  formatting, the request layer, the download manager against an in-memory filesystem.
  Playback, real file I/O and secure storage remain unverified without hardware.
- Expo Go pins the usable SDK. The app is on SDK 54 because that is what the phone it was
  tested against expects; an Expo Go update will eventually force the project forward.
