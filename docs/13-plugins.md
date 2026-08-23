# 13 — Plugins

Free-WAN plugins extend the server with **programmatic access to the library**, **interactive
UI segments**, and **automation**. A plugin is a small package an admin installs onto the
server. Once enabled it can:

- **Run all the time** — a long-lived daemon (`daemon: true`) that wakes on activation and can
  schedule its own work.
- **Run on command** — user-invokable actions declared in the manifest, shown on the Plugins
  page with a generated form, executed on demand (audited in the run history).
- **Run automatically when something happens** — subscribe to domain events
  (`media.added`, `scan.completed`, `clip.created`, …) and react.

Every plugin can also contribute **panels**: interactive UI built from a declarative *block kit*
that renders natively with the FreeWAN design tokens (no third-party HTML/JS in the browser, so
the strict CSP is unaffected).

## Trust model (read this)

Plugins run as **sandboxed Node child processes** (`child_process.fork`) with:

- a **clean environment** — server secrets (`SESSION_SECRET`, TLS material, …) are never
  inherited; only `PATH`/`HOME` plus values the manifest's `env` allowlist names,
- a **confined working directory** — the plugin's own install dir under `DATA_DIR/plugins/<id>`,
- **resource caps** — per-call timeout and output cap for command/event/action invocations,
- **no ambient data access** — the only sanctioned way to touch the library is the **Host API**,
  which the server mediates and **permission-gates** against the manifest's declared
  `permissions`.

This is the same posture as the custom-command runner (security §5): a plugin is **admin-installed
code you have chosen to trust**, run with the server's privileges behind a mediated API. We do not
claim OS-level isolation we don't have — a plugin process *can* still call Node APIs directly.
Declared permissions are shown to the admin at install time and strictly enforced at the Host-API
boundary. Install only plugins you trust, exactly as you would an npm dependency.

## Package format

A plugin is a directory (or a `.zip` of one) containing a `plugin.json` manifest and its code:

```jsonc
{
  "id": "com.example.tagger",          // unique, reverse-DNS-ish
  "name": "Auto Tagger",
  "version": "1.0.0",
  "description": "Tags new media automatically.",
  "author": "you",
  "icon": "<svg>…</svg>",              // optional inline SVG (sanitized)
  "main": "index.mjs",                  // entry, resolved within the plugin dir
  "daemon": false,                      // run all the time?
  "permissions": ["media:read", "collections:write", "storage"],
  "events": ["media.added"],            // domain events to react to
  "commands": [                         // user-runnable actions
    { "id": "retag", "name": "Re-tag library", "params": [
      { "name": "limit", "label": "Max items", "type": "number", "default": "100" }
    ] }
  ],
  "ui": [ { "id": "main", "title": "Tagger", "placement": "plugin_page" } ],
  "config": [                           // admin-set settings
    { "name": "model", "label": "Model", "type": "string", "default": "default" }
  ]
}
```

The entry module exports lifecycle hooks. **No imports are required** — the host injects a `ctx`
with the UI builders and the Host API, so the simplest plugin is a single zero-dependency file:

```js
export default {
  // panel render — return a block tree
  async render(ctx) {
    const { total } = await ctx.api.media.count({})
    return ctx.ui.stack([
      ctx.ui.heading('Library'),
      ctx.ui.stat('Items', String(total)),
      ctx.ui.button('Refresh', { action: 'refresh' }),
    ])
  },
  async onAction(ctx, { action }) {
    if (action === 'refresh') return this.render(ctx)
  },
  async onCommand(ctx, { command, args }) {
    ctx.log(`running ${command}`, args)
    return { ok: true }
  },
  async onEvent(ctx, { event, payload }) {
    ctx.log(`event ${event}`, payload)
  },
  async onActivate(ctx) {/* daemons set up timers/watchers here */},
}
```

## Host API (`ctx.api`) — permission-gated

| Method | Permission | Notes |
| --- | --- | --- |
| `media.list(query)` / `media.get(id)` / `media.count(query)` | `media:read` | same query shape as `GET /api/media` |
| `repos.list()` | `media:read` | |
| `categories.list(repoId?)` | `media:read` | |
| `collections.list()` / `create({name,description?})` / `addItem(id, mediaItemId)` | `collections:write` | created collections are owned by the plugin's installer |
| `clips.create({sourceItemId,name,startS,endS,loop?})` | `clips:write` | |
| `storage.get/set/delete/list` | `storage` | plugin-scoped key/value persistence |
| `config.get(key)` | — | read admin-set config values |
| `notify({title,body?,level?})` | `notify` | surfaced in the run log / events topic |
| `log(msg, …)` | — | collected into the run output and server log |

A call to a method whose permission the manifest did not declare is rejected at the host.

## UI block kit (`ctx.ui`)

Pure constructors that return JSON blocks. The web renders them with native, themed components.
Layout: `stack`, `row`, `card`, `divider`. Display: `text`/`heading`/`subheading`/`muted`/`mono`,
`badge`, `stat`, `notice`, `image`, `mediaCard`, `progress`, `code`, `link`. Interactive:
`button` (emits `action`), `input`, `textarea`, `select`, `toggle` (carry a `name`). When a button
is pressed the renderer posts the action plus a `fields` map of all named input values; the
plugin's `onAction` returns a fresh block tree.

A panel may set `refreshMs` in its manifest `ui[]` entry to have the web re-render it on an
interval — this is how a plugin shows **live progress** (e.g. a download). The renderer preserves
whatever the user has typed across refreshes, so a polling panel can still hold a form.

## Process & execution model

One live host process per **enabled** plugin, managed by `PluginHost` (analogous to the
transcoder/command-runner managers):

- started on enable / on server boot, **`onActivate`** is called once it is ready,
- restarted with backoff on crash; status flips to `error` with `last_error` on repeated failure,
- stopped on disable / uninstall / server shutdown (**`onDeactivate`**).

Commands and events are dispatched through the in-process **job worker** (`plugin_command`,
`plugin_event` job types) so they are queued, audited in `plugin_runs`, and cancellable. Panel
`render`/`action` are synchronous request/response with a timeout. All host↔plugin traffic is
newline-correlated JSON-RPC over the fork IPC channel.

## Data model

- `plugins` — one row per installed plugin (manifest JSON is the source of truth for
  commands/ui/events/permissions); `enabled`, `daemon`, `status`, `config`, `install_path`.
- `plugin_kv` — plugin-scoped key/value storage (the `storage` Host API).
- `plugin_runs` — audit log of command/event/action/activate invocations with collected output.

## HTTP API

Admin (`requireAdmin`):

- `GET /api/admin/plugins` — full list incl. manifest, status, config, declared permissions.
- `POST /api/admin/plugins/install` — `{source:'path'|'url', ...}` or multipart upload.
- `PATCH /api/admin/plugins/:id` — `{enabled?, config?}`.
- `DELETE /api/admin/plugins/:id` — uninstall (stops process, removes files).
- `GET /api/admin/plugins/:id/runs` — invocation history.

User (`authenticate`):

- `GET /api/plugins` — enabled plugins with the panels/commands visible to the caller.
- `GET /api/plugins/:id/panels/:panel` — render a panel → block tree.
- `POST /api/plugins/:id/panels/:panel/action` — `{action, value?, fields?}` → new block tree.
- `POST /api/plugins/:id/commands/:command/run` — `{args}` → `{runId}` (poll `plugin_runs`).
- `GET /api/plugins/:id/runs/:runId` — a single run.

## Distribution / registry

Install accepts a **server-side path** (dir or zip), an **uploaded zip**, or a **URL** to a zip.
The optional `PLUGIN_REGISTRY_URL` config points the admin UI at a future catalog site; the
install-from-URL path is the same code that a registry "Install" button will call.

## Example plugins

Under `packages/api/examples/plugins/`:

- **library-stats** — a UI panel (stats + notepad with `storage`) and a `count` command.
- **new-media-logger** — counts `media.added` / `scan.completed` events (`storage`, `notify`).
- **yt-dlp-downloader** — a daemon with a **live-progress** panel: pick a writable video repo +
  category, paste a video (A) or playlist (B) URL, and it runs `yt-dlp` straight into that folder;
  the scanner then indexes the result into the library. Mode C (search) is a deliberate scaffold
  for a later Playwright integration. Requires `yt-dlp` on the server (its path is configurable).
