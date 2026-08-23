/** Node stub for expo-file-system/legacy — enough for the pure helpers under test. */
export const documentDirectory = 'file:///doc/'
export async function makeDirectoryAsync() {}
export async function getInfoAsync() {
  return { exists: false } as const
}
export async function downloadAsync() {
  return { uri: '', status: 200 }
}
export function createDownloadResumable() {
  return { downloadAsync: async () => ({ uri: '' }) }
}
export async function deleteAsync() {}
