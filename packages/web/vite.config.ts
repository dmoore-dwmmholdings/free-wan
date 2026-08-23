import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Resolve the workspace package to its TypeScript source so Vite bundles it.
      '@free-wan/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      // FW_API_PORT lets dev point at an API on a non-default port; ws:true proxies /api/ws.
      '/api': { target: `http://localhost:${process.env.FW_API_PORT || 8080}`, ws: true },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
