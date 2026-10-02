import { useState } from 'react'
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
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useChangePassword } from '@/lib/auth'
import { withAlpha } from '@/lib/palette'
import { theme } from '@/theme'

const MIN_LENGTH = 8

function Field(props: {
  label: string
  value: string
  onChangeText: (v: string) => void
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
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        // The label above is a sibling `Text`, which tells a screen reader nothing: without
        // this, all three fields on this screen announce as an unnamed secure text field, and
        // there is no placeholder to fall back on either. Changing a password by guessing
        // which box is which is not a thing anyone should have to do.
        accessibilityLabel={props.label}
        accessibilityHint={props.hint}
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

/**
 * Shown when the account still carries the password it was created with. The web app blocks
 * every route until it is changed; this app has to do the same, or the phone is a way around
 * a control the browser enforces.
 */
export default function ChangePasswordScreen() {
  const insets = useSafeAreaInsets()
  const change = useChangePassword()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')

  const mismatch = confirm.length > 0 && next !== confirm
  const tooShort = next.length > 0 && next.length < MIN_LENGTH
  const canSubmit =
    current.length > 0 && next.length >= MIN_LENGTH && next === confirm && !change.isPending

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
        <View style={{ gap: theme.space(2) }}>
          <Text style={{ color: theme.color.text, fontSize: 26, fontWeight: '800', letterSpacing: -0.5 }}>
            Choose a password
          </Text>
          <Text style={{ color: theme.color.muted, fontSize: 15, lineHeight: 21 }}>
            This account still has the password it was created with. Pick a new one to carry on.
          </Text>
        </View>

        <Field label="Current password" value={current} onChangeText={setCurrent} />
        <Field
          label="New password"
          value={next}
          onChangeText={setNext}
          hint={tooShort ? `At least ${MIN_LENGTH} characters.` : undefined}
        />
        <Field
          label="Confirm new password"
          value={confirm}
          onChangeText={setConfirm}
          hint={mismatch ? 'These do not match.' : undefined}
        />

        {change.isError ? (
          <View
            style={{
              backgroundColor: withAlpha(theme.color.danger, 0.12),
              borderColor: withAlpha(theme.color.danger, 0.4),
              borderWidth: 1,
              borderRadius: theme.radius.sm,
              padding: theme.space(3.5),
            }}
          >
            <Text style={{ color: theme.color.danger, fontSize: 14 }}>
              {(change.error as Error).message}
            </Text>
          </View>
        ) : null}

        <Pressable
          onPress={() => {
            if (canSubmit) change.mutate({ currentPassword: current, newPassword: next })
          }}
          disabled={!canSubmit}
          accessibilityRole="button"
          style={({ pressed }) => ({
            backgroundColor: canSubmit ? theme.color.primary : theme.color.surface2,
            borderRadius: theme.radius.sm,
            paddingVertical: theme.space(4),
            alignItems: 'center',
            opacity: pressed ? 0.85 : 1,
          })}
        >
          {change.isPending ? (
            <ActivityIndicator color={theme.color.onPrimary} />
          ) : (
            <Text
              style={{
                color: canSubmit ? theme.color.onPrimary : theme.color.muted,
                fontWeight: '700',
                fontSize: 16,
              }}
            >
              Save password
            </Text>
          )}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}
