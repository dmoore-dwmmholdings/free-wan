import { buildApp } from './app'

const app = await buildApp()

try {
  await app.listen({ port: app.config.port, host: app.config.host })
} catch (err) {
  app.log.error(err)
  process.exit(1)
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    void app.close().then(() => process.exit(0))
  })
}
