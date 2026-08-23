# 15 — Mobile app

`packages/mobile` is a native iOS and Android client built with Expo and React Native. It
talks to the same REST API as the web app and shares types through `@free-wan/shared`, so
there is one contract to keep in sync rather than two.

The reason it exists rather than a PWA: **offline downloads**. Saving a video to the device
and playing it with the server unreachable is not something a browser does well, and it was
the point of the app.

---

## What is in it

Five tabs:

| Tab | What it holds |
|---|---|
| **Browse** | The library. Search, folder navigation, tag filters, toggles for liked-only, videos-only and photos-only, and the same seven orderings the web app offers. The button in the corner uploads photos and video from this phone. |
| **Collections** | Collections made on the web app; open one to see its contents. |
| **Clips** | Clips cut on the web app; open one to play its segment. A clip saved to loop repeats; one saved not to stops at its out-point and rewinds, so it is ready to play again. |
| **Downloads** | What is saved on the device, what is transferring, and what failed. |
| **Settings** | Who you are signed in as, which server, how much storage downloads use, and sign out. |

Opening any item gives a player or a photo, its tags, a like button, a Download button, and
a subtitles button when the video has caption tracks.

A video keeps playing when you leave the app or lock the phone, and can be put into a
picture-in-picture window. Both are asked for in the player's own settings, and both also have
to be granted in the build — `expo-video`'s config plugin adds the iOS background mode, and on
Android the foreground service, its two permissions and the activity flag that allows PiP. The
plugin does none of that unless it is given `supportsBackgroundPlayback` and
`supportsPictureInPicture`, so the options in `app.json` are not decoration: without them the
code asks for both and neither happens.

Coming back to the app after leaving it refreshes what has gone stale, so media added, liked
or renamed from the web app in the meantime appears without a pull to refresh. Switching away
for a moment costs nothing — only data older than thirty seconds is fetched again.

Liking something updates every view it appears in without going back to the server — the
response already says what the new count is. One consequence is deliberate: unliking while the
liked-only filter is on leaves the item on screen with an empty heart rather than snatching it
away under your finger, so a mistap can be undone. The list puts itself right next time it is
opened.

Filters combine rather than replace each other: a folder, a set of tags and liked-only all
narrow the same list. Selecting several tags narrows to items carrying *all* of them, which
is how the API combines them. Videos-only and photos-only are one choice, not two switches.

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

If the account still carries the password it was created with, the app asks for a new one
before it will show anything, the same as the web app does. Changing your own password is the
only account action here; everything else stays on the web app. If the server cannot be
reached the flag is unknown and the app carries on. Worth being plain about what that means:
the server does not enforce this rule — it reports the flag and clears it, but refuses no
request because of it — so this app and the web app both honour it by choice. Carrying on
offline keeps downloads you already hold reachable, and the flag is there to move you off a
starting password rather than to stop someone who already has valid credentials.

---

## Offline downloads

Tapping **Download** on any item saves the media and its poster under the app's document
directory, with an index in `AsyncStorage`.

A downloaded item plays entirely from the device: the screen skips the `/playback` request
and points the player at the local `file://`, so it works with the server switched off.
A download that never finished — the app was force-quit, or the phone restarted partway
through — leaves its bytes behind, since the record that would claim them is only written on
success. Starting the app clears anything in the download folder that no download accounts
for, which is the only thing that would ever notice: both the Downloads tab and the storage
figure in Settings count records, not files.

Photos are downloaded at full resolution, not as thumbnails. Viewing one is different: the
screen asks the server for a copy fitted to the phone rather than the whole original, which for
a 4032-pixel-wide photo is 54 KB instead of 638 KB. It falls back to the original when that is
already the smaller file, since the server's resizer will happily enlarge one.

Three behaviours worth knowing:

- If the OS reclaims a file to free space, its record is dropped when the app next loads its
  index, rather than leaving an entry that fails to open.
- A transfer that fails leaves no record behind, so a broken download never looks complete.
- Stopping a transfer deletes the partial file, so an abandoned download does not quietly
  consume storage that nothing accounts for.
- A failure is shown rather than swallowed. Leaving the tailnet mid-transfer is ordinary, so
  the item says it failed and why, and tapping it starts again. Failures are held in memory
  only: after a restart the item simply offers Download again.

The Downloads tab lists failures first, then transfers still running, then what is on disk.
A transfer in progress can be stopped, from the cross on its row in the Downloads tab or the
Stop control on the item's own screen. Stopping discards what had been written — there is no
resuming a part-finished file — and the item goes back to offering Download rather than
reporting a failure, since you are the one who stopped it.

---

## Uploading from your phone

The button in the bottom corner of Browse puts photos and video from the phone into your
library — the one thing this app does that the web app cannot do as well, since the phone is
where the pictures are.

Tapping it asks for photo access the first time, then opens the picker. Select as many items
as you like, up to 50 in one go. If more than one library on your server accepts uploads, it
asks which one; if only one does, it just starts.

Files are sent one at a time, at full quality — they are not re-encoded, because keeping the
original is the point of putting it on your own server. The button shows which file is going
and how far along it is.

They land in an `Uploads` folder inside the library you chose, which also becomes their
category. The server then indexes them, so give it a moment and pull down to refresh before
they appear.

A few things worth knowing:

- One file failing does not abandon the rest. Anything rejected is listed by name with the
  reason — an unsupported type, or too large — so a single odd clip cannot cost you the whole
  selection.
- Photos and videos do not always come out of the picker with a name. Where there is none the
  app makes one, taking the file type from the URI when it carries one and from the kind of
  media when it does not. The name matters: the server uses the extension to decide what a
  file is whenever it cannot tell from the upload itself.
- A library has to be writable and hold images or video to accept uploads. If none does, the
  app says so rather than failing at the end.
- The server accepts up to 50 files per batch and 2 GB per file.
- Uploading is the only writing this app does besides changing your own password. Renaming,
  tagging and organising what you uploaded still happen on the web app.

---

## Subtitles

If a video has caption tracks — a sidecar `.srt` or `.vtt` beside the file, or subtitles
embedded in the video — a speech-bubble button appears next to Download. One track toggles on
and off; several open a list with an Off entry. Captions start off.

They are drawn by the app rather than handed to the player, because `expo-video` has no way
to attach an external subtitle file and this server keeps captions as separate WebVTT. Doing
it this way also means captions work for files that direct-play, not only ones served over
HLS.

Two consequences worth knowing:

- A downloaded video has no captions when the server is unreachable. The track is fetched
  from the server, and it is not saved alongside the media.
- Captions are styled by the app, so they will not follow the caption size or colour settings
  configured in iOS or Android.

If a caption file fails to load, the video carries on without it rather than interrupting
playback.

---

## Branding

The app takes its name and colours from your server. Whatever an admin picks in the web app's
Branding studio — one of the presets, or a custom palette — the app retunes to match, light
presets included, and the login screen is already branded before you sign in.

Colours the server does not send are worked out the same way the web app works them out, so
the two match rather than merely resemble each other. Two things are deliberately left alone:
subtitles stay white-on-black and the duration badge on a thumbnail stays a dark pill, because
both sit over arbitrary artwork and have to stay readable whatever the palette is.

The platform's own chrome follows the brand too — the keyboard, system dialogs, action sheets
and text-selection handles take their look from the app's colour scheme rather than from our
tokens, so it is set from the palette instead of from the phone. Without that a light preset
could hand you a dark keyboard and a dark alert over a cream screen.

Not followed: the fonts an admin picks, which would mean fetching font files at runtime, and
the installed app's own name and icon, which are fixed at build time in `app.json`. If the
server cannot be reached, the built-in palette is used and the app carries on.

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

What the app asks your phone for, and what it deliberately does not: internet access, storage
on Android versions old enough to need it for the picker, and your photo library when you tap
Upload. It does **not** ask for the camera, the microphone, or Face ID. Each was being declared by a
library's defaults rather than by anything the app does: `expo-image-picker` adds the first
two because it can also take a photo, and `expo-secure-store` adds a Face ID string because
storage *can* be put behind biometrics. This app only opens the photo library and stores its
token plainly, so all three are off in `app.json`. An app for watching your own films has no
business asking to hear you.

On Android the token is also kept out of backups: `expo-secure-store` excludes its store from
cloud backup and from device-to-device transfer, so signing in on one phone does not carry the
session to another.

You can see the whole evaluated set without building anything:

```bash
pnpm --filter @free-wan/mobile exec expo config --type introspect --json
```

That applies every config plugin and prints the resulting `ios.infoPlist`, which is the only
way to check the iOS half from Windows — `expo prebuild` refuses to generate `ios/` anywhere
but macOS or Linux.

Building it also needs things Expo Go does not: the Android SDK, and a JDK the React Native
Gradle plugin supports — 17 at the time of writing, not whatever is newest.

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
- Tags can be filtered on and are shown per item, but not created or edited

---

## Screen readers

Every control the app draws carries a name and announces itself as a button, and the two
things that are only icons — the cross that stops a transfer and the speech bubble that turns
subtitles on — say what they do and what state they are in rather than reading as a picture.
Tiles and rows that open something are links rather than buttons, which is what they are.

The bottom sheets need a note, because React Native's default works against them. A
`Pressable` is an accessibility element unless it is told not to be, and an element hides its
own children, so the two sheets — choosing a library to upload to, choosing a subtitle track —
were each announced as one shape with nothing reachable inside. Both the backdrop and the
sheet itself are now marked as not being elements, which leaves the rows individually
reachable and still lets a tap on the backdrop dismiss.

---

## Troubleshooting

**"Project is incompatible with this version of Expo Go."** Your Expo Go expects a different
SDK. Either install an Expo Go matching SDK 54, or upgrade the project with
`npx expo install expo@latest --fix` and check the notes below about `expo-file-system`.

**The app cannot reach the server.** Check the address in Settings. On Android a plain-HTTP
server needs the cleartext permission, which `expo-build-properties` sets in `app.json` —
this only applies to a real build, not to Expo Go.

**A blank screen with nothing in it at all.** Not the error screen — genuinely nothing. That
means the root threw before anything mounted, so the component that would draw an error never
got the chance. It happened once here: a platform call that React Native types as always
present is not implemented on every platform, and calling it during the first render took the
whole app down. If a change touches the root layout, check it renders somewhere before
trusting a green build; `tsc` and a successful bundle both pass straight through this.

**Expo Go loads, but not the app you think.** Metro serves your working tree as it is at the
moment of the request, not a build. A dev server left running picks up every edit in between,
including ones you made temporarily and meant to undo. If the phone is showing behaviour that
does not match the code, restart `expo start` before looking any further — and prefer a fresh
server over one that has been up for hours, which can also end up resolving from the wrong
project root and answering bundle requests with `Unable to resolve module ./index`.

**Typed routes break after adding a screen.** `.expo/types/router.d.ts` is generated by the
running dev server and appended to incrementally, so a route added while it runs can be
classified wrongly and files outside `app/` can leak in as routes. Delete `.expo` and restart
`expo start`. The file is gitignored, and a fresh clone typechecks without it.

**A screen shows neither content, an error, nor a spinner.** This was a real bug and is
fixed, but the shape is worth recognising. TanStack Query's default `networkMode: 'online'`
pauses a retry when it believes the device is offline, and a query paused before it ever
recorded a result stays pending forever — no remount, tab switch or refocus revives it. The
app now runs with `networkMode: 'always'` (see `src/lib/query.ts`), so a request is attempted
and a failure is reported as a failure.

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
handling, formatting, the API request layer, the download manager, WebVTT parsing and cue
timing, the branding colour arithmetic — including a contrast check on every preset — when
branding is fetched and re-fetched, where playback starts and why it is decided only once,
where the auth gate sends someone, how a clip behaves at its out-point, and the library's
pagination — that each filter has its own cache key, and that the list stops asking for pages
once the server says there are none left. Both of those fail silently rather than loudly: a
shared key shows one filter another's results, and a cursor that never resolves to
`undefined` refetches the last page forever.

The download tests run against an in-memory filesystem stub that can report progress, hold a
transfer open midway, hold the poster fetch that follows it, fail a transfer, fail a *cancel*
midway, and evict a file behind the app's back, so the manager's real behaviour is exercised
without a phone. Holding the poster is what makes the awkward case reachable: a cancel that
arrives when the media file is already written and the record is not. The branding tests drive
`startBranding` with a fake session and a fake server, because every defect this feature has
produced has been in *when* things happen rather than in any single line: a first launch with
no server stored, a sign-in that creates one, a move to a different server, a fetch that
fails and is retried, and a server that accepts the connection and then says nothing. The cancel path is
covered this way but its buttons are not: the Downloads tab's cross and the Stop control only
appear while a transfer is running, and `expo-file-system` has no web implementation, so the
browser harness used for the rest of the UI cannot reach that state. Those two controls need
a device. The request-layer tests drive a stubbed `fetch`,
covering the cases a proxy in front of the server produces — an HTML error page, a 401 that
is not JSON — which are the ones that used to be mishandled.

### Looking at it in a browser

The app also builds for web, which nothing ships — it is how the screens get looked at while
they are being changed:

```bash
pnpm --filter @free-wan/mobile exec expo export --platform web --output-dir <dir>
```

`expo-video` cannot play here and `expo-file-system` does nothing, so playback, downloads and
uploads are all out of reach. Posters do not load either, and the console fills with
`NetworkError ... at componentDidMount` because of it: react-native-web's `Image` drops the
headers on a source, so every thumbnail request goes out unauthenticated and the server
answers 401. On a phone `Image` does send them, which is the whole reason this app carries a
bearer token rather than a cookie. Grey tiles and those errors in a browser are expected and
are not worth chasing. Everything else behaves as it does on a phone: layout,
navigation, the auth gate, branding, filters, pagination and every empty and error state,
which is most of the app. `src/lib/secure-store.web.ts` is what makes it reachable past the
login screen, since there is no keychain in a browser; `localStorage` is not one either, and
would not be acceptable in anything shipped to a browser.

`harness-up.sh` builds for production, which is the right default — it is what ships — but it
means React's development warnings are compiled out, so a console that looks clean there proves
nothing about duplicate keys, invalid props or hook-order faults. To look for those, export with
`--dev --no-minify` into a separate directory and serve that instead. Two things are worth
knowing before trusting the result: the browser extension's console capture reads `console.error`
but not `console.warn` (React's own warnings are errors, so they come through; other libraries'
do not), and a zero is only worth having after a deliberate probe has proved the capture is live.

Restart the API after a rebuild. The script deletes and recreates `packages/web/dist`, and a
server that was already serving that directory then answers every asset with `index.html` —
which looks exactly like the app crashing on load, a blank page with no requests behind it.

It is safe to do this while `expo start` is running. It was not always: the web session used
to be arranged by editing `src/lib/session.ts` before a browser run and putting it back
afterwards, and because Metro serves the working tree live, a phone connected to the dev
server was running the edit. Worse, it made checking a change and leaving something scannable
mutually exclusive — and a change that skipped the browser for that reason shipped a crash
that left the app on a blank screen.

---

Accessibility is checked in the browser rather than by test: a sweep over every button, link
and input on all eight screens, failing anything without a name. It was worth running — the
three text fields had none at all, and on the change-password screen there was no placeholder
to fall back on either.

One test reads both sides of a contract rather than exercising code: it collects every
`/api/...` path this app asks for and every route the server registers, and fails if a path
has no route. This is checked because it has gone wrong before — an early version called an
endpoint that was never written, and neither `tsc` nor a stubbed-`fetch` test can see that,
since a URL is only a string.


## Checking it on a phone

Some of this app cannot be checked anywhere but on a phone, and that part has been built and
reasoned about carefully but never watched working. Playback is the root of most of it: the
browser harness cannot load a video at all, because `expo-video`'s web build never requests
the stream, so the player never reports itself ready and everything hanging off that — the
resume, the subtitle clock, the message shown when a source fails — never runs either. File
I/O and the keychain are the other two: `expo-file-system` and `expo-secure-store` do nothing
in a browser, which is why the download manager is exercised against a virtual filesystem.

A run through the following settles it. Each says what should happen, and they are ordered by
what would be worst if it were wrong.

1. **Play a video.** Nothing below matters until this does.
2. **Watch a few minutes, leave, and come back to it.** It should resume where you stopped,
   once, without a second jump after it starts.
3. **While it plays, switch to another app for a minute, then switch back.** The playhead must
   not move backwards. This is the failure that was fixed without ever being seen.
4. **Turn on aeroplane mode mid-playback.** The frame should say why it stopped and offer to
   try again — and trying again should pick up where it broke, not at the beginning.
5. **Download something large, and press Stop halfway.** It should disappear, leaving no file.
   Then download it again and press Stop in the second *after* the progress bar fills: the
   item should either finish cleanly or vanish cleanly, never appear as a download that will
   not open.
6. **Kill the app, turn the server off, reopen, and play that download.** It should play, and
   resume where you left it if it had been played before.
7. **Open a clip.** It should start at its in-point and hold at its out-point, looping or
   stopping as the clip says.
8. **Turn subtitles on.** The words should land on the right ones.
9. **Upload from the camera roll.** The picker, the which-library sheet and the transfer are
   all untried: `expo-image-picker` opens the platform's own file dialog, and the upload task
   has no web implementation. Send several at once, including a video.
10. **Open a big photo.** It should appear quickly; the app asks for a copy fitted to the
    screen rather than the original.
11. **Sign out and back in.** The token goes to the keychain, which has never been written to.
12. **Point it at a server that is not running.** Every screen should say it cannot reach the
    server, and none should claim your library is empty.
13. **Turn on VoiceOver or TalkBack and change your password.** All three fields should name
    themselves.


```bash
pnpm --filter @free-wan/mobile build
```

bundles the app for both platforms through Metro, writing to `dist/`. This is what catches
module-resolution problems, which `tsc` cannot see: pnpm's layout, a missing peer, a bad
`metro.config.js`. CI already runs `pnpm -r build`, so it is covered there — before this
script existed the mobile package had no build step and Metro was never exercised on CI at
all.
