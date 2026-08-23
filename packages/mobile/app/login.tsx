import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useLogin } from '@/lib/auth'
import { getServerUrl } from '@/lib/session'
import { theme } from '@/theme'

function Field(props: {
  label: string
  value: string
  onChangeText: (v: string) => void
  placeholder: string
  secure?: boolean
  autoCapitalize?: 'none'
  keyboardType?: 'url'
  hint?: string
}) {
  return (
    <View style={{ gap: theme.space(1.5) }}>
      <Text style={{ color: theme.color.muted, fontSize: 11, letterSpacing: 1.2, fontWeight: '700' }}>
        {props.label.toUpperCase()}
      </Text>
      <TextInput
        value={props.value}
        onChangeText={props.onChangeText}
        placeholder={props.placeholder}
        placeholderTextColor={theme.color.muted}
        secureTextEntry={props.secure}
        autoCapitalize={props.autoCapitalize ?? 'none'}
        autoCorrect={false}
        keyboardType={props.keyboardType}
        style={{
          backgroundColor: theme.color.surface,
          borderColor: theme.color.border,
          borderWidth: 1,
          borderRadius: theme.radius.sm,
          color: theme.color.text,
          fontSize: 16,
          paddingHorizontal: theme.space(3.5),
          paddingVertical: theme.space(3.5),
        }}
      />
      {props.hint ? <Text style={{ color: theme.color.muted, fontSize: 12 }}>{props.hint}</Text> : null}
    </View>
  )
}

export default function LoginScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const login = useLogin()
  const [server, setServer] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  // Signing out keeps the server address on purpose. Fill it back in, or the promise that you
  // will not have to retype your host is one the app never keeps.
  useEffect(() => {
    void getServerUrl().then((saved) => {
      if (saved) setServer((current) => current || saved)
    })
  }, [])

  const canSubmit = server.trim() && username.trim() && password && !login.isPending

  const submit = () => {
    if (!canSubmit) return
    login.mutate(
      { server, username, password },
      { onSuccess: () => router.replace('/') },
    )
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: theme.color.bg }}
    >
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: 'center',
          padding: theme.space(6),
          paddingTop: insets.top + theme.space(10),
          gap: theme.space(5),
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ gap: theme.space(2), marginBottom: theme.space(2) }}>
          <Text style={{ color: theme.color.text, fontSize: 32, fontWeight: '800', letterSpacing: -0.5 }}>
            {theme.siteName}
          </Text>
          <Text style={{ color: theme.color.muted, fontSize: 15, lineHeight: 21 }}>
            Connect to your server to browse and download your library.
          </Text>
        </View>

        <Field
          label="Server"
          value={server}
          onChangeText={setServer}
          placeholder="media.tailnet.ts.net"
          keyboardType="url"
          hint="Your tailnet hostname or LAN address. https:// is assumed."
        />
        <Field label="Username" value={username} onChangeText={setUsername} placeholder="admin" />
        <Field label="Password" value={password} onChangeText={setPassword} placeholder="" secure />

        {login.isError ? (
          <View
            style={{
              backgroundColor: 'rgba(248,113,113,0.12)',
              borderColor: 'rgba(248,113,113,0.4)',
              borderWidth: 1,
              borderRadius: theme.radius.sm,
              padding: theme.space(3.5),
            }}
          >
            <Text style={{ color: theme.color.danger, fontSize: 14 }}>
              {(login.error as Error).message}
            </Text>
          </View>
        ) : null}

        <Pressable
          onPress={submit}
          disabled={!canSubmit}
          accessibilityRole="button"
          // Announces itself as unavailable rather than just failing to respond.
          accessibilityState={{ disabled: !canSubmit }}
          style={({ pressed }) => ({
            backgroundColor: canSubmit ? theme.color.primary : theme.color.surface2,
            borderRadius: theme.radius.sm,
            paddingVertical: theme.space(4),
            alignItems: 'center',
            opacity: pressed ? 0.85 : 1,
          })}
        >
          {login.isPending ? (
            <ActivityIndicator color={theme.color.onPrimary} />
          ) : (
            <Text style={{ color: canSubmit ? theme.color.onPrimary : theme.color.muted, fontWeight: '700', fontSize: 16 }}>
              Sign in
            </Text>
          )}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}
