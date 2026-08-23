import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// `fileURLToPath(import.meta.url)` takes the string form deliberately: Expo's tsconfig pulls in
// the DOM `URL`, which is not the Node `URL` that fileURLToPath is typed against.
const dir = path.dirname(fileURLToPath(import.meta.url))
const stub = (name: string) => path.join(dir, 'test', 'stubs', name)

export default defineConfig({
  resolve: {
    alias: {
      '@': path.join(dir, 'src'),
      '@free-wan/shared': path.join(dir, '..', 'shared', 'src', 'index.ts'),
      // These packages import expo-modules-core / React Native internals at load time, which
      // cannot run under Node. The logic under test never calls into them.
      'react-native': stub('react-native.ts'),
      'expo-secure-store': stub('expo-secure-store.ts'),
      'expo-file-system/legacy': stub('expo-file-system.ts'),
      '@react-native-async-storage/async-storage': stub('async-storage.ts'),
    },
  },
  test: { environment: 'node', include: ['test/**/*.test.ts'] },
})
