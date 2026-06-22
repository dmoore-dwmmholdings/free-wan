# 11 — Feature: Custom Commands & Automation

Implements FR-49–FR-57. This feature turns the UI into a control panel for the owner's own
CLI tools — e.g. a `yt-dlp` downloader that drops files into a repository, or a rescan —
invoked through **generated forms** (never a typed command line) with **live output**.
This is the highest-risk feature; the security rules here are normative and elaborated in
[`13-security.md`](13-security.md).

## 1. Concepts

- **Command** (admin-defined): a name, description, an **executable** (allowlisted binary
  or absolute path), an **`arg_template`**, a typed **parameter schema**, a working
  directory, and limits (timeout, output cap, env allowlist).
- **Parameter**: a typed input (`string`, `number`, `boolean`, `enum`, `repo_path`) with
  constraints; renders as a form field.
- **Run**: one execution with submitted args, streamed output, an exit code, and a history
  record.

## 2. Defining a command (admin) — FR-49, FR-50

`<CommandEditor>` (under `/admin/commands`) lets an admin specify the executable, add
parameters, and build the `arg_template` (data model [`03`](03-data-model.md) §5). Example —
a guarded `yt-dlp` downloader:

```jsonc
{
  "name": "Download video (yt-dlp)",
  "description": "Fetch a video into a chosen library folder.",
  "executable": "/usr/local/bin/yt-dlp",      // allowlisted
  "workingDir": "{param:dest}",               // must resolve within a repository
  "timeoutS": 1800,
  "maxOutputKb": 2048,
  "envAllowlist": ["PATH", "HOME"],
  "allowNonAdmin": false,
  "params": [
    { "name": "url",    "label": "Video URL", "type": "string",
      "required": true, "constraints": { "pattern": "^https?://" } },
    { "name": "dest",   "label": "Save to",   "type": "repo_path",
      "required": true, "constraints": { "repoId": "REPO_ID", "mustBeDir": true } },
    { "name": "format", "label": "Quality",   "type": "enum",
      "default": "bv*+ba/b", "constraints": { "options": ["bv*+ba/b","best","worst"] } }
  ],
  "argTemplate": [
    "-f", { "param": "format" },
    "-o", { "param": "dest", "suffix": "/%(title)s.%(ext)s" },
    { "param": "url" }
  ]
}
```

Built-in **internal** commands (FR-57) like "Rescan repository" ship as `is_internal`
commands that call server actions instead of spawning a process — same UI, same history.

## 3. Running a command (user) — FR-51, FR-52

1. `/commands` lists commands the caller may run (admins always; others only if
   `allowNonAdmin` **and** the user's `canRunCommands`; FR-56).
2. Selecting one renders `<CommandForm>` from the param schema: text inputs, number inputs
   with min/max, switches for booleans, selects for enums, and a **repository-scoped path
   picker** for `repo_path` (the user browses within the allowed repository — they cannot
   type an arbitrary absolute path).
3. Client-side validation uses the shared zod schema; on submit
   `POST /api/commands/:id/run { args }`.
4. The server **re-validates** args against the schema (never trust the client), then
   **builds the argv array** from `arg_template` (§4) and enqueues the run. Invalid input →
   `422` with field errors, no execution.

## 4. Argument construction — the no-shell guarantee (FR-50, FR-55)

- Arguments are assembled into a **string array** and passed to
  `child_process.spawn(executable, argv, options)` with **no shell** (`shell: false`).
  No user value is ever concatenated into a command string or passed to `sh -c`.
- Each `arg_template` token becomes one or more argv entries:
  - a **literal** → itself;
  - a **param ref** → the validated, coerced value (number→string, enum→one of options);
    optional `prefix`/`suffix` are concatenated **to that single argv entry only** (still
    one token, so shell metacharacters are inert);
  - a **boolean** with `whenTrue:[…]` emits those flags only when true, nothing when false.
- `repo_path` values are resolved to an absolute path and **verified to stay within the
  named repository root** (realpath + prefix check, symlink-aware) before use; anything
  escaping the root is rejected.
- `executable` must be on the allowlist (config `commands.allowedExecutables`) or an
  absolute path that exists and is allowed; arbitrary executables cannot be introduced by
  a non-admin, and never by form input.

## 5. Live output & lifecycle — FR-53, FR-54

- The run executes in the worker; stdout and stderr are streamed to the client over
  WebSocket `run:{runId}` as `run.output` chunks, then a terminal `run.status` with
  `exitCode` and `durationMs`. `<RunConsole>` renders them with stream coloring and
  auto-scroll, and offers **Cancel** (`POST /api/command-runs/:id/cancel` → the worker
  sends SIGTERM, then SIGKILL after a grace period).
- Output is **capped** at `maxOutputKb`; beyond the cap it is truncated (flagged
  `truncated=1`) to protect memory/DB.
- Every run is recorded in `command_runs` (who, command, submitted `args`, the actual
  `resolvedArgv` for audit, status, exit code, output, timing) and re-viewable at
  `/runs/:id` (FR-54). Users see their own runs; admins see all.

## 6. Execution limits (summary; full model in `13-security.md`) — FR-55

- **No shell** (§4). **Timeout** (`timeoutS`) kills runaway processes. **Working directory**
  is confined to an allowed root. **Environment** is reset to an allowlist (no inheriting
  secrets). **Output cap** bounds memory. **Least privilege**: the process runs as a
  non-root user inside the container; consider a per-run temp dir and OS resource limits.
- Concurrency is bounded (config `commands.maxConcurrent`); excess runs queue.

## 7. Automation use cases (FR-57)

- **Download → categorize**: a `yt-dlp` (or `gallery-dl`) command saves into a repository
  subfolder; a follow-up internal **Rescan** command indexes and auto-categorizes the new
  files by their folder — closing the loop the owner asked for.
- **Organize**: an admin script that moves/renames files within a repository, then rescan.
- **Maintenance**: rebuild thumbnails, clear transcode cache — exposed as internal
  commands so they share the same run UI and history.

Optionally, commands can be wired to **scheduled** execution later (a `schedule` on a
command row); v1 supports manual invocation, with the schema leaving room for cron.

## 8. Acceptance

An admin registers a `yt-dlp` command with URL/format/destination params; a permitted user
runs it from a form (no shell typing), watches live output, sees a non-zero exit handled
gracefully, and finds the run in history with the exact argv used; a rescan internal
command then surfaces the downloaded file, auto-categorized by folder. Attempts to inject
shell metacharacters or paths outside the repository are rejected. Traces FR-49–57.
