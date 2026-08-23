/**
 * Web stand-in for the keychain. Metro picks this file over `secure-store.ts` when bundling
 * for web, which nothing ships — the app is iOS and Android.
 *
 * It exists because the browser is how these screens are looked at while they are being
 * built: `expo-video` cannot play here and `expo-file-system` does nothing, but layout,
 * navigation, the auth gate, branding and every list and empty state behave as they do on a
 * phone, and that is most of the app. Without somewhere to keep a session, none of it is
 * reachable past the login screen.
 *
 * This used to be achieved by patching `session.ts` before each browser run and unpatching
 * afterwards. That went wrong in a way worth remembering: Metro serves the working tree live,
 * so while the patch was applied a phone connected to the dev server was running it — and,
 * more to the point, verification and leaving something scannable became mutually exclusive.
 * A session skipped the browser check for that reason and shipped a crash that left the app
 * on a blank screen.
 *
 * `localStorage` is not a keychain and this would not be acceptable in something shipped to
 * browsers. It is acceptable here because web is a development target only.
 */
function store(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    // Blocked by the browser's site-data settings. Sign-in will not persist; nothing else
    // should fall over because of it.
    return null
  }
}

export const readItem = async (key: string): Promise<string | null> => store()?.getItem(key) ?? null

export const writeItem = async (key: string, value: string): Promise<void> => {
  store()?.setItem(key, value)
}

export const removeItem = async (key: string): Promise<void> => {
  store()?.removeItem(key)
}
