/**
 * Stands in for `react-native`, which cannot load under Node — it reaches into the native
 * module registry at import time. Only `Appearance` is needed: the code under test uses it to
 * point the platform's chrome at the brand.
 *
 * `setColorScheme` records rather than acts, so a test can check the scheme follows the
 * branding that was applied. It is spelled as an own property because production code checks
 * `typeof Appearance.setColorScheme === 'function'` before calling it — the guard that exists
 * because react-native-web has no such function.
 */
export const Appearance = {
  schemes: [] as string[],
  setColorScheme(scheme: string): void {
    Appearance.schemes.push(scheme)
  },
}
