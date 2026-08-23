/** Node stub for @react-native-async-storage/async-storage. */
const store = new Map<string, string>()
let reads = 0
let holdWrite: Promise<void> | null = null
let failWrite = false

export default {
  async getItem(k: string) {
    reads += 1
    // Yield twice so a second caller can slip in before this resolves.
    await Promise.resolve()
    await Promise.resolve()
    return store.get(k) ?? null
  },
  __reads: () => reads,
  /** Make the next write reject, as a full or unavailable store would. */
  __failNextWrite() {
    failWrite = true
  },
  async setItem(k: string, v: string) {
    if (failWrite) {
      failWrite = false
      throw new Error('no space left on device')
    }
    // Held before the write lands, so a caller can be inspected mid-persist.
    if (holdWrite) {
      const pending = holdWrite
      holdWrite = null
      await pending
    }
    store.set(k, v)
  },
  /** Pause the next write so in-flight state can be observed. Returns a release fn. */
  __holdNextWrite() {
    let release!: () => void
    holdWrite = new Promise<void>((resolve) => {
      release = resolve
    })
    return release
  },
  __reset() {
    store.clear()
    reads = 0
    holdWrite = null
    failWrite = false
  },
  __seed(k: string, v: string) {
    store.set(k, v)
  },
}
