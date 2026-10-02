# Swift rewrite plan

Native SwiftUI replacement for the Expo app, which sits in `legacy/mobile-expo/` as the
reference for behaviour until this list is done. Work top to bottom; one item (or a coherent
part of one) per pass.

## Rules for each pass

- Read the legacy code for the feature first (`legacy/mobile-expo/app`, `src/lib`, `src/components`,
  `test/`) and the server routes it calls (`packages/api/src/routes`, `packages/shared/src`).
  Match the server's real JSON shapes, not the legacy TypeScript's assumptions.
- Platform-independent logic (models, request building, parsing, formatting, state machines)
  goes in `FreeWANKit` with tests. UI goes in `App/`.
- Verify with `bash packages/ios/scripts/test-kit.sh`: kit tests must pass and every app source
  must parse. App code cannot be type-checked here, so re-read it for compile errors against the
  iOS 17 SDK, Swift 5 language mode, before committing.
- No emojis anywhere. SF Symbols for icons.
- Tick the item, add a line to the log below, commit, push.

## Checklist

### Foundation
- [x] Scaffold: kit package, XcodeGen spec, sign-in, Keychain session, 401 signs out
- [x] Forced password change when `mustChangePassword` (`/api/auth/password`), before anything else shows
- [x] Branding: `/api/branding` presets and colours into a theme (match on-primary rule in `legacy/.../palette.ts` and `packages/web/src/lib/theme.ts`), app name; cache last branding for offline launch
- [x] Tab shell: Library, Collections, Clips, Downloads, Settings

### Library
- [x] Media list models and query building (`/api/media` paging, search, type filters, the sort orderings, categories `/api/categories`, tags `/api/tags`)
- [x] Library grid with authenticated posters (`/api/media/:id/poster`) and an image cache; search, filter toggles, sort sheet, category and tag chips; infinite scroll; pull to refresh
- [x] Media detail: metadata, like (`/api/media/:id/like`), tags
- [x] Video playback: `/api/media/:id/playback` (direct or HLS), AVPlayer with bearer header, resume and report progress (`/api/media/:id/progress`), Picture in Picture, background audio, playback error overlay
- [x] Subtitles: track list and picker (see `captions.ts`)
- [x] Photo viewer: `/raw` with width parameter (`image-width` logic), zoom and swipe

### Other tabs
- [x] Collections list and detail (read-only)
- [x] Clips list and clip player looping between in and out points (`/api/clips/:id/preview`)
- [x] Downloads: background URLSession with bearer header, progress, cancel, retry, delete, offline playback, survives relaunch
- [x] Upload from the photo library (`/api/upload/targets`, `/api/repositories/:id/upload`) with target picker and progress
- [x] Settings: server, user, change password, sign out, version

### Finish
- [x] Deep links `freewan://media/<id>` etc., kept through sign-in (`gate.ts`)
- [x] Error, empty, offline and unreachable states on every screen; 20 s timeout surfaced
- [ ] Accessibility: labels and traits on icon-only controls, Dynamic Type, sheets clear of the home indicator
- [ ] Docs: rewrite `docs/15-mobile-app.md` for the Swift app; update README and CHANGELOG
- [ ] Remove `legacy/mobile-expo` and every reference to it (`packages/web/src/lib/theme.ts`, `packages/web/test/on-primary.test.ts`, `packages/web/tsconfig.json`, `.gitignore`); stop the loop

## Log

- Scaffold: FreeWANKit (ServerAddress, APIClient, Auth, Session, Keychain) with 10 tests; app with sign-in and a placeholder home.
- Forced password change: PasswordChange (rules, submit without signing out on a wrong current password, which the Expo app did); ChangePasswordView gates the app.
- Branding: RGBA colour maths and Palette derivation matching the web tokens (all 7 presets tested at 4.5:1); observable ThemeStore, cached per server; system fonts as before.
- Tab shell: MainTabs with a NavigationStack per tab, themed bars, placeholders for unbuilt tabs; Settings shows server, user and Sign out.
- Media list models: MediaCard, CategoryNode, Tag, SortChoice (7 orderings), MediaListQuery building `/api/media` paths with strict percent-encoding (a literal + survives), MediaAPI, duration formatting.
- Library grid, part 1: generic Pager (stale pages dropped, duplicates across pages skipped), APIClient.data, AuthImage with a decoded-image cache, adaptive grid with search, infinite scroll, pull to refresh, empty and error states. Left: filter toggles, sort sheet, category and tag chips.
- Library grid, part 2: liked/video/photo toggles, sort menu, folder trail chips, tag chips; CategoryTrail and filter-specific empty messages in the kit.
- Media detail: MediaDetail model, like via PUT/DELETE with optimistic update and rollback that also updates the grid tile, tags, file details; poster stands in for the player until playback lands.
- Video playback: PlaybackDescriptor, progress reporting policy (10 s, on pause, on background, on leaving) and resume rule in the kit; AVPlayer with the token on every request via AVURLAssetHTTPHeaderFieldsKey, AVPlayerViewController (PiP, AirPlay), audio session and background mode, error overlay with retry. Leaving the detail screen stops playback, PiP included.
- Subtitles: WebVTT parser and cue lookup in the kit (ported edge cases), 120 s fetch timeout for on-demand extraction; captions drawn in AVPlayerViewController.contentOverlayView so they show in full screen; picker under the video, off by default.
- Photo viewer: PhotoSize width buckets in the kit; detail shows a screen-sized copy in its own aspect; full-screen pager over the loaded photos with UIScrollView pinch and double-tap zoom, swapping in the original past 1.5x.
- Collections: MediaCollection (not Collection, which clashes with the Swift protocol), list with cover and counts, detail as a media grid in the collection's own order.
- Clips: Clip, ClipPreview and the loop rule in the kit; list with poster, span and orphaned notice; player seeks to the in point and loops or stops at the out point via a 0.1 s time observer.
- Downloads, part 1: DownloadJob/Record/Index/file naming in the kit (extension kept so AVPlayer recognises local files); DownloadManager on a background URLSession with the job in taskDescription, reconnect on launch, orphan sweep, cancel, retry, delete, poster cached; AppDelegate hands over background wake-ups. Left: Downloads tab, download button, offline playback.
- Downloads, part 2: Downloads tab (in progress with stop/retry/dismiss, downloaded with sizes and swipe to delete, offline player and photo view), download button on the detail screen, player prefers the downloaded file and falls back to it when the server is unreachable, offline hint on the library error.
- Upload: targets, outcome reading (202 saved, 422 skipped, both with a body), batch summary and an on-disk multipart writer in the kit; PhotosPicker (no permission prompt), library choice when there are several, one file at a time with progress and Stop, summary alert, grid reloads after.
- Settings: account and role, change password, server address and version (/api/health), downloads count and storage, app version, sign out with a confirmation that downloads stay.
- Deep links: DeepLink parsing (both freewan://kind/id and freewan:///kind/id) and MediaDetail.card in the kit; AppModel holds the link through sign-in and a forced password change; tabs switch and push the item, with an alert when it is gone.
- Error states: ErrorText in the kit (timeout names the 20 s limit, unreachable, signed out, not found, server fault, unexpected answer); ErrorStateView with Try again and the downloads hint when offline, ErrorBanner for failed refreshes and pages over existing content, on every list; shared wording on sign-in, detail and playback; ComingSoon removed.
