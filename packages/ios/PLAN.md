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
- [ ] Library grid with authenticated posters (`/api/media/:id/poster`) and an image cache; search, filter toggles, sort sheet, category and tag chips; infinite scroll; pull to refresh
- [ ] Media detail: metadata, like (`/api/media/:id/like`), tags
- [ ] Video playback: `/api/media/:id/playback` (direct or HLS), AVPlayer with bearer header, resume and report progress (`/api/media/:id/progress`), Picture in Picture, background audio, playback error overlay
- [ ] Subtitles: track list and picker (see `captions.ts`)
- [ ] Photo viewer: `/raw` with width parameter (`image-width` logic), zoom and swipe

### Other tabs
- [ ] Collections list and detail (read-only)
- [ ] Clips list and clip player looping between in and out points (`/api/clips/:id/preview`)
- [ ] Downloads: background URLSession with bearer header, progress, cancel, retry, delete, offline playback, survives relaunch
- [ ] Upload from the photo library (`/api/upload/targets`, `/api/repositories/:id/upload`) with target picker and progress
- [ ] Settings: server, user, change password, sign out, version

### Finish
- [ ] Deep links `freewan://media/<id>` etc., kept through sign-in (`gate.ts`)
- [ ] Error, empty, offline and unreachable states on every screen; 20 s timeout surfaced
- [ ] Accessibility: labels and traits on icon-only controls, Dynamic Type, sheets clear of the home indicator
- [ ] Docs: rewrite `docs/15-mobile-app.md` for the Swift app; update README and CHANGELOG
- [ ] Remove `legacy/mobile-expo` and every reference to it (`packages/web/src/lib/theme.ts`, `packages/web/test/on-primary.test.ts`, `packages/web/tsconfig.json`, `.gitignore`); stop the loop

## Log

- Scaffold: FreeWANKit (ServerAddress, APIClient, Auth, Session, Keychain) with 10 tests; app with sign-in and a placeholder home.
- Forced password change: PasswordChange (rules, submit without signing out on a wrong current password, which the Expo app did); ChangePasswordView gates the app.
- Branding: RGBA colour maths and Palette derivation matching the web tokens (all 7 presets tested at 4.5:1); observable ThemeStore, cached per server; system fonts as before.
- Tab shell: MainTabs with a NavigationStack per tab, themed bars, placeholders for unbuilt tabs; Settings shows server, user and Sign out.
- Media list models: MediaCard, CategoryNode, Tag, SortChoice (7 orderings), MediaListQuery building `/api/media` paths with strict percent-encoding (a literal + survives), MediaAPI, duration formatting.
