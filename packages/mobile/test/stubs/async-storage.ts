/** Node stub for @react-native-async-storage/async-storage. */
const store = new Map<string, string>()
export default {
  async getItem(k: string) {
    return store.get(k) ?? null
  },
  async setItem(k: string, v: string) {
    store.set(k, v)
  },
}
