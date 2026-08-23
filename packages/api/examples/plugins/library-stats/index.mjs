// Library Stats — a worked example plugin.
//
// Demonstrates: a UI panel built from the block kit, reading the library through the Host API,
// plugin-scoped storage, config, and a user-runnable command. No imports required — the host
// injects `ctx` (ctx.ui builders + ctx.api mediated library access).

export default {
  /** Render the panel. Called for GET /api/plugins/:id/panels/main. */
  async render(ctx, info = {}) {
    const fields = info.fields ?? {}
    const heading = ctx.config.get('greeting') || 'Your Library'
    const { total } = await ctx.api.media.count({})
    const videos = await ctx.api.media.count({ type: 'video' })
    const images = await ctx.api.media.count({ type: 'image' })
    const latest = await ctx.api.media.list({ limit: 4, sort: 'added', order: 'desc' })
    const savedNote = (await ctx.api.storage.get('note')) || ''
    const noteValue = typeof fields.note === 'string' ? fields.note : savedNote

    return ctx.ui.stack([
      ctx.ui.heading(heading),
      ctx.ui.row([
        ctx.ui.stat('Items', String(total)),
        ctx.ui.stat('Videos', String(videos.total)),
        ctx.ui.stat('Images', String(images.total)),
      ]),
      ctx.ui.card([
        ctx.ui.subheading('Notepad'),
        ctx.ui.input('note', { label: 'A note saved with the plugin', value: noteValue, placeholder: 'Type something…' }),
        ctx.ui.row([
          ctx.ui.button('Save', { action: 'save', variant: 'primary' }),
          ctx.ui.button('Refresh', { action: 'refresh' }),
        ]),
        savedNote ? ctx.ui.notice(`Saved note: ${savedNote}`, 'success') : ctx.ui.muted('No note saved yet.'),
      ]),
      ctx.ui.subheading('Latest media'),
      latest.data.length
        ? ctx.ui.row(latest.data.map((m) => ctx.ui.mediaCard(m.id, { title: m.title, posterUrl: m.posterUrl })))
        : ctx.ui.muted('Nothing in the library yet.'),
    ])
  },

  /** Handle a panel action. Called for POST …/panels/main/action. */
  async onAction(ctx, info = {}) {
    if (info.action === 'save') {
      await ctx.api.storage.set('note', String(info.fields?.note ?? ''))
      ctx.log('note saved')
    }
    // Re-render with the latest state.
    return this.render(ctx, info)
  },

  /** Run a command. Called via the job worker for POST …/commands/count/run. */
  async onCommand(ctx, info = {}) {
    if (info.command === 'count') {
      const type = info.args?.type
      const query = type === 'video' || type === 'image' ? { type } : {}
      const { total } = await ctx.api.media.count(query)
      ctx.log(`Library has ${total} ${type && type !== 'all' ? type + ' ' : ''}items.`)
      return { total }
    }
    return { ok: true }
  },
}
