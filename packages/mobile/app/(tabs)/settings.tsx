import { useEffect, useState } from 'react'
import { Alert, Pressable, ScrollView, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useLogout, useMe } from '@/lib/auth'
import { getServerUrl } from '@/lib/session'
import { formatBytes, useDownloads } from '@/lib/downloads'
import { theme } from '@/theme'

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: theme.space(2) }}>
      <Text style={{ color: theme.color.muted, fontSize: 11, letterSpacing: 1.2, fontWeight: '700' }}>
        {label.toUpperCase()}
      </Text>
      <View
        style={{
          backgroundColor: theme.color.surface,
          borderColor: theme.color.border,
          borderWidth: 1,
          borderRadius: theme.radius.sm,
          padding: theme.space(4),
          gap: theme.space(3),
        }}
      >
        {children}
      </View>
    </View>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: theme.space(4) }}>
      <Text style={{ color: theme.color.muted, fontSize: 14 }}>{label}</Text>
      <Text style={{ color: theme.color.text, fontSize: 14, fontWeight: '600', flexShrink: 1, textAlign: 'right' }}>
        {value}
      </Text>
    </View>
  )
}

export default function SettingsScreen() {
  const router = useRouter()
  const { data: me } = useMe(true)
  const logout = useLogout()
  const { items } = useDownloads()
  const [server, setServer] = useState<string | null>(null)

  useEffect(() => {
    void getServerUrl().then(setServer)
  }, [])

  const confirmSignOut = () => {
    Alert.alert('Sign out?', 'Downloads stay on this device.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: () => logout.mutate(undefined, { onSuccess: () => router.replace('/login') }),
      },
    ])
  }

  return (
    <ScrollView
      style={{ backgroundColor: theme.color.bg }}
      contentContainerStyle={{ padding: theme.space(4), gap: theme.space(6) }}
    >
      <Section label="Account">
        <Row label="Signed in as" value={me?.username ?? '—'} />
        <Row label="Role" value={me?.role ?? '—'} />
      </Section>

      <Section label="Server">
        <Row label="Address" value={server ?? '—'} />
      </Section>

      <Section label="Offline">
        <Row label="Downloads" value={String(items.length)} />
        <Row label="Storage used" value={formatBytes(items.reduce((s, i) => s + i.bytes, 0))} />
      </Section>

      <Pressable
        onPress={confirmSignOut}
        accessibilityRole="button"
        style={({ pressed }) => ({
          borderColor: 'rgba(248,113,113,0.4)',
          borderWidth: 1,
          borderRadius: theme.radius.sm,
          paddingVertical: theme.space(3.5),
          alignItems: 'center',
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <Text style={{ color: theme.color.danger, fontWeight: '700', fontSize: 15 }}>Sign out</Text>
      </Pressable>
    </ScrollView>
  )
}
