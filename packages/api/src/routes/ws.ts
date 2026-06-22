import type { FastifyInstance } from 'fastify'
import type { WebSocket } from '@fastify/websocket'
import { resolveSession } from '../plugins/auth'

const WS_OPEN = 1 // ws.WebSocket.OPEN

interface ClientMessage {
  type: 'subscribe' | 'unsubscribe'
  topic: string
}

// Only allow subscribing to a caller-safe set of topic prefixes (API doc §13).
const ALLOWED_PREFIXES = ['scan:', 'job:', 'run:']
function topicAllowed(topic: string): boolean {
  return ALLOWED_PREFIXES.some((p) => topic.startsWith(p) && topic.length > p.length)
}

/**
 * GET /api/ws — one authenticated socket per client. Cookie-authenticated on upgrade;
 * the client sends `{type:'subscribe',topic}` and the server pushes hub events.
 */
export async function wsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/ws', { websocket: true }, (socket: WebSocket, req) => {
    const user = resolveSession(app, req)
    if (!user) {
      socket.close(1008, 'unauthorized')
      return
    }

    const unsubscribers = new Map<string, () => void>()

    socket.on('message', (raw: Buffer) => {
      let msg: ClientMessage
      try {
        msg = JSON.parse(raw.toString()) as ClientMessage
      } catch {
        return
      }
      if (!msg || typeof msg.topic !== 'string') return

      if (msg.type === 'subscribe') {
        if (!topicAllowed(msg.topic) || unsubscribers.has(msg.topic)) return
        const off = app.events.subscribe(msg.topic, (data) => {
          if (socket.readyState === WS_OPEN) socket.send(JSON.stringify(data))
        })
        unsubscribers.set(msg.topic, off)
      } else if (msg.type === 'unsubscribe') {
        unsubscribers.get(msg.topic)?.()
        unsubscribers.delete(msg.topic)
      }
    })

    const cleanup = () => {
      for (const off of unsubscribers.values()) off()
      unsubscribers.clear()
    }
    socket.on('close', cleanup)
    socket.on('error', cleanup)
  })
}
