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
   password is the exception, because both clients force it (decision 7).

   **Uploads are the other exception, added later.** This decision originally covered them,
   and it was wrong to: the reason given was that curating is better with a keyboard, and
   uploading is not curating. It is capture, and the phone is the device holding the photos
   and video in the first place — it is the one thing this app can do that the web app
   cannot do as well. The server already had the endpoint and the web app already used it,
   so this added no server surface. Editing what has been uploaded still belongs on the web
   app.

6. **Dependency versions are ranged, not pinned.** ADR 0001 pins versions with no `^`.
   `expo install` deliberately writes `~` ranges, because Expo expresses SDK compatibility
   that way and `expo-doctor` checks against it; pinning exactly would fight the tooling on
   every upgrade. 15 of the package's dependencies are ranged, against none in `api` and
   `shared`.

7. **`mustChangePassword` is honoured, but only on a positive answer.** The web app blocks
   every route until the starting password is replaced, and the phone must not be the way
   around that. When the server cannot be reached the flag is unknown and the app carries on.

   This decision previously justified carrying on by saying the server enforces the rule on
   every request. **It does not.** `authenticate` and `requireAdmin` check the session and the
   role and nothing else, so no route refuses a user who still has the password they were
   given; the flag is reported by `/api/auth/me` and by login, and cleared when the password
   changes, but it is never a gate. Enforcement lives entirely in the clients, and the web app
   is in the same position — a request made outside either client is not blocked by it.

   So treating an unknown answer as "not blocked" is a real decision rather than a formality.
   It is still the right one for this app: the flag exists to move someone off a bootstrap
   password, not to defend against someone holding valid credentials, and refusing to open
   downloads already on the device because the server is unreachable would trade something
   real for something notional. Making it a genuine boundary means rejecting requests
   server-side, which is a server change and a decision for the project rather than for this
   package. Recorded in `docs/13-security.md`.

8. **Subtitles are drawn by the app, not handed to the player.** `expo-video` accepts no
   external subtitle file — `VideoSource` has no field for one, and `availableSubtitleTracks`
   only reports tracks carried inside the media — while this server keeps captions as
   separate WebVTT. This decision previously read "subtitles are not supported", on the
   grounds that the fix was to advertise the tracks in the HLS master. That would have been
   the wrong fix twice over: it is a server change that risks the web player for no gain
   there, and it only covers `hls` playback. Items that direct-play would still have had no
   captions — and the first captioned file tested came back as `mode: "direct"`, so that is
   not a corner case.

   So the app fetches the WebVTT itself, parses it, and draws the active cue over the video.
   The cost is that captions are ours to style and position rather than the platform's, and
   that a downloaded item has no captions offline, since the track is fetched from the
   server. The gain is that it works for both playback modes, touches no server code, and
   the parsing and cue-selection are pure functions — which matters for a package whose
   playback cannot otherwise be tested without a device.

9. **Branding is followed, through a mutable token singleton rather than a context.**
   `/api/branding` carries the site name, colours and radius an admin chose. This decision
   previously said branding was not followed, because applying it meant threading a theme
   through every screen. That turned out to be avoidable: this package has no
   `StyleSheet.create` anywhere, so every style object is built during render. The tokens in
   `src/theme.ts` can therefore be mutated in place and take effect on the next render, and
   the root is keyed so one happens. That is why ~300 `theme.` reads across 19 files did not
   have to change. If `StyleSheet.create` is ever introduced those styles will freeze at
   creation and this stops working — the note in `theme.ts` says so.

   `src/lib/palette.ts` reproduces the web's `color-mix` derivations (surface-2, border,
   muted, tints) with the same percentages, so a preset retunes both apps to the same values
   rather than to merely similar ones. Deriving them exposed that the literals this file used
   to carry were eyeballed and had drifted from what the web actually computes; they now
   agree.

   The old warning that half-applying branding "would look broken" was well founded. Applying
   a light preset immediately showed it: the duration badge on a tile paired a hardcoded dark
   background with `theme.color.text`, which is near-black under a light preset — a contrast
   ratio of 1.2:1. It is now a fixed dark pill with fixed white text, since it sits over
   arbitrary poster art and should not follow the palette at all.

   The app's colour scheme is set from the palette's own lightness rather than declared in
   `app.json`, which now says `automatic`. The keyboard, system dialogs, action sheets and
   selection handles are drawn by the platform and take their look from that scheme, not from
   these tokens, so pinning it to dark — as it was — would have left a light preset with dark
   system chrome over a light app: the same half-applied look this decision set out to avoid.

   Not followed: fonts, which would mean loading remote font files at runtime, and the
   `mode` flag, which is redundant here because the palette's own colours already carry it.

10. **TanStack Query runs with `networkMode: 'always'`.** The default `'online'` mode gates
    every fetch and retry on `onlineManager`, which on React Native is only accurate if it is
    wired to NetInfo. Wiring it would add a native module for the sole purpose of letting the
    client decide not to try. Worse, a wrong guess is not a delay: the retry is *paused*, and
    a query paused before it recorded any result stays `pending` indefinitely, rendering as
    no data, no error and no spinner, with nothing to revive it. Reaching this server depends
    on the tailnet rather than on internet connectivity, so it is not a thing worth guessing
    at — the app issues the request and surfaces a failure as a retryable error.

11. **Uploads go one file at a time, and originals are sent unchanged.** The picker can
    return a whole camera roll, and several 2 GB transfers sharing one uplink would be slower
    in total and leave a progress bar that means nothing. Files are also sent at full quality
    rather than re-encoded: the point of putting them on your own server is keeping the
    original. Each file's outcome is read from the server's own answer — it sorts a batch into
    saved and rejected rather than failing the whole request — so one unsupported clip cannot
    cost you the rest of the selection.

12. **`metro.config.js` stays minimal and additive.** It appends the workspace root to
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
