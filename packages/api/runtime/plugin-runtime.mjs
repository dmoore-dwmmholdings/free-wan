// Free-WAN plugin host runtime.
//
// This file is forked (child_process.fork) as the entrypoint of every enabled plugin's
// sandboxed process. It is intentionally a standalone, zero-dependency ESM module: it is NOT
// bundled by tsup and must run under plain `node` in dev, prod, and tests alike. It loads the
// plugin's entry module, injects a `ctx` (UI builders + a mediated Host API that round-trips to
// the parent over the IPC channel), and dispatches lifecycle hooks the parent requests.
//
// Wire protocol (newline-free structured IPC messages):
//   host -> plugin : {t:'init', plugin, mainPath, config}
//                    {t:'invoke', id, kind, payload}            kind: activate|deactivate|render|action|command|event
//                    {t:'config', config}
//                    {t:'api.result', id, ok, value|error}
//   plugin -> host : {t:'ready'} | {t:'fatal', error}
//                    {t:'invoke.result', id, ok, value?|error?}
//                    {t:'api', id, method, params}
//                    {t:'log', invokeId, level, msg}

import { pathToFileURL } from 'node:url'

const send = (m) => {
  try {
    process.send?.(m)
  } catch {
    /* parent gone; ignore */
  }
}

// ---- Host API round-trips ---------------------------------------------------
let apiSeq = 0
const pendingApi = new Map()

function callHost(method, params) {
  const id = `a${++apiSeq}`
  return new Promise((resolve, reject) => {
    pendingApi.set(id, { resolve, reject })
    send({ t: 'api', id, method, params: params ?? {} })
  })
}

// ---- UI block builders (pure constructors matching the shared UiBlock union) ----
const ui = {
  stack: (children, opts = {}) => ({ type: 'stack', children: asArray(children), ...opts }),
  row: (children, opts = {}) => ({ type: 'stack', direction: 'horizontal', wrap: true, children: asArray(children), ...opts }),
  card: (children, title) => ({ type: 'card', ...(title ? { title } : {}), children: asArray(children) }),
  divider: () => ({ type: 'divider' }),
  text: (text, variant) => ({ type: 'text', text: String(text), ...(variant ? { variant } : {}) }),
  heading: (text) => ({ type: 'text', text: String(text), variant: 'heading' }),
  subheading: (text) => ({ type: 'text', text: String(text), variant: 'subheading' }),
  muted: (text) => ({ type: 'text', text: String(text), variant: 'muted' }),
  mono: (text) => ({ type: 'text', text: String(text), variant: 'mono' }),
  badge: (text, tone) => ({ type: 'badge', text: String(text), ...(tone ? { tone } : {}) }),
  stat: (label, value, hint) => ({ type: 'stat', label: String(label), value: String(value), ...(hint ? { hint } : {}) }),
  notice: (text, tone, title) => ({ type: 'notice', text: String(text), ...(tone ? { tone } : {}), ...(title ? { title } : {}) }),
  image: (url, opts = {}) => ({ type: 'image', url: String(url), ...opts }),
  mediaCard: (mediaItemId, opts = {}) => ({ type: 'mediaCard', mediaItemId: String(mediaItemId), ...opts }),
  progress: (value, label) => ({ type: 'progress', value: Number(value) || 0, ...(label ? { label } : {}) }),
  code: (text) => ({ type: 'code', text: String(text) }),
  link: (text, href, external) => ({ type: 'link', text: String(text), href: String(href), ...(external ? { external: true } : {}) }),
  button: (text, opts = {}) => ({ type: 'button', text: String(text), action: String(opts.action ?? text), ...drop(opts, 'action') }),
  input: (name, opts = {}) => ({ type: 'input', name: String(name), ...opts }),
  textarea: (name, opts = {}) => ({ type: 'textarea', name: String(name), ...opts }),
  // options live inside opts (consistent with input/toggle): ui.select('q', { label, value, options })
  select: (name, opts = {}) => ({ type: 'select', name: String(name), options: opts.options ?? [], ...drop(opts, 'options') }),
  toggle: (name, opts = {}) => ({ type: 'toggle', name: String(name), ...opts }),
}
const asArray = (v) => (Array.isArray(v) ? v.filter(Boolean) : v ? [v] : [])
const drop = (o, k) => {
  const { [k]: _omit, ...rest } = o
  return rest
}

// ---- Host API surface exposed to the plugin --------------------------------
function makeApi(config) {
  return {
    media: {
      list: (query) => callHost('media.list', { query }),
      get: (id) => callHost('media.get', { id }),
      count: (query) => callHost('media.count', { query }),
    },
    repos: { list: () => callHost('repos.list', {}) },
    categories: { list: (repositoryId) => callHost('categories.list', { repositoryId }) },
    collections: {
      list: () => callHost('collections.list', {}),
      create: (input) => callHost('collections.create', { input }),
      addItem: (collectionId, mediaItemId) => callHost('collections.addItem', { collectionId, mediaItemId }),
    },
    clips: { create: (input) => callHost('clips.create', { input }) },
    storage: {
      get: (key) => callHost('storage.get', { key }),
      set: (key, value) => callHost('storage.set', { key, value }),
      delete: (key) => callHost('storage.delete', { key }),
      list: () => callHost('storage.list', {}),
    },
    // config is resolved locally from the snapshot — no round-trip needed.
    config: { get: (key) => config[key] },
    notify: (payload) => callHost('notify', { payload }),
  }
}

// ---- Plugin lifecycle -------------------------------------------------------
let plugin = null
let pluginMeta = null
let config = {}
let api = null

function buildCtx(invokeId) {
  const log = (msg, ...rest) => {
    const text = rest.length ? `${stringify(msg)} ${rest.map(stringify).join(' ')}` : stringify(msg)
    send({ t: 'log', invokeId, level: 'info', msg: text })
  }
  const cfg = config
  return {
    plugin: pluginMeta,
    // Both ctx.config.get('key') and ctx.config.key work.
    config: Object.assign({}, cfg, { get: (k) => cfg[k] }),
    log,
    ui,
    api,
  }
}

const stringify = (v) => (typeof v === 'string' ? v : safeJson(v))
const safeJson = (v) => {
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

async function dispatch(kind, payload, invokeId) {
  const ctx = buildCtx(invokeId)
  switch (kind) {
    case 'activate':
      return (await plugin.onActivate?.(ctx)) ?? null
    case 'deactivate':
      return (await plugin.onDeactivate?.(ctx)) ?? null
    case 'render': {
      if (typeof plugin.render !== 'function') throw new Error('plugin has no render()')
      return await plugin.render(ctx, payload ?? {})
    }
    case 'action': {
      if (typeof plugin.onAction !== 'function') throw new Error('plugin has no onAction()')
      return await plugin.onAction(ctx, payload ?? {})
    }
    case 'command': {
      if (typeof plugin.onCommand !== 'function') throw new Error('plugin has no onCommand()')
      return (await plugin.onCommand(ctx, payload ?? {})) ?? null
    }
    case 'event': {
      if (typeof plugin.onEvent !== 'function') return null // events are optional
      return (await plugin.onEvent(ctx, payload ?? {})) ?? null
    }
    default:
      throw new Error(`unknown invoke kind: ${kind}`)
  }
}

// ---- IPC message loop -------------------------------------------------------
process.on('message', async (m) => {
  if (!m || typeof m !== 'object') return
  switch (m.t) {
    case 'init': {
      try {
        config = m.config ?? {}
        pluginMeta = m.plugin
        api = makeApi(config)
        const mod = await import(pathToFileURL(m.mainPath).href)
        plugin = mod.default ?? mod
        if (!plugin || typeof plugin !== 'object') throw new Error('plugin entry must export an object (default export)')
        send({ t: 'ready' })
      } catch (e) {
        send({ t: 'fatal', error: errText(e) })
      }
      return
    }
    case 'config': {
      config = m.config ?? {}
      api = makeApi(config)
      return
    }
    case 'invoke': {
      try {
        const value = await dispatch(m.kind, m.payload, m.id)
        send({ t: 'invoke.result', id: m.id, ok: true, value: value ?? null })
      } catch (e) {
        send({ t: 'invoke.result', id: m.id, ok: false, error: errText(e) })
      }
      return
    }
    case 'api.result': {
      const p = pendingApi.get(m.id)
      if (!p) return
      pendingApi.delete(m.id)
      if (m.ok) p.resolve(m.value)
      else p.reject(new Error(m.error || 'host error'))
      return
    }
  }
})

const errText = (e) => (e && e.stack ? String(e.stack) : e && e.message ? e.message : String(e))

// Surface uncaught failures to the host instead of dying silently.
process.on('uncaughtException', (e) => send({ t: 'log', invokeId: null, level: 'error', msg: `uncaught: ${errText(e)}` }))
process.on('unhandledRejection', (e) => send({ t: 'log', invokeId: null, level: 'error', msg: `unhandled: ${errText(e)}` }))
