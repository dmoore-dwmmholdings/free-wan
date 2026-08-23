/** Node stub: the real module pulls in expo-modules-core, which needs a native runtime. */
const store = new Map<string, string>()
export async function getItemAsync(k: string) {
  return store.get(k) ?? null
}
export async function setItemAsync(k: string, v: string) {
  store.set(k, v)
}
export async function deleteItemAsync(k: string) {
  store.delete(k)
}
