import * as SecureStore from 'expo-secure-store'

/**
 * Where the session lives: the iOS Keychain and the Android Keystore.
 *
 * Split out from `session.ts` so it can have a platform variant. `expo-secure-store` has no
 * web implementation, and the browser is how this package's screens get looked at — see
 * `secure-store.web.ts`. Keeping the seam here means the rest of the app, and the session
 * logic in particular, is the same code on every platform.
 */
export const readItem = (key: string): Promise<string | null> => SecureStore.getItemAsync(key)

export const writeItem = (key: string, value: string): Promise<void> =>
  SecureStore.setItemAsync(key, value)

export const removeItem = (key: string): Promise<void> => SecureStore.deleteItemAsync(key)
