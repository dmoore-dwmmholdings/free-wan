import { buildApp } from './app'
import { runTailscaleCert } from './lib/tls-cert'

// `node dist/index.js tls-cert [domain]` — provision a Tailscale HTTPS cert, then exit.
if (process.argv[2] === 'tls-cert') {
  runTailscaleCert(process.argv.slice(3))
  process.exit(0)
}

const app = await buildApp()

try {
  await app.listen({ port: app.config.port, host: app.config.host })
  app.log.info(`FreeWAN listening on ${app.config.tls ? 'https' : 'http'}://${app.config.host}:${app.config.port}`)
} catch (err) {
  app.log.error(err)
  process.exit(1)
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    void app.close().then(() => process.exit(0))
  })
}
