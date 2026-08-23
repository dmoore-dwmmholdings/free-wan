import { useEffect } from 'react'
import { ActivityIndicator, View } from 'react-native'
import { Stack, useRouter, useSegments } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { useMe, useStoredSession } from '@/lib/auth'
import { theme } from '@/theme'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // A phone drops off the tailnet constantly; serve cached data rather than spinners.
      staleTime: 30_000,
      retry: 1,
    },
  },
})

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
    if (!ready) return
    const onLogin = segments[0] === 'login'
    const onChangePassword = segments[0] === 'change-password'

    if (!signedIn) {
      if (!onLogin) router.replace('/login')
      return
    }
    // The web app blocks every route until the starting password is replaced; this app has
    // to agree, or the phone is the way around it.
    if (mustChangePassword) {
      if (!onChangePassword) router.replace('/change-password')
      return
    }
    if (onLogin || onChangePassword) router.replace('/')
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
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <StatusBar style="light" />
        <Gate />
      </QueryClientProvider>
    </SafeAreaProvider>
  )
}
