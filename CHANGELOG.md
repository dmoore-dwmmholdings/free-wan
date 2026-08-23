# Changelog

Notes shown in the in-app Software updates panel. The release packager (`pnpm package`) embeds
the section whose heading contains the version being built.

## Unreleased

- There is now a native **iOS and Android app** alongside the web app. It browses the same
  library — search, folders, tags, likes, collections and clips — and can keep videos and
  photos on the phone to watch with the server switched off entirely. It is not delivered by
  this update: the app is built from `packages/mobile` and installed yourself, either from a
  local build or an APK, and [`docs/15-mobile-app.md`](docs/15-mobile-app.md) walks through
  both.
- To make that possible the server now accepts a session token as an
  `Authorization: Bearer` header as well as the usual cookie. The web app is unchanged and
  still uses its httpOnly cookie; a browser is never handed a token. The bearer form is
  returned only to a sign-in that asks for it, which sets no cookie in exchange, and both
  forms expire and are revoked identically. See
  [`docs/13-security.md`](docs/13-security.md).

## 0.6.1 - 2026-07-14
- Folder categories are now matched case-insensitively: `Movies/Action` and `movies/action`
  count as the same category (the first-seen spelling is kept for display). Existing libraries
  with case-duplicate categories are merged automatically on upgrade — items, sub-folders, and
  counts are combined under the original spelling.
- `config/repositories.yaml` now works as documented: on a first run (empty database) the
  libraries listed there are created and scanned automatically, so a fresh Docker deploy comes
  up with its drives already indexed — no admin UI trip required. The file is read once;
  afterwards libraries are managed in the admin UI as before (a library you delete stays
  deleted). Set `REPOSITORIES_FILE` to point somewhere else.
- The app can now be installed to a phone or desktop home screen (Add to Home Screen /
  Install app). The install carries your branding: the app's name, colors, and icon come from
  the Branding settings — an uploaded SVG logo is used as the icon, otherwise a monogram in
  your brand color is generated. The browser theme color also follows your branding now.
- Streaming quality is now tunable for slow remote connections: `TRANSCODE_MAX_HEIGHT` caps
  the transcode resolution (e.g. 720) and `TRANSCODE_MAXRATE_MBPS` the bitrate (default 6).
  Defaults keep today's behavior (source resolution). One rendition by design — a
  multi-bitrate ladder would multiply encode load per viewer on a home server.
- Photos in the gallery can now be zoomed: pinch on a touch screen (or double-tap /
  double-click) to zoom up to 4×, drag to pan while zoomed, and double-tap again to zoom back
  out. Swiping to the next photo works as before once you are zoomed out.
- The library grid is now virtualized: scrolling through thousands of items keeps the page
  light because only the rows on screen are actually rendered. Big libraries scroll smoothly
  instead of accumulating every card you have ever scrolled past.
- Command output now streams into the run console live over a WebSocket as the program writes
  it, instead of refreshing on a timer — long-running commands (downloads, re-encodes) show
  their progress the moment it happens. The timer refresh remains as a fallback.
- Commands now have a per-command concurrency cap (default 1, editable in the command editor):
  launching a command that is already running is politely refused instead of piling up parallel
  copies of heavy jobs like downloads or re-encodes.
- The Commands page now ships with three built-in maintenance actions — **Rescan all
  libraries**, **Rebuild missing thumbnails**, and **Clear transcode cache** — so routine
  upkeep is one click, no shell command definitions needed. They run inside the server (nothing
  is spawned), are admin-only until you grant them to users, and can be disabled but not
  deleted.
- The video transcode cache no longer grows without bound: least-recently-watched transcodes
  are evicted automatically once the cache passes a size cap (`TRANSCODE_CACHE_MAX_MB`,
  default 2 GB; a video you rewatch stays cached). Set it to 0 to keep the old
  clear-it-yourself behavior.
- Accessibility: the whole app now passes WCAG A/AA automated audits. Secondary text and
  highlighted chips/labels are easier to read (higher contrast), the default violet is a touch
  deeper so button text meets contrast guidelines, every control has a proper name for screen
  readers, and media cards are real buttons the keyboard can reach without like-button traps.
- Multiple people can now use the server at once reliably. Request-triggered media work
  (scrub previews, gallery thumbnails, image resizes) is deduplicated and capped at four
  ffmpeg processes instead of spawning one per request, thumbnails are written atomically so
  a half-finished image can never be served, and video transcodes no longer grab every CPU
  core — one person streaming stays smooth while another browses or watches. Verified with a
  two-user concurrent load test (zero errors, streaming p95 ~50 ms under full browse load).
- Scrubbing to the very end of a video now shows a preview thumbnail instead of nothing.
- "Up next" on the watch page now lists only videos — tapping a photo there led to an error
  page — and the Autoplay toggle actually advances to the next video when one ends.
- The clip builder can now play videos that need transcoding (HEVC, MKV, …); it previously
  showed a black, unplayable player for those sources.
- Mobile: Categories, Plugins, and Admin are now reachable from the account menu on phones
  (they had no navigation entry at all); the player scrubber can be dragged without the page
  scrolling along and the controls have finger-sized touch targets; the browse filter bar is
  a single swipeable row instead of stacking into a third of the screen; file details show
  "MP4" instead of raw ffprobe container strings, and long file paths wrap instead of
  overflowing.
- Searching a large library with a short prefix (which can match tens of thousands of items)
  no longer fails with a database variable-limit error.
- Files rejected during a multi-file upload (wrong type for the library) are no longer
  buffered whole in memory — a rejected 2 GB video used to cost 2 GB of RAM.
- Scanning big libraries is lighter: progress is reported per percent instead of per file
  (previously one database write and one WebSocket push per file), and category counts
  refresh with a single query instead of one per folder.
- Fixed updating from 0.5.x: the first 0.6.1 package needed a library that older installs
  don't have, so the new version crashed on start, the supervisor restored the previous
  version, and the panel showed "Restarting" forever. The dependency now ships inside the
  package, and when an update fails to start, the history correctly shows "Rolled back"
  with an explanation instead of hanging on "Restarting".
- Video Downloader plugin 1.2.0: fixed downloads silently doing nothing (yt-dlp's --print
  implies simulate mode — the job showed metadata, reported "completed", and saved no
  file); added a working Search mode (searches YouTube by default, or any yt-dlp
  "<site>search:" prefix, with a Download button per result); new settings for a cookies
  file (login/age/region-gated sites) and extra yt-dlp flags (impersonation, proxies).
- The video player's controls and title now fade out after a few seconds of inactivity
  while a video is playing (and the mouse cursor hides with them), then reappear on any
  mouse movement — they no longer sit on top of the picture the whole time. They stay put
  whenever the video is paused.
- "Add to collection" on a video now actually works: it opens a picker to choose an
  existing collection or create a new one, and adds the video on the spot. Previously it
  just linked to the Collections page and the video was never added.
- Clips can now be watched fullscreen — click a clip's preview to play it fullscreen with
  sound — and each clip now has a "Source" link back to the video it was made from.
- Fixed the clip fullscreen view being zoomed in / cropped: it now shows the whole frame
  (letterboxed) instead of the cropped-to-fill thumbnail framing.
- Fixed the plugin page being hard to use: the live auto-refresh could re-render the panel
  while you were typing or had a dropdown open, wiping input and snapping menus shut. The
  refresh now pauses while you're interacting with a plugin's form and resumes when you
  click away, so fields and dropdowns behave normally.
- Video Downloader plugin 1.3.0: it now installs yt-dlp for you automatically on first use —
  no server setup or command line needed — so it works out of the box for non-technical
  users. It downloads the right build for your server's OS, shows a one-time setup progress
  bar, and falls back to a clear message with a Retry button if the download fails. If you
  prefer to manage yt-dlp yourself, set its path in the plugin settings and that is used
  instead. (Auto-install also kicks in when you upload the plugin over an older version.)

## 0.6.0 - 2026-06-25
- New **Plugins** system. Admins can install sandboxed server extensions (from a server path, a
  URL, or an uploaded .zip) that read the library through a permission-gated API, contribute
  interactive panels, run on command, and react to events (new media, scan completed, clip
  created). Each plugin declares exactly what it can access, shown for approval at install time.
- Plugins appear on a new **Plugins** page with their interactive panels and one-click actions,
  built from a native design-system UI kit (no third-party code runs in your browser). A matching
  **Admin → Plugins** tab handles install, enable/disable, per-plugin settings, activity history,
  and uninstall.
- Plugins can run continuously (a daemon), on demand, or automatically on events — each run is
  sandboxed (clean environment, no server secrets, confined working directory, timeouts) and
  recorded for audit. Ships with three worked examples — Library Stats, New Media Logger, and a
  **Video Downloader (yt-dlp)** that fetches a video or playlist straight into a chosen library
  folder with live progress. See `docs/13-plugins.md`. Set `PLUGINS_ENABLED=false` to turn the
  subsystem off.

## 0.5.2 - 2026-06-25
- Mobile: the photo/video gallery no longer pushes the page wider than the screen. Its top bar is
  now responsive and the thumbnail filmstrip is hidden on phones (swipe, tap, or the arrows move
  between items), so nothing overflows. A layout-wide guard also stops any stray sideways scroll.
- Mobile gallery: videos no longer show the native control bar that re-appeared on top of every
  clip as you tapped through. Videos autoplay muted and loop; the gallery's own chrome handles
  navigation and the mute toggle lives in the top bar.
- The position indicator ("3 / 40") and the like/info/mute buttons now fit on a phone instead of
  overflowing off the edge and looking broken.

## 0.5.1 - 2026-06-24
- Branding logo now also shows on the admin pages (Repositories / Commands / Branding / System),
  which previously always displayed the built-in monogram regardless of your uploaded logo.
- Re-uploading a logo or favicon now takes effect immediately. The asset link is versioned, so the
  browser stops serving the old cached image — the favicon and logo update instead of appearing
  unchanged.
- Library autoplay previews now follow your scroll position: the video nearest the centre of the
  screen plays and keeps updating as you scroll (hovering still selects a specific one), instead of
  getting stuck on a single card. Fixes a case where, after the first frame, the preview would
  never move off the first card.

## 0.5.0 - 2026-06-24
- Fullscreen now works on phones: the player falls back through the WebKit / iOS fullscreen paths
  (where only the video element can go fullscreen), so the fullscreen button works on mobile, not
  just desktop.
- Photos/mixed gallery: tapping the on-screen buttons — or the video's own native controls,
  including its fullscreen button — is no longer mistaken for a "previous/next" tap. Only taps on
  the empty backdrop navigate, so the left/right controls are reliable.
- Admins can now create, edit, and delete commands from the UI (Admin → Commands) instead of only
  through the API. The editor covers parameters, the argument template, limits, and who may run it,
  and lists the server's allowlisted executables.
- The Categories tab now opens a real folder browser — drill through your library's folders and
  jump into any one — instead of just reopening the main library.

## 0.4.0 - 2026-06-24
- Hover-to-preview in the library: hovering a video plays a silent preview that walks through
  five-second snippets sampled across the whole clip — a quick trailer so you can tell what it is
  before opening it. Move the mouse away and the last one you hovered keeps playing.
- Touch devices preview too: with no mouse to hover, the video closest to the centre of the screen
  previews as you scroll, so the feed always shows one playing clip.
- Volume is now shared across the whole app and remembered. Unmute or set the level in the gallery
  and the next video you open matches it; the choice also survives a reload. Inline previews stay
  silent regardless.
- Scrub-bar thumbnails: hovering or dragging the player's progress bar now shows a frame preview
  with its timestamp, so you can see where you're seeking before you let go. Frames are generated on
  demand and cached, and it works for both direct-play and transcoded videos.

## 0.3.0 - 2026-06-22
- Player & media views now fit the screen: the theater player is height-capped so its controls
  are always visible without scrolling, and media uses contain-fit instead of overflowing.
- Mobile: the Browse filter/tab bar now grows when its chips wrap instead of overflowing and
  laying over the content below it.
- Video controls fixed: fullscreen now works (including iOS Safari, which only allows the video
  element to go fullscreen), alongside play/pause, scrub, volume, speed, and captions.
- Photos/mixed: videos opened in the gallery now autoplay (muted, looping) reliably — the muted
  flag is set as a property so the browser permits autoplay.
- Gallery slideshow now advances immediately and loops, so the play button gives instant feedback
  instead of appearing to do nothing.
- The in-app Back button on a video/detail page now preserves your library filters (matching the
  browser Back button) instead of resetting to the unfiltered library.
- Fixed invalid nested-button markup on library cards (the like button inside a clickable card),
  which produced console errors and could make taps unreliable.
- Admin navigation: the Branding and System pages were only reachable by typing the URL. The admin
  pages now share a Repositories / Branding / System tab bar, so the update uploader is easy to find.

## 0.2.0 - 2026-06-22
- New interface & brand system: the UI is reworked around the FreeWAN design system — an
  F-monogram logo, a runtime design-token palette, and a top-bar + side-navigation app shell.
- Theming studio (Admin → Branding): seven brand presets (Midnight, Slate, Forest, Ember, Neon,
  Paper, Linen) with live color, mode, corner-radius and font controls and an instant preview
  that retunes the whole app.
- Every screen restyled — Login, Browse, the Theater player, Gallery, Collections, Clips,
  Commands (with live run output), and the admin pages.
- Brand typefaces (Space Grotesk, Hanken Grotesk, IBM Plex Mono) are self-hosted, so the app
  makes no external font requests and renders fully offline.
- Fix: login now works over plain HTTP on the tailnet. The session cookie's `Secure` flag now
  tracks the real request scheme instead of `NODE_ENV`, so it is no longer silently dropped by
  the browser over http — which had left first-login stuck at "authentication required" on the
  change-password step. Behind TLS (e.g. Tailscale Serve) the cookie is still marked `Secure`.
- Native HTTPS: set `TLS_CERT_FILE` and `TLS_KEY_FILE` to have the server speak TLS directly
  (no proxy needed). A bundled `tls-cert` subcommand (`node packages/api/dist/index.js tls-cert`)
  fetches a browser-trusted certificate from Tailscale. See docs/12-deployment.md §6.5.

## 0.1.0 - 2026-06-21
- Initial self-updatable release: upload a package in System to update; configuration and data
  are preserved across updates.
