// Video Downloader (yt-dlp) — a daemon example plugin.
//
// Demonstrates a richer plugin: a live-updating panel (manifest ui.refreshMs), the Host API for
// repo/category pickers, spawning an external tool, and parsing its progress in real time. The
// download is written straight into a chosen library folder; the scanner indexes it on its next
// pass, so the video shows up in the library — in the category you picked.
//
// Modes:
//   A) Single video   — download one URL
//   B) Playlist       — download every item in a playlist URL
//   C) Search         — yt-dlp's native search (ytsearch by default; any "<site>search:" prefix
//                       works, e.g. scsearch:). Results render with a Download button each.
//
// State lives at module scope because this is a daemon (one long-lived process), so active
// downloads survive across the panel's polling re-renders.

import { spawn } from 'node:child_process'
import { chmodSync, createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { get as httpsGet } from 'node:https'
import { arch, platform } from 'node:os'
import { join, resolve, sep } from 'node:path'

const jobs = new Map() // jobId -> job
let seq = 0
let flash = '' // transient validation message shown on the panel
let search = { status: 'idle', query: '', results: [] } // mode C state (single active search)

// Auto-provisioned yt-dlp. So non-technical users don't have to install anything, the plugin can
// download a standalone yt-dlp build (a self-contained binary — no Python needed) into its own
// data dir on first activation. `bin` is what every spawn uses once ready.
const provision = { status: 'idle', pct: 0, message: '', bin: '' }

/** The GitHub release asset + local filename for this OS/arch (standalone builds only). */
function ytDlpAsset() {
  const p = platform()
  if (p === 'win32') return { asset: 'yt-dlp.exe', file: 'yt-dlp.exe' }
  if (p === 'darwin') return { asset: 'yt-dlp_macos', file: 'yt-dlp' }
  if (p === 'linux') {
    const a = arch()
    if (a === 'arm64') return { asset: 'yt-dlp_linux_aarch64', file: 'yt-dlp' }
    if (a === 'arm') return { asset: 'yt-dlp_linux_armv7l', file: 'yt-dlp' }
    return { asset: 'yt-dlp_linux', file: 'yt-dlp' }
  }
  return null // unknown platform — fall back to a PATH lookup
}

/** Does `bin --version` succeed? Confirms a binary (managed or on PATH) actually runs. */
function ytDlpWorks(bin) {
  return new Promise((res) => {
    let child
    try {
      child = spawn(bin, ['--version'], { windowsHide: true })
    } catch {
      return res(false)
    }
    child.on('error', () => res(false))
    child.on('close', (code) => res(code === 0))
  })
}

/** Download `url` to `dest`, following GitHub's redirect to the CDN. Reports progress via onPct. */
function download(url, dest, onPct) {
  return new Promise((resolve2, reject) => {
    const req = httpsGet(url, { headers: { 'user-agent': 'free-wan-yt-dlp-plugin' } }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume()
        return download(res.headers.location, dest, onPct).then(resolve2, reject)
      }
      if (res.statusCode !== 200) {
        res.resume()
        return reject(new Error(`download failed: HTTP ${res.statusCode}`))
      }
      const total = Number(res.headers['content-length']) || 0
      let got = 0
      const tmp = `${dest}.part`
      const out = createWriteStream(tmp)
      res.on('data', (c) => {
        got += c.length
        if (total) onPct?.(got / total)
      })
      res.pipe(out)
      out.on('error', reject)
      out.on('finish', () => {
        out.close(() => {
          try {
            renameSync(tmp, dest)
            resolve2()
          } catch (e) {
            reject(e)
          }
        })
      })
    })
    req.on('error', reject)
    req.setTimeout(120_000, () => req.destroy(new Error('download timed out')))
  })
}

/**
 * Ensure a usable yt-dlp. Order: explicit configured path → an already-downloaded managed binary
 * → yt-dlp already on PATH → download a managed binary. Idempotent and single-flight; safe to call
 * on every activation. Sets `provision.bin` + `provision.status` for the rest of the plugin.
 */
async function ensureYtDlp(ctx) {
  if (provision.status === 'downloading' || provision.status === 'ready') return
  provision.status = 'checking'
  provision.message = ''

  // 1) An explicit path the admin typed in settings always wins (default 'yt-dlp' means "auto").
  const configured = String(ctx.config.get('ytdlpPath') || '').trim()
  if (configured && configured !== 'yt-dlp') {
    provision.bin = configured
    provision.status = 'ready'
    return
  }

  const dir = ctx.plugin?.dataDir || process.cwd()
  const spec = ytDlpAsset()
  const managed = spec ? join(dir, spec.file) : ''

  // 2) A managed binary we downloaded on a previous run.
  if (managed && existsSync(managed) && (await ytDlpWorks(managed))) {
    provision.bin = managed
    provision.status = 'ready'
    return
  }

  // 3) A system-wide yt-dlp already on PATH.
  if (await ytDlpWorks('yt-dlp')) {
    provision.bin = 'yt-dlp'
    provision.status = 'ready'
    return
  }

  // 4) Download a standalone build for this platform.
  if (!spec || !managed) {
    provision.status = 'error'
    provision.message = 'Could not auto-install yt-dlp on this platform. Install it on the server and set its path in the plugin settings.'
    return
  }
  provision.status = 'downloading'
  provision.pct = 0
  provision.message = 'Downloading yt-dlp…'
  const url = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${spec.asset}`
  try {
    mkdirSync(dir, { recursive: true })
    await download(url, managed, (p) => {
      provision.pct = p
    })
    if (platform() !== 'win32') chmodSync(managed, 0o755)
    if (!existsSync(managed) || statSync(managed).size < 1_000_000 || !(await ytDlpWorks(managed))) {
      throw new Error('downloaded file did not run')
    }
    provision.bin = managed
    provision.status = 'ready'
    provision.message = ''
    ctx.log(`yt-dlp installed at ${managed}`)
  } catch (e) {
    try {
      rmSync(`${managed}.part`, { force: true })
    } catch {
      /* ignore */
    }
    provision.status = 'error'
    provision.message = `Automatic yt-dlp install failed (${e.message}). Install it on the server and set its path in the plugin settings.`
    ctx.log(`yt-dlp auto-install failed: ${e.message}`)
  }
}

/** The binary the download/search paths should spawn. */
function ytDlpBin(ctx) {
  return provision.bin || String(ctx.config.get('ytdlpPath') || '').trim() || 'yt-dlp'
}

// ---- helpers ---------------------------------------------------------------
const fmtDuration = (s) => {
  s = Math.floor(Number(s) || 0)
  if (!s) return ''
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const pad = (n) => String(n).padStart(2, '0')
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`
}
const fmtBytes = (n) => {
  n = Number(n) || 0
  if (!n) return ''
  const u = ['B', 'KB', 'MB', 'GB']
  let i = 0
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024
    i++
  }
  return `${n.toFixed(i ? 1 : 0)}${u[i]}`
}
const sanitizeSub = (p) =>
  String(p || '')
    .split(/[\\/]+/)
    .map((s) => s.trim())
    .filter((s) => s && s !== '.' && s !== '..')
/** Split the admin's "extra flags" string into argv tokens; "double" or 'single' quotes group. */
const tokenizeArgs = (s) => {
  const out = []
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g
  let m
  while ((m = re.exec(String(s || ''))) !== null) out.push(m[1] ?? m[2] ?? m[3])
  return out
}
const isActive = (job) => job.status === 'downloading'

/** Build the destination dropdown: every writable video repo plus each of its categories. */
async function buildDestinations(ctx) {
  const repos = (await ctx.api.repos.list()).data.filter(
    (r) => r.enabled && !r.readOnly && (r.type === 'video' || r.type === 'mixed'),
  )
  const options = []
  const byValue = new Map()
  for (const r of repos) {
    const rootOpt = { label: `${r.name} (root)`, value: `${r.id}\t`, repo: r, category: '' }
    options.push({ label: rootOpt.label, value: rootOpt.value })
    byValue.set(rootOpt.value, rootOpt)
    const cats = (await ctx.api.categories.list(r.id)).data.slice().sort((a, b) => a.path.localeCompare(b.path))
    for (const c of cats) {
      const value = `${r.id}\t${c.path}`
      options.push({ label: `${r.name} / ${c.path}`, value })
      byValue.set(value, { label: `${r.name} / ${c.path}`, value, repo: r, category: c.path })
    }
  }
  return { repos, options, byValue }
}

// ---- yt-dlp output parsing -------------------------------------------------
// We drive yt-dlp with two custom, tab-delimited line formats so parsing is robust:
//   --print            "META\t<id>\t<index>\t<count>\t<uploader>\t<duration>\t<resolution>\t<title…>"
//   --progress-template "PROG\t<id>\t<status>\t<percent>\t<speed>\t<eta>\t<downloaded>\t<total>"
function parseLine(job, raw) {
  const line = raw.trimEnd()
  if (!line) return
  if (line.startsWith('META\t')) {
    const p = line.split('\t')
    const id = p[1] || 'item'
    const item = job.items.get(id) ?? addItem(job, id)
    item.index = Number(p[2]) || 1
    item.uploader = p[4] && p[4] !== 'NA' ? p[4] : ''
    item.duration = Number(p[5]) || 0
    item.resolution = p[6] && p[6] !== 'NA' && p[6] !== '?' ? p[6] : ''
    item.title = p.slice(7).join('\t') || item.title || job.url
    job.total = Number(p[3]) || job.total
    job.currentId = id
  } else if (line.startsWith('PROG\t')) {
    const p = line.split('\t')
    const id = p[1] || job.currentId || 'item'
    const item = job.items.get(id) ?? addItem(job, id)
    item.status = p[2] || item.status
    item.percent = parseFloat(p[3]) || 0
    item.percentStr = (p[3] || '').trim()
    item.speed = (p[4] || '').trim()
    item.eta = (p[5] || '').trim()
    item.downloaded = Number(p[6]) || 0
    item.total = Number(p[7]) || 0
    job.currentId = id
  } else if (/^ERROR:/.test(line)) {
    job.lastError = line.replace(/^ERROR:\s*/, '')
    pushTail(job, line)
  } else {
    // Everything else (warnings, retry notices, extractor chatter) goes into a bounded tail
    // so a silent stall is debuggable from the panel instead of showing a bare spinner.
    pushTail(job, line)
  }
  // Sites commonly block server IPs with a bot check; that error is fixable with cookies,
  // so surface a targeted hint instead of leaving the user to decode yt-dlp output.
  if (!job.hint && /sign in to confirm|not a bot|HTTP Error 429|--cookies/i.test(line)) {
    job.hint = 'cookies'
  }
}

function pushTail(job, line) {
  if (!job.tail) job.tail = []
  job.tail.push(line.length > 300 ? `${line.slice(0, 300)}…` : line)
  if (job.tail.length > 12) job.tail.shift()
}
function addItem(job, id) {
  const item = { id, title: '', status: 'starting', percent: 0 }
  job.items.set(id, item)
  job.order.push(id)
  return item
}

/** Split a stream into lines (yt-dlp uses \n with --newline, \r for in-place progress). */
function lineReader(stream, onLine) {
  let buf = ''
  stream.setEncoding('utf8')
  stream.on('data', (chunk) => {
    buf += chunk
    const parts = buf.split(/\r\n|\r|\n/)
    buf = parts.pop() ?? ''
    for (const l of parts) onLine(l)
  })
  stream.on('end', () => {
    if (buf) onLine(buf)
  })
}

// ---- search (mode C) ---------------------------------------------------------
// yt-dlp's search prefixes do the work: `ytsearch10:<query>` returns ten YouTube results;
// any "<site>search:" prefix typed into the query is honored (scsearch: → SoundCloud, …).
// --flat-playlist --dump-json lists metadata only (one JSON object per line), no downloads.
function runSearch(ctx, fields) {
  flash = ''
  const raw = String(fields.query || '').trim()
  if (!raw) {
    flash = 'Enter a search query.'
    return
  }
  if (search.child) {
    try {
      search.child.kill()
    } catch {
      /* already gone */
    }
  }
  const m = /^([a-z0-9]+search)\s*:\s*(.+)$/i.exec(raw)
  const prefix = m ? m[1].toLowerCase() : 'ytsearch'
  const query = m ? m[2].trim() : raw

  const bin = ytDlpBin(ctx)
  const cookiesPath = String(ctx.config.get('cookiesPath') || '').trim()
  const extraArgs = tokenizeArgs(ctx.config.get('extraArgs'))
  const args = [
    '--no-color', '--no-warnings', '--ignore-errors',
    '--flat-playlist', '--dump-json',
    ...(cookiesPath ? ['--cookies', cookiesPath] : []),
    ...extraArgs,
    `${prefix}10:${query}`,
  ]

  const s = { status: 'searching', query: raw, results: [], startedAt: Date.now() }
  search = s
  let child
  try {
    child = spawn(bin, args, { env: process.env, windowsHide: true })
  } catch (e) {
    s.status = 'error'
    s.error = e.message
    return
  }
  s.child = child

  const found = []
  let firstError = ''
  lineReader(child.stdout, (l) => {
    const line = l.trim()
    if (!line.startsWith('{')) return
    try {
      const e = JSON.parse(line)
      found.push({
        title: e.title || e.id || 'Untitled',
        url: e.url || e.webpage_url || '',
        uploader: e.uploader || e.channel || '',
        duration: Number(e.duration) || 0,
      })
    } catch {
      /* non-JSON noise */
    }
  })
  lineReader(child.stderr, (l) => {
    if (!firstError && /^ERROR:/.test(l)) firstError = l.replace(/^ERROR:\s*/, '')
  })
  const timer = setTimeout(() => {
    try {
      child.kill()
    } catch {
      /* already gone */
    }
  }, 60_000)
  child.on('error', (e) => {
    clearTimeout(timer)
    if (search !== s) return // superseded by a newer search
    s.status = 'error'
    s.error =
      e.code === 'ENOENT'
        ? `Could not run "${bin}". Install yt-dlp on the server and put it on PATH, or set its path in the plugin settings.`
        : e.message
  })
  child.on('close', () => {
    clearTimeout(timer)
    if (search !== s || s.status === 'error') return
    s.child = null
    s.results = found.filter((r) => r.url)
    s.status = 'done'
    if (s.results.length === 0) s.error = firstError || 'No results.'
    ctx.log(`search "${raw}" → ${s.results.length} results`)
  })
  ctx.log(`search start: ${prefix}10:${query}`)
}

// ---- start a download ------------------------------------------------------
async function startDownload(ctx, fields) {
  flash = ''
  const mode = fields.mode || 'A'

  const url = String(fields.url || '').trim()
  if (!url) {
    flash = 'Enter a video or playlist URL.'
    return
  }
  const [repoId, category = ''] = String(fields.dest || '').split('\t')
  const repo = (await ctx.api.repos.list()).data.find((r) => r.id === repoId)
  if (!repo) {
    flash = 'Choose a destination folder.'
    return
  }

  // Resolve the destination dir and assert it stays inside the repository root.
  const base = resolve(repo.rootPath)
  const segs = [...sanitizeSub(category), ...sanitizeSub(fields.subfolder)]
  const destDir = resolve(base, ...segs)
  if (destDir !== base && !destDir.startsWith(base + sep)) {
    flash = 'Invalid destination.'
    return
  }
  try {
    mkdirSync(destDir, { recursive: true })
  } catch (e) {
    flash = `Cannot create destination: ${e.message}`
    return
  }

  const quality = fields.quality || 'best'
  const fmt =
    quality === '1080'
      ? ['-f', 'bv*[height<=1080]+ba/b[height<=1080]/b']
      : quality === '720'
        ? ['-f', 'bv*[height<=720]+ba/b[height<=720]/b']
        : []
  const bin = ytDlpBin(ctx)
  const cookiesPath = String(ctx.config.get('cookiesPath') || '').trim()
  const extraArgs = tokenizeArgs(ctx.config.get('extraArgs'))
  const args = [
    '--no-color',
    '--newline',
    '--ignore-errors',
    // NB: warnings are intentionally NOT suppressed — they land in the job's output tail,
    // which is the only clue when a site stalls or bot-checks the server.
    '--socket-timeout', '30',
    mode === 'B' ? '--yes-playlist' : '--no-playlist',
    '-o',
    resolve(destDir, '%(title)s [%(id)s].%(ext)s'),
    '--progress-template',
    'PROG\t%(info.id)s\t%(progress.status)s\t%(progress._percent_str)s\t%(progress._speed_str)s\t%(progress._eta_str)s\t%(progress.downloaded_bytes)s\t%(progress.total_bytes)s',
    '--print',
    'META\t%(id)s\t%(playlist_index|1)s\t%(playlist_count|1)s\t%(channel,uploader|NA)s\t%(duration|0)s\t%(resolution|?)s\t%(title)s',
    // --print implies --simulate (metadata only, no download); undo that.
    '--no-simulate',
    ...fmt,
    ...(cookiesPath ? ['--cookies', cookiesPath] : []),
    // Admin extras go last so they can override anything above (yt-dlp: last flag wins).
    ...extraArgs,
    url,
  ]

  const id = `job${++seq}`
  const dest = `${repo.name}${segs.length ? ` / ${segs.join('/')}` : ' (root)'}`
  const job = { id, mode, url, dest, status: 'downloading', items: new Map(), order: [], total: 1, startedAt: Date.now() }
  jobs.set(id, job)

  let child
  try {
    child = spawn(bin, args, { env: process.env, windowsHide: true })
  } catch (e) {
    job.status = 'error'
    job.lastError = e.message
    return
  }
  job.child = child
  lineReader(child.stdout, (l) => parseLine(job, l))
  lineReader(child.stderr, (l) => parseLine(job, l))
  child.on('error', (e) => {
    job.status = 'error'
    job.lastError =
      e.code === 'ENOENT'
        ? `Could not run "${bin}". Install yt-dlp on the server and put it on PATH, or set its path in the plugin settings.`
        : e.message
  })
  child.on('close', (code) => {
    if (job.status === 'error') return
    job.status = job.canceled ? 'canceled' : code === 0 ? 'completed' : 'completed_with_errors'
    ctx.log(`download ${id} ${job.status}`)
  })
  ctx.log(`start ${mode} download → ${destDir}`)
}

// ---- rendering -------------------------------------------------------------
function renderJob(ui, job) {
  const add = []
  const items = job.order.map((id) => job.items.get(id)).filter(Boolean)
  const done = items.filter((i) => i.status === 'finished').length
  const current = (job.currentId && job.items.get(job.currentId)) || items[0]
  const tone =
    job.status === 'downloading'
      ? 'primary'
      : job.status === 'completed'
        ? 'success'
        : job.status === 'canceled'
          ? 'neutral'
          : 'danger'
  const heading = current?.title || (job.mode === 'B' ? 'Playlist' : 'Video')

  add.push(ui.row([ui.subheading(heading), ui.badge(job.status.replace(/_/g, ' '), tone)]))
  if (job.dest) add.push(ui.muted(`→ ${job.dest}`))
  if (job.lastError) add.push(ui.notice(job.lastError, 'danger'))
  if (job.hint === 'cookies') {
    add.push(
      ui.notice(
        'The site appears to be blocking this server (bot check / rate limit). Fix: export a cookies.txt from a logged-in browser, put it on the server, and set "Cookies file" in the plugin settings. Installing yt-dlp with curl-cffi and adding --impersonate chrome to "Extra flags" also helps.',
        'warn',
      ),
    )
  }
  if (job.mode === 'B' && job.total > 1) add.push(ui.muted(`Item ${current?.index || done + 1} of ${job.total}  ·  ${done} complete`))

  const stalled = isActive(job) && !current && Date.now() - job.startedAt > 15_000
  if (current) {
    const meta = []
    if (current.uploader) meta.push(current.uploader)
    if (current.duration) meta.push(fmtDuration(current.duration))
    if (current.resolution) meta.push(current.resolution)
    if (meta.length) add.push(ui.muted(meta.join('   ·   ')))
    const bits = []
    if (current.percentStr) bits.push(current.percentStr)
    if (current.speed) bits.push(current.speed)
    if (current.eta && current.eta !== 'NA') bits.push(`ETA ${current.eta}`)
    if (current.total) bits.push(`${fmtBytes(current.downloaded)} / ${fmtBytes(current.total)}`)
    add.push(ui.progress((current.percent || 0) / 100, bits.join('   ·   ') || (isActive(job) ? 'starting…' : '')))
  } else if (isActive(job)) {
    add.push(ui.muted(`Fetching metadata… (${Math.round((Date.now() - job.startedAt) / 1000)}s)`))
  }

  // Show yt-dlp's own output when something is off: a long silent start, or a failed/partial
  // job. This is the difference between "stuck…" and knowing exactly why.
  const showTail = (stalled || job.status === 'error' || job.status === 'completed_with_errors') && job.tail?.length
  if (showTail) add.push(ui.code(job.tail.join('\n')))

  if (isActive(job)) add.push(ui.button('Cancel', { action: `cancel:${job.id}`, variant: 'ghost' }))
  return ui.card(add)
}

export default {
  async onActivate(ctx) {
    ctx.log('video downloader ready')
    // Fire-and-forget: make yt-dlp available (download it if needed) without blocking activation.
    // The panel shows progress and re-enables the form once ready.
    void ensureYtDlp(ctx)
  },

  async render(ctx, info = {}) {
    const fields = info.fields ?? {}
    const ui = ctx.ui
    const out = []
    const add = (b) => {
      if (b) out.push(b)
    }

    add(ui.heading('Video Downloader'))
    add(ui.muted('Fetch a video or playlist with yt-dlp into a library folder — it shows up in your library after the next scan.'))

    // yt-dlp provisioning status. The form is disabled until a working yt-dlp is ready.
    const ready = provision.status === 'ready'
    if (provision.status === 'downloading') {
      add(ui.card([ui.subheading('Setting up yt-dlp'), ui.progress(provision.pct, `${Math.round(provision.pct * 100)}%`), ui.muted('One-time download of the downloader itself — you can start using it as soon as this finishes.')]))
    } else if (provision.status === 'error') {
      add(ui.card([ui.notice(provision.message, 'danger'), ui.button('Retry setup', { action: 'reprovision', variant: 'primary' })]))
    } else if (!ready) {
      add(ui.muted('Preparing yt-dlp…'))
    }

    const { repos, options } = await buildDestinations(ctx)
    if (repos.length === 0) {
      add(ui.notice('No writable video repository found. Add one (type video or mixed, not read-only) under Admin → Repositories first.', 'warn'))
    } else if (!ready) {
      // Form is hidden until yt-dlp is ready (avoids letting a user submit into a missing binary).
    } else {
      // Two-up grid inside one card, matching the rest of the site's forms.
      const form = []
      form.push(
        ui.row([
          ui.select('mode', {
            label: 'Mode',
            value: fields.mode || 'A',
            options: [
              { label: 'A — Single video', value: 'A' },
              { label: 'B — Playlist', value: 'B' },
              { label: 'C — Search', value: 'C' },
            ],
          }),
          ui.select('quality', {
            label: 'Quality',
            value: fields.quality || 'best',
            options: [
              { label: 'Best available', value: 'best' },
              { label: 'Up to 1080p', value: '1080' },
              { label: 'Up to 720p', value: '720' },
            ],
          }),
        ]),
      )
      form.push(
        ui.row([
          ui.input('url', { label: 'Video / playlist URL', placeholder: 'https://…  (modes A & B)' }),
          ui.input('query', { label: 'Search query', placeholder: 'mode C — YouTube, or prefix e.g. scsearch:…' }),
        ]),
      )
      form.push(
        ui.row([
          ui.select('dest', { label: 'Destination · video tab → category', value: fields.dest || options[0]?.value, options }),
          ui.input('subfolder', { label: 'New subfolder', placeholder: 'optional — created if missing' }),
        ]),
      )
      if (flash) form.push(ui.notice(flash, 'warn'))
      form.push(ui.button('Start download', { action: 'start', variant: 'primary' }))
      add(ui.card(form))
    }

    // Search results (mode C) — each row downloads through the same path as mode A,
    // using the destination/quality currently selected in the form above.
    if (search.status !== 'idle') {
      const box = []
      const tone = search.status === 'searching' ? 'primary' : search.status === 'error' ? 'danger' : 'success'
      box.push(ui.row([ui.subheading(`Search — ${search.query}`), ui.badge(search.status, tone)]))
      if (search.status === 'searching') {
        box.push(ui.muted('Searching…'))
        box.push(ui.button('Cancel search', { action: 'cancelsearch', variant: 'ghost' }))
      }
      if (search.error) box.push(ui.notice(search.error, search.results.length ? 'warn' : 'danger'))
      search.results.forEach((r, i) => {
        const meta = [r.uploader, fmtDuration(r.duration)].filter(Boolean).join('   ·   ')
        box.push(
          ui.row([
            ui.muted(meta ? `${r.title}   —   ${meta}` : r.title),
            ui.button('Download', { action: `dl:${i}`, variant: 'ghost' }),
          ]),
        )
      })
      add(ui.card(box))
    }

    const list = [...jobs.values()].reverse()
    if (list.length) {
      add(ui.row([ui.subheading('Downloads'), ui.button('Clear finished', { action: 'clear', variant: 'ghost' })]))
      for (const job of list) add(renderJob(ui, job))
    }
    return out
  },

  async onAction(ctx, info = {}) {
    const action = info.action || ''
    if (action === 'reprovision') {
      provision.status = 'idle'
      void ensureYtDlp(ctx)
    } else if (action === 'start') {
      const fields = info.fields ?? {}
      if ((fields.mode || 'A') === 'C') runSearch(ctx, fields)
      else await startDownload(ctx, fields)
    } else if (action.startsWith('dl:')) {
      const r = search.results[Number(action.slice(3))]
      if (r?.url) await startDownload(ctx, { ...(info.fields ?? {}), mode: 'A', url: r.url })
    } else if (action === 'cancelsearch') {
      if (search.child) {
        try {
          search.child.kill()
        } catch {
          /* already gone */
        }
      }
      search = { status: 'idle', query: '', results: [] }
    } else if (action === 'clear') {
      for (const [id, job] of jobs) if (!isActive(job)) jobs.delete(id)
      if (!search.child) search = { status: 'idle', query: '', results: [] }
    } else if (action.startsWith('cancel:')) {
      const job = jobs.get(action.slice('cancel:'.length))
      if (job?.child) {
        job.canceled = true
        try {
          job.child.kill()
        } catch {
          /* already gone */
        }
      }
    }
    return this.render(ctx, info)
  },
}
