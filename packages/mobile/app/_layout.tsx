import { useEffect } from 'react'
import { ActivityIndicator, View } from 'react-native'
import { Stack, useRouter, useSegments } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { useStoredSession } from '@/lib/auth'
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

  useEffect(() => {
    if (!ready) return
    const onLogin = segments[0] === 'login'
    const signedIn = Boolean(server && token)
    if (!signedIn && !onLogin) router.replace('/login')
    else if (signedIn && onLogin) router.replace('/')
  }, [ready, server, token, segments, router])

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
