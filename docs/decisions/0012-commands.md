# ADR 0012 — Custom commands & the execution sandbox

- **Status:** accepted
- **Date:** 2026-06-21
- **Phase:** 9 (Custom commands & automation) — the highest-risk feature

## Decisions

1. **Schema** (migration `0008_commands`): `commands` (executable, JSON `arg_template`,
   limits, `env_allowlist`, `allow_non_admin`, `is_internal`), `command_params` (typed param
   schema), `command_runs` (submitted `args` **and** the actual `resolved_argv` for audit,
   status, exit code, capped output, timing).

2. **No-shell argv assembly** (`lib/argv-builder.ts`, pure + heavily tested). Each
   `arg_template` token → standalone argv entry(ies): literal → itself; `{param}` → the
   validated value (prefix/suffix joined onto the *single* entry); `{param,whenTrue:[…]}` →
   flags only when true; missing optional → omitted. `spawn(exe, argv, {shell:false})` — user
   values are never concatenated into a command line, so metacharacters are inert data.

3. **Server-side re-validation** (`lib/validate-command-args.ts`): coerce by type, enforce
   `min/max/pattern/enum`, and resolve `repo_path` via the **`resolveWithinRoot` resolver**
   (realpath + prefix check) so a path can never escape its repository. Invalid → 422, no run.

4. **Sandboxed runner** (`services/command-runner.ts`): `spawn` with **no shell**, a **clean
   allowlisted env** (only `PATH`/`HOME` + the command's `env_allowlist` — server secrets are
   NOT inherited), a **confined cwd** (the command's `working_dir` if a real dir, else a
   per-run temp dir), a **hard timeout** (SIGTERM→SIGKILL, process-group kill on POSIX via
   `detached`), an **output cap** (`max_output_kb`, `truncated` flag), and **cancellation**.
   Output streams to EventHub `run:{runId}` (`run.output`/`run.status`).

5. **Executable allowlist** (config `COMMAND_ALLOWED_EXECUTABLES`): `commands.executable`
   must match the allowlist on create/patch — form input can never name the executable.
   **Authz:** admins always; others only if `allow_non_admin` AND `users.can_run_commands`
   (FR-56). Run history is per-user (admins see all).

6. **Web:** a `/commands` page renders the form from a command's param schema (typed
   inputs), runs it, and polls the run for live-ish output + status + cancel. (The admin
   **CommandEditor** with the visual arg_template builder is deferred — commands are created
   via `POST /api/admin/commands` for now.)

## Verification

- api **100/100** tests. Security-critical coverage: argv injection-inert + repo_path escape
  rejected (`commands-core`); and an 8-test **real-`node`-spawn** suite (`commands`):
  metacharacters verbatim in output (no shell), **secret env not inherited** (`SECRET[NONE]`),
  non-zero exit → failed, **output cap + truncated**, **timeout kills**, **cancel kills**,
  non-allowlisted executable 422, non-admin 403. Live built-server: create + run confirmed.

## Deferred (non-blocking)

- Admin CommandEditor UI (arg_template builder) + repo-scoped path **picker**; **internal**
  commands (rescan/rebuild-thumbnails/clear-cache as `is_internal` server actions through the
  same UI/history); per-command concurrency cap (uses the global worker cap now); `ulimit`/
  cgroup resource limits; RunConsole over WebSocket (polling now). Non-root container USER is
  a Phase-10 deploy concern.
