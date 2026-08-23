import { useEffect, useState } from 'react'
import { Image, View, type ImageStyle, type StyleProp } from 'react-native'
import { apiUrl, authHeaders } from '@/lib/api'
import { theme } from '@/theme'

/**
 * Poster/thumbnail loader. Every media route is session-guarded, so the native image loader
 * needs the bearer header explicitly — RN's Image accepts headers on the source, which is why
 * the app authenticates with a token rather than a cookie.
 */
export function AuthImage({
  path,
  localUri,
  style,
}: {
  /** Server path, e.g. `/api/media/:id/poster`. Ignored when `localUri` is set. */
  path?: string
  /** Downloaded file:// poster — used offline, needs no auth. */
  localUri?: string | null
  style?: StyleProp<ImageStyle>
}) {
  const [source, setSource] = useState<{ uri: string; headers?: Record<string, string> } | null>(
    localUri ? { uri: localUri } : null,
  )

  useEffect(() => {
    let cancelled = false
    if (localUri) {
      setSource({ uri: localUri })
      return
    }
    if (!path) return
    void (async () => {
      const [uri, headers] = await Promise.all([apiUrl(path), authHeaders()])
      if (!cancelled) setSource({ uri, headers })
    })()
    return () => {
      cancelled = true
    }
  }, [path, localUri])

  if (!source) return <View style={[{ backgroundColor: theme.color.surface2 }, style]} />
  return <Image source={source} style={style} resizeMode="cover" />
}
