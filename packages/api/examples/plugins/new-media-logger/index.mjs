// New Media Logger — an event-triggered example plugin.
//
// Subscribes to domain events (declared in plugin.json's "events") and reacts whenever they
// fire. Here it keeps a running count of each event in plugin-scoped storage and posts a
// notification. The "report" command reads the counts back.

export default {
  async onActivate(ctx) {
    ctx.log('new-media-logger activated')
  },

  /** Called for every subscribed domain event. */
  async onEvent(ctx, info = {}) {
    const event = info.event
    const key = `count:${event}`
    const next = (Number(await ctx.api.storage.get(key)) || 0) + 1
    await ctx.api.storage.set(key, next)
    ctx.log(`event ${event} (#${next})`, info.payload)
    await ctx.api.notify({ title: 'New activity', body: `${event} ×${next}`, level: 'info' })
  },

  async onCommand(ctx, info = {}) {
    if (info.command === 'report') {
      const all = await ctx.api.storage.list()
      ctx.log(`counts: ${JSON.stringify(all)}`)
      return all
    }
    return { ok: true }
  },
}
