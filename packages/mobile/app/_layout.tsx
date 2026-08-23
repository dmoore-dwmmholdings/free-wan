import { useEffect } from 'react'
import { ActivityIndicator, View } from 'react-native'
import { Stack, useRouter, useSegments } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { QueryClientProvider } from '@tanstack/react-query'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { useMe, useStoredSession } from '@/lib/auth'
import { createQueryClient } from '@/lib/query'
import { useBranding } from '@/lib/branding'
import { useRefetchOnForeground } from '@/lib/focus'
import { isLight } from '@/lib/palette'
import { gateRedirect } from '@/lib/gate'
import { theme } from '@/theme'

const queryClient = createQueryClient()

function Gate() {
  const { ready, server, token } = useStoredSession()
  const segments = useSegments()
  const router = useRouter()

  const signedIn = Boolean(server && token)
  const { data: me } = useMe(ready && signedIn)
  // Only a positive answer blocks. Offline the flag is unknown, and shutting someone out of
  // their downloads over a password rule the server will enforce anyway helps nobody.
  const mustChangePassword = me?.mustChangePassword === true

  useEffect(() => {
    const to = gateRedirect({ ready, signedIn, mustChangePassword, segment: segments[0] })
    if (to) router.replace(to)
  }, [ready, signedIn, mustChangePassword, segments, router])

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

export default function RootLayout() {
  // Keying the tree on this remounts it once branding has retuned the tokens. Cheap, because
  // it happens at most once per launch, and it is what makes the mutated tokens take effect.
  const brandingVersion = useBranding()
  useRefetchOnForeground()
  return (
    <SafeAreaProvider key={brandingVersion}>
      <QueryClientProvider client={queryClient}>
        {/* A light preset (paper, linen) needs dark status-bar icons or they vanish. */}
        <StatusBar style={isLight(theme.color.bg) ? 'dark' : 'light'} />
        <Gate />
      </QueryClientProvider>
    </SafeAreaProvider>
  )
}
