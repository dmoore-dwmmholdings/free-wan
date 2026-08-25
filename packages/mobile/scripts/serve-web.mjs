#!/usr/bin/env node
// Serve an `expo export --platform web` build with `/api` forwarded to a running FreeWAN
// server, so the two share an origin.
//
// They have to. The API is same-origin by design — it sets no `Access-Control-Allow-Origin`
// and does set `Cross-Origin-Resource-Policy: same-origin`, because in a real deployment it
// serves the web app itself. Point a bundle on one port at an API on another and every request
// fails CORS before it is sent: no data, no errors from the server, just a library that looks
// empty for a reason that has nothing to do with the app.
//
//   node scripts/serve-web.mjs <dir> [--port 4400] [--api http://localhost:8080]
//
// Development only. There is no path traversal guard beyond resolving inside the root, no
// caching, and no TLS.

import { createServer } from 'node:http'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { request } from 'node:http'

const args = process.argv.slice(2)
const root = resolve(args.find((a) => !a.startsWith('--')) ?? 'dist')
const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`)
  return at === -1 ? fallback : args[at + 1]
}
const port = Number(flag('port', '4400'))
const api = new URL(flag('api', 'http://localhost:8080'))

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
}

function proxy(req, res) {
  const upstream = request(
    {
      hostname: api.hostname,
      port: api.port,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: api.host },
    },
    (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers)
      up.pipe(res)
    },
  )
  upstream.on('error', (err) => {
    res.writeHead(502, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: { code: 'proxy_error', message: String(err) } }))
  })
  req.pipe(upstream)
}

async function serveFile(res, path) {
  const info = await stat(path).catch(() => null)
  if (!info?.isFile()) return false
  res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' })
  createReadStream(path).pipe(res)
  return true
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  if (url.pathname.startsWith('/api/')) return proxy(req, res)

  const wanted = resolve(join(root, normalize(url.pathname)))
  if (wanted !== root && !wanted.startsWith(root + sep)) {
    res.writeHead(403).end('outside the served directory')
    return
  }
  if (await serveFile(res, wanted)) return
  // Expo Router owns the routes below the root, so anything unmatched is the app itself.
  if (await serveFile(res, join(root, 'index.html'))) return
  res.writeHead(404).end('not found')
}).listen(port, () => {
  console.log(`serving ${root} on http://localhost:${port}  (/api -> ${api.origin})`)
})
