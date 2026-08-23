/** Node stub for @react-native-async-storage/async-storage. */
const store = new Map<string, string>()
let reads = 0

export default {
  async getItem(k: string) {
    reads += 1
    // Yield twice so a second caller can slip in before this resolves.
    await Promise.resolve()
    await Promise.resolve()
    return store.get(k) ?? null
  },
  __reads: () => reads,
  async setItem(k: string, v: string) {
    store.set(k, v)
  },
  __reset() {
    store.clear()
    reads = 0
  },
  __seed(k: string, v: string) {
    store.set(k, v)
  },
}
