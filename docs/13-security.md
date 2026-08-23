# 13 — Security

Free-WAN is private by default and runs on the owner's hardware, but it (a) can be reached
over a tailnet (and optionally the public internet via Funnel) and (b) **executes the
owner's CLI commands**. This doc is the normative security model. Satisfies NFR-06/07 and
backs FR-55.

## 1. Trust model

- **Tailnet is a perimeter, not the only control.** Even reachable only over Tailscale,
  every endpoint (except login, public branding, health) requires authentication. Assume a
  device on the tailnet could be shared or compromised.
- **Admins are trusted to define commands**; **command *arguments* from any user are
  untrusted** and validated. Non-admins are semi-trusted: they browse and, only if granted,
  run a subset of commands.
- **The filesystem is authoritative and sensitive**: repositories may sit alongside
  unrelated files; nothing outside a repository root may be read or written via the app.

## 2. Authentication & sessions (FR-58–60)

- Passwords hashed with **Argon2id** (memory-hard) with per-user salts; never stored or
  logged in plaintext. The bootstrap admin password comes from env on first run and must be
  changed in-app (prompt until changed).
- Login issues an **opaque session token** stored server-side (`sessions` table) and set as
  an **httpOnly, Secure, SameSite=Lax** cookie. Sessions expire (sliding/absolute) and are
  individually revocable (logout, admin disable). Prefer opaque server sessions over
  stateless JWT so revocation is immediate.
- The same token is also accepted as **`Authorization: Bearer <token>`**. The mobile app
  needs this: it hands URLs to `expo-video` and `expo-file-system`, which request outside the
  JavaScript layer and carry headers, not cookies. The header is not unsigned or verified
  differently — it *is* the session id, and the cookie's signature is tamper/CSRF defence for
  browsers rather than a secret. Revocation, expiry and the disabled-user check apply
  identically, because both paths go through the same `resolveSession`.
- A browser never receives the token. It is returned only for a login that opts in with
  `client: "native"`, which sets no cookie in exchange — so script running in the web app
  cannot lift a bearer token, and cannot mint one without the password.
- **Login rate-limiting** and generic failure messages (no user-enumeration). Lock/backoff
  after repeated failures from an IP/identity.
- CSRF: cookie auth + state-changing routes require either `SameSite=Lax` + a custom
  header the browser only sends same-origin, or a CSRF token. Media `<video>`/`<img>` GETs
  are same-origin and safe. The bearer path does not widen this: a cross-origin page cannot
  set an `Authorization` header on a request the browser sends automatically, so a bearer
  session is not reachable by CSRF at all.

## 3. Authorization

- Middleware resolves the session → user on every request; **deny by default**. Admin
  routes (`/api/admin/*`) require `role=admin`. Command execution checks per-command
  `allowNonAdmin` **and** the user's `canRunCommands` (FR-56).
- User-owned resources (collections, clips, runs, progress, likes) are scoped to
  `user_id`; one user can never read or mutate another's (FR-61) — enforced in queries, not
  just the UI.
- **The mobile app's session token is excluded from Android backups.** `expo-secure-store`
  ships backup rules that exclude its store from both cloud backup and device-to-device
  transfer, and the generated manifest points at them. A token therefore does not travel to a
  new phone with a restore; whoever holds the new device has to sign in.
- **`must_change_password` is a client-side rule, not a server-side one.** It is set for the
  bootstrap admin and for any password an admin resets, reported by `/api/auth/login` and
  `/api/auth/me`, and cleared when the password changes. No route refuses a request because of
  it: `authenticate` and `requireAdmin` check the session and the role and nothing else. The
  web app and the mobile app each block their own routes until the password is replaced, so a
  request made outside either client — `curl` with a valid cookie or bearer token — is not
  blocked. This is adequate for what the flag is for, which is moving someone off a starting
  password rather than defending against someone who already holds valid credentials. Making
  it a real boundary means rejecting every request except the ones needed to change the
  password (`/api/auth/me`, `/api/auth/password`, `/api/auth/logout`, `/api/branding`); that
  has not been done.

## 4. Path safety (no traversal) — applies to media *and* commands

A single hardened resolver guards all filesystem access:

1. Start from a known **allowed root** (a repository root, or a `data/` subdir, or a
   command's `workingDir`/`repo_path` repository).
2. Join the untrusted segment, then `realpath` the result (resolving symlinks).
3. Assert the resolved path is **inside** the allowed root (prefix check on the
   canonicalized root, with a trailing separator to avoid `/media/a` matching
   `/media/abc`).
4. Reject on any failure, on `..` that escapes, on symlinks pointing outside, and on
   absolute paths supplied where a relative one is expected.

Media is addressed by `id`; the server maps `id → repository + rel_path` and runs it
through the resolver before opening a stream. Clients never send or receive absolute host
paths.

## 5. Command execution sandbox (FR-55) — normative

The command runner is the sharpest edge. All of the following are **required**:

1. **No shell, ever.** Use `child_process.spawn(executable, argvArray, { shell: false })`.
   Never `exec`, never `sh -c`, never string interpolation into a command line. User
   values are individual argv entries, so shell metacharacters (`; | & $ \` > <`) are inert
   data. (See [`11-feature-commands.md`](11-feature-commands.md) §4.)
2. **Executable allowlist.** `executable` must be on `commands.allowedExecutables` (config)
   or an admin-approved absolute path that exists. Form input can never name the
   executable.
3. **Typed, validated arguments.** Every submitted value is checked against its parameter
   schema (type, `min/max`, `pattern`, `enum options`) server-side before building argv.
   `repo_path` values pass through the §4 resolver and must stay within their declared
   repository.
4. **Working-directory jail.** `cwd` resolves within an allowed root; default to a per-run
   temp dir when unspecified. The process cannot be launched with an arbitrary cwd.
5. **Clean, allowlisted environment.** Spawn with a minimal env (`PATH`, `HOME`, plus the
   command's `envAllowlist`); do **not** inherit the server's full environment (which may
   hold secrets like `FW_SESSION_SECRET`, `TS_AUTHKEY`).
6. **Timeout & cancellation.** Enforce `timeoutS` (SIGTERM then SIGKILL); expose
   user-initiated cancel. Track and kill orphaned children (use a process group / `detached`
   + kill the group).
7. **Output cap.** Stop buffering/persisting past `maxOutputKb`; mark `truncated`. Prevents
   memory/DB exhaustion from chatty processes.
8. **Concurrency cap.** `commands.maxConcurrent`; excess runs queue. Prevents fork-bomb-by-
   clicking.
9. **Least privilege.** The container runs as **non-root** (`USER node`); the command
   inherits that. Drop Linux capabilities; consider per-run `ulimit`/cgroup limits (CPU
   time, file size, process count) and a read-only root FS with only `data/`,
   repositories, and a temp dir writable.
10. **Full audit.** Persist who ran what, the submitted args **and** the resolved argv,
    exit code, and timing (`command_runs`). Internal commands (rescan, etc.) are recorded
    too.

> **Residual risk to state plainly:** a command is, by design, code the **admin** chose to
> run. Free-WAN constrains *how* it runs (no shell, validated args, jail, limits, least
> privilege) but a malicious or reckless *command definition* by an admin is outside the
> tool's control — document this for the owner. Non-admins are confined to the commands and
> parameters an admin exposed.

## 6. Media & resource abuse

- **Transcode/scan DoS:** bounded worker concurrency, an LRU transcode cache with a size
  cap, idle-process kill, and high priority for interactive playback over background scans
  (NFR-03, NFR-12). One user can't exhaust CPU/disk by spamming playback or scans.
- **Upload validation:** branding assets are type/size/dimension-checked; SVGs sanitized
  (strip scripts/`<foreignObject>`) before being served; served with safe content types
  and `Content-Disposition` where appropriate.
- **Range/stream safety:** validate `Range` headers; cap segment sizes; stream rather than
  buffer whole files.

## 7. Transport & exposure

- TLS is provided by Tailscale Serve (valid cert for the tailnet name). The app sets
  `trustProxy` and treats the connection as HTTPS. Set HSTS, `X-Content-Type-Options`,
  a strict **Content-Security-Policy** (no inline scripts; restrict connect/img/media to
  self), `Referrer-Policy`, and frame-ancestors `none`.
- **Funnel (public) is opt-in** and clearly flagged; when enabled, the same auth applies
  but the threat surface widens — recommend strong creds, no non-admin command access, and
  review of exposed shares.
- **No external calls** except Tailscale and admin-defined commands; **no telemetry**
  (NFR-07).

## 8. Secrets & logging

- Secrets (`FW_SESSION_SECRET`, `TS_AUTHKEY`, admin bootstrap password) come from env/
  compose, never committed; `.env` is git-ignored; `.env.example` holds only placeholders.
- Structured logs **redact** secrets, passwords, and full tokens; never log request bodies
  for auth routes or full command output containing potential secrets. Command output is
  stored per-run but viewable only by the owner/admin.

## 9. Security acceptance checklist

- [ ] All non-public routes reject unauthenticated requests.
- [ ] Passwords Argon2id; sessions httpOnly/Secure/SameSite and revocable; login
      rate-limited.
- [ ] Path resolver blocks `..`, symlink escapes, and absolute-path injection for both
      media and commands (tested).
- [ ] Commands spawn with `shell:false`, allowlisted executable, validated argv, env
      allowlist, cwd jail, timeout, output cap, concurrency cap, non-root.
- [ ] `repo_path` arguments cannot escape their repository (tested with malicious input).
- [ ] No secret appears in logs; `.env` git-ignored.
- [ ] CSP and security headers present; Funnel disabled unless explicitly enabled.
- [ ] One user cannot read/modify another user's likes/collections/clips/runs (tested).
