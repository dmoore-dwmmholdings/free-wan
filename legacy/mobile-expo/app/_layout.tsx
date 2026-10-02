import { useEffect } from 'react'
import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import { Stack, usePathname, useRouter, useSegments } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { QueryClientProvider } from '@tanstack/react-query'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { useMe, useStoredSession } from '@/lib/auth'
import { createQueryClient } from '@/lib/query'
import { useBranding } from '@/lib/branding'
import { useRefetchOnForeground } from '@/lib/focus'
import { isLight } from '@/lib/palette'
import { clearPendingRoute, gateRedirect, pendingRoute, rememberRoute } from '@/lib/gate'
import { theme } from '@/theme'
import Ionicons from '@expo/vector-icons/Ionicons'
import type { ErrorBoundaryProps } from 'expo-router'

const queryClient = createQueryClient()

function Gate() {
  const { ready, server, token } = useStoredSession()
  const segments = useSegments()
  const pathname = usePathname()
  const router = useRouter()

  const signedIn = Boolean(server && token)
  const { data: me } = useMe(ready && signedIn)
  // Only a positive answer blocks. Offline the flag is unknown, and shutting someone out of
  // their downloads over a password rule the server will enforce anyway helps nobody.
  const mustChangePassword = me?.mustChangePassword === true

  useEffect(() => {
    const to = gateRedirect({
      ready,
      signedIn,
      mustChangePassword,
      segment: segments[0],
      pendingRoute: pendingRoute(),
    })
    if (!to) return
    // Hold on to where they were going, so signing in returns them to it rather than to the
    // library. Kept across a forced password change, which is a detour rather than a
    // destination, and dropped once it has been used.
    if (to === '/login') rememberRoute(pathname)
    else if (to !== '/change-password') clearPendingRoute()
    router.replace(to as Parameters<typeof router.replace>[0])
  }, [ready, signedIn, mustChangePassword, segments, pathname, router])

  if (!ready) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.color.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.color.primary} />
      </View>
    )
  }

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: theme.color.bg },
        headerTintColor: theme.color.text,
        headerTitleStyle: { fontWeight: '700' },
        contentStyle: { backgroundColor: theme.color.bg },
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="change-password" options={{ headerShown: false, gestureEnabled: false }} />
      <Stack.Screen name="media/[id]" options={{ title: '', headerTransparent: true }} />
      <Stack.Screen name="collection/[id]" />
      <Stack.Screen name="clip/[id]" />
    </Stack>
  )
}

/**
 * The last thing between a bug and a blank screen.
 *
 * Expo Router only wraps a route when that route exports one of these — `useScreens` reads
 * `if (ErrorBoundary)` and skips the wrapper otherwise — so without this, an exception thrown
 * while rendering unmounts the entire tree and leaves the app showing nothing at all. Not a
 * hypothetical: a version of this app shipped a crash that did exactly that, and it has been
 * reproduced since by serving a media list with its `data` array missing, which is enough to
 * take every screen down to an empty root.
 *
 * Exported from the root layout, so it covers everything below it.
 *
 * It shows the message rather than something reassuring and useless. Whoever runs this app
 * also runs the server it talks to, and the message is the only thing that says which of the
 * two to go and look at.
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.color.bg,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: theme.space(8),
        gap: theme.space(3),
      }}
    >
      <Ionicons name="alert-circle-outline" size={40} color={theme.color.danger} />
      <Text style={{ color: theme.color.text, fontSize: 17, fontWeight: '700', textAlign: 'center' }}>
        Something in the app went wrong
      </Text>
      <Text
        numberOfLines={4}
        style={{ color: theme.color.muted, fontSize: 13, lineHeight: 19, textAlign: 'center' }}
      >
        {error.message}
      </Text>
      <Pressable
        onPress={() => void retry()}
        accessibilityRole="button"
        accessibilityLabel="Try again"
        style={({ pressed }) => ({
          marginTop: theme.space(2),
          borderColor: theme.color.border,
          borderWidth: 1,
          borderRadius: theme.radius.sm,
          paddingVertical: theme.space(3),
          paddingHorizontal: theme.space(6),
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <Text style={{ color: theme.color.text, fontSize: 14, fontWeight: '700' }}>Try again</Text>
      </Pressable>
    </View>
  )
}

export default function RootLayout() {
  // Held back until branding has settled, so the tree mounts once already wearing the right
  // colours. Keying it on a version instead would remount everything, and a remount resets
  // navigation — which threw away a deep link to an item and opened the library instead.
  const brandingSettled = useBranding()
  useRefetchOnForeground()

  if (!brandingSettled) {
    // A single flat colour, so there is nothing to correct once the palette arrives.
    return <View style={{ flex: 1, backgroundColor: theme.color.bg }} />
  }

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        {/* A light preset (paper, linen) needs dark status-bar icons or they vanish. */}
        <StatusBar style={isLight(theme.color.bg) ? 'dark' : 'light'} />
        <Gate />
      </QueryClientProvider>
    </SafeAreaProvider>
  )
}
