/**
 * Subscribe to one server event topic over the authenticated WebSocket (`/api/ws`,
 * cookie-authed on upgrade; topics are prefix-allowlisted server-side — scan:/job:/run:).
 * One socket per subscription keeps the lifecycle trivial: the returned cleanup closes it.
 */
export function subscribeTopic(topic: string, onEvent: (data: unknown) => void): () => void {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
  const ws = new WebSocket(`${proto}://${window.location.host}/api/ws`)
  ws.onopen = () => ws.send(JSON.stringify({ type: 'subscribe', topic }))
  ws.onmessage = (e) => {
    try {
      onEvent(JSON.parse(String(e.data)))
    } catch {
      /* non-JSON frame — ignore */
    }
  }
  return () => {
    try {
      ws.close()
    } catch {
      /* already closed */
    }
  }
}
