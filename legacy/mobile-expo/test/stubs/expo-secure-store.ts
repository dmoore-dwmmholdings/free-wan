/** Node stub: the real module pulls in expo-modules-core, which needs a native runtime. */
const store = new Map<string, string>()
let failDeletes = false

/** Simulate a keychain that refuses to delete. */
export function __failDeletes(on: boolean): void {
  failDeletes = on
}
export async function getItemAsync(k: string) {
  return store.get(k) ?? null
}
export async function setItemAsync(k: string, v: string) {
  store.set(k, v)
}
export async function deleteItemAsync(k: string) {
  if (failDeletes) throw new Error('keychain unavailable')
  store.delete(k)
}
