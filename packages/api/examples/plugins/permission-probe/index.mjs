// Test fixture: this plugin only declares "media:read", so calling clips.create (which needs
// "clips:write") must be rejected by the host's permission gate.
export default {
  async onCommand(ctx, info = {}) {
    if (info.command === 'badclip') {
      await ctx.api.clips.create({ sourceItemId: 'nope', name: 'x', startS: 0, endS: 1 })
      return { ok: true }
    }
    return { ok: true }
  },
}
